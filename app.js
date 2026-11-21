(() => {
  "use strict";

  const { QUARTER_DAYS } = PeakModel;
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const dollars = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
  const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const formatMoney = (value) => dollars.format(value);
  const waitDays = (result) => result.orders ? QUARTER_DAYS * result.waited / result.orders : 0;
  const fillRate = (result) => result.orders ? `${(100 * result.fills / result.orders).toFixed(1)}%` : "—";
  let analysis = null;
  let selected = null;
  let framePending = false;

  function showStatus(message, working = false) {
    const status = $("status");
    status.textContent = message;
    status.classList.toggle("visible", Boolean(message));
    status.classList.toggle("working", working);
  }

  function analyzeInWorker(seed) {
    return new Promise((resolve, reject) => {
      const worker = new Worker("peak-worker.js?v=2");
      worker.onmessage = ({ data }) => {
        worker.terminate();
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || "The background calculation could not start."));
      };
      worker.postMessage(seed);
    });
  }

  async function analyzeLocalFile(seed) {
    // File URLs can block workers. Yield periodically so controls still respond.
    const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));
    await nextTurn();
    const portfolio = PeakModel.generatePortfolio(seed);
    const baseline = PeakModel.evaluateBaseline(portfolio);
    const table = [];
    let lastYield = performance.now();
    for (const row of PeakModel.candidateRows(portfolio)) {
      table.push(row);
      if (performance.now() - lastYield > 12) {
        await nextTurn();
        lastYield = performance.now();
      }
    }
    await nextTurn();
    return {
      items: portfolio.items,
      baseline,
      frontier: PeakOptimizer.buildFrontier(table),
    };
  }

  function sweep(frontier, baseline) {
    const evenlySpaced = (values, count) => {
      let min = Infinity;
      let max = -Infinity;
      for (const value of values) {
        min = Math.min(value, min);
        max = Math.max(value, max);
      }
      return Array.from({ length: count }, (_, index) => min + (max - min) * index / (count - 1));
    };
    const workloadCaps = new Set([...evenlySpaced(frontier.map((point) => point.buys), 5), baseline.buys]);
    const waitCaps = new Set([...evenlySpaced(frontier.map(waitDays), 7), waitDays(baseline)]);
    const points = new Map();
    for (const workloadCap of workloadCaps) {
      for (const waitCap of waitCaps) {
        const point = PeakOptimizer.solve(frontier, workloadCap, waitCap);
        if (point && !points.has(point)) points.set(point, { point, workloadCap, waitCap });
      }
    }
    return [...points.values()];
  }

  function renderChart(points, activePolicy, baseline) {
    const svg = $("chart");
    const width = 760, height = 330;
    const left = 72, right = width - 22, top = 20, bottom = height - 48;
    const inventory = points.map(({ point }) => point.inv).concat(baseline.inventory);
    const wait = points.map(({ point }) => waitDays(point)).concat(waitDays(baseline));
    if (activePolicy) {
      inventory.push(activePolicy.inv);
      wait.push(waitDays(activePolicy));
    }
    const minX = Math.min(...inventory);
    const maxX = Math.max(minX + 1, ...inventory);
    const minY = Math.min(...wait);
    const maxY = Math.max(minY + 1, ...wait);
    const x = (value) => left + (value - minX) / (maxX - minX) * (right - left);
    const y = (value) => bottom - (value - minY) / (maxY - minY) * (bottom - top);
    const minCap = Math.min(...points.map(({ workloadCap }) => workloadCap));
    const capRange = Math.max(1, Math.max(...points.map(({ workloadCap }) => workloadCap)) - minCap);
    const content = [];
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = minX + (maxX - minX) * tick / 4;
      const days = minY + (maxY - minY) * tick / 4;
      content.push(
        `<line class="gridline" x1="${x(value)}" y1="${top}" x2="${x(value)}" y2="${bottom}"/>`,
        `<text class="axis-text" x="${x(value)}" y="${height - 20}" text-anchor="middle">${formatMoney(value)}</text>`,
        `<line class="gridline" x1="${left}" y1="${y(days)}" x2="${right}" y2="${y(days)}"/>`,
        `<text class="axis-text" x="${left - 12}" y="${y(days) + 3}" text-anchor="end">${days.toFixed(0)}d</text>`,
      );
    }
    content.push(
      `<line class="axis" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"/>`,
      `<line class="axis" x1="${left}" y1="${top}" x2="${left}" y2="${bottom}"/>`,
    );
    for (const { point, workloadCap, waitCap } of points) {
      const color = `hsl(${150 + 80 * (workloadCap - minCap) / capRange} 45% 40%)`;
      const label = `${formatMoney(point.inv)} inventory, ${waitDays(point).toFixed(1)} wait days, ${number.format(point.buys)} buys/year. Caps ${number.format(workloadCap)} buys/year and ${number.format(waitCap)} days.`;
      content.push(`<circle class="point" style="fill:${color}" cx="${x(point.inv)}" cy="${y(waitDays(point))}" r="5" tabindex="0" aria-label="${label}"><title>${label}</title></circle>`);
    }
    content.push(`<circle class="baseline-point" cx="${x(baseline.inventory)}" cy="${y(waitDays(baseline))}" r="6"><title>Forecast + Safety Stock baseline</title></circle>`);
    if (activePolicy) {
      content.push(`<circle class="selected-point" cx="${x(activePolicy.inv)}" cy="${y(waitDays(activePolicy))}" r="7"><title>Selected policy</title></circle>`);
    }
    content.push(
      `<text class="axis-text" x="${(left + right) / 2}" y="${height - 3}" text-anchor="middle">Average on-hand inventory value</text>`,
      `<text class="axis-text" transform="translate(15 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle">Wait days per customer order</text>`,
    );
    svg.innerHTML = content.join("");
  }

  function renderMetrics(policy, baseline) {
    $("inventory-metric").textContent = policy ? formatMoney(policy.inv) : "—";
    $("fill-metric").textContent = policy ? fillRate(policy) : "—";
    $("wait-metric").textContent = policy ? `${waitDays(policy).toFixed(1)} days` : "—";
    $("buys-metric").textContent = policy ? `${number.format(policy.buys)} / year` : "—";
    $("inventory-delta").textContent = baseline ? `Baseline ${formatMoney(baseline.inventory)}` : "Average on-hand";
    $("fill-delta").textContent = baseline ? `Baseline ${fillRate(baseline)}` : "Orders filled at arrival";
    $("wait-delta").textContent = baseline ? `Baseline ${waitDays(baseline).toFixed(1)} days` : "Days per order";
    $("buys-delta").textContent = baseline ? `Baseline ${number.format(baseline.buys)} / year` : "Buys per year";
  }

  function renderPolicies() {
    const checked = new Set([...document.querySelectorAll(".group-filter:checked")]
      .map((input) => Number(input.value)));
    const policies = selected ? selected.picks.filter((policy) => checked.has(policy.group)) : [];
    $("policy-count").textContent = selected ? `${policies.length} of 7 groups` : "";
    $("policy-table").innerHTML = policies.map((policy) => {
      const count = analysis.items.filter((item) => item.group === policy.group).length;
      return `<tr><td>Group ${policy.group + 1}</td><td>${count}</td><td>${policy.multiplier}</td><td>${policy.quantity}</td><td>${formatMoney(policy.inventory)}</td><td>${number.format(policy.buys)}</td></tr>`;
    }).join("");

    if (!$("item-levels").open || !policies.length) {
      $("item-count").textContent = "";
      $("items-table").innerHTML = "";
      return;
    }
    const policiesByGroup = new Map(policies.map((policy) => [policy.group, policy]));
    const items = analysis.items.filter((item) => policiesByGroup.has(item.group));
    $("item-count").textContent = `${number.format(Math.min(items.length, 300))} of ${number.format(items.length)} matching items`;
    $("items-table").innerHTML = items.slice(0, 300).map((item) => {
      const policy = policiesByGroup.get(item.group);
      const reorder = Math.ceil(policy.multiplier * item.peak);
      return `<tr><td>${item.id}</td><td>${cents.format(item.price)}</td><td>${item.group + 1}</td><td>${item.peak}</td><td>${policy.multiplier}</td><td>${policy.quantity}</td><td>${reorder}</td><td>${reorder + policy.quantity}</td></tr>`;
    }).join("");
  }

  function applyLimits() {
    if (!analysis) return;
    const policy = PeakOptimizer.solve(analysis.frontier, Number($("workload").value), Number($("wait").value));
    showStatus(policy ? "" : "No policy meets both limits. Increase one or both limits to see a feasible policy.");
    if (selected === policy) return;
    selected = policy;
    renderMetrics(policy, analysis.baseline);
    renderChart(analysis.points, policy, analysis.baseline);
    renderPolicies();
  }

  function updateLimits() {
    $("workload-value").textContent = number.format(Number($("workload").value));
    $("wait-value").textContent = `${$("wait").value} days`;
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      applyLimits();
    });
  }

  async function recalculate() {
    const seedInput = $("seed");
    if (!seedInput.reportValidity()) return;
    const seed = seedInput.value === "" ? 11 : Number(seedInput.value);
    if (analysis?.seed === seed) {
      applyLimits();
      return;
    }
    const button = $("run");
    button.disabled = true;
    showStatus("Simulating demand and preparing policy options…", true);
    analysis = null;
    selected = null;
    renderMetrics(null, null);
    renderPolicies();
    $("chart").replaceChildren();
    try {
      const useWorker = location.protocol !== "file:" && typeof Worker === "function";
      const result = useWorker ? await analyzeInWorker(seed) : await analyzeLocalFile(seed);
      analysis = { ...result, seed, points: sweep(result.frontier, result.baseline) };
      // Render the baseline and trade-off points even if the current caps are infeasible.
      selected = undefined;
      applyLimits();
    } catch (error) {
      console.error(error);
      showStatus("The calculation failed. Reload the page to refresh the app files, or select Recalculate portfolio to retry.");
    } finally {
      button.disabled = false;
    }
  }

  function checkSmallCase() {
    const data = PeakModel.fixture();
    const expected = [
      [0, 0, 2, 4.50, 7, 4, 6], [0, 0, 5, 11.50, 3, 7, 3],
      [0, 0.5, 2, 15.50, 7, 7, 2], [0, 0.5, 5, 28.50, 3, 9, 0],
      [1, 0, 1, 6.75, 10, 3, 13], [1, 0, 3, 35, 5, 4, 8],
      [1, 0.5, 1, 50, 10, 4, 7], [1, 0.5, 3, 87.50, 5, 6, 5],
    ];
    const actual = expected.map(([group, m, q]) =>
      PeakModel.evaluateCandidate(data.items, data.trials, group, m, q));
    const near = (a, b) => Math.abs(a - b) < 1e-8;
    let passed = actual.every((row, index) => {
      const [group, , , inventory, buys, fills, waited] = expected[index];
      return near(row.inventory, inventory) && row.buys === buys && row.fills === fills
        && row.waited === waited && row.orders === (group === 0 ? 9 : 10);
    });
    const baseline = PeakModel.evaluateBaseline(data);
    passed = passed && near(baseline.inventory, 109.75) && baseline.buys === 11
      && baseline.orders === 19 && baseline.fills === 14 && baseline.waited === 5;

    const frontier = PeakOptimizer.buildFrontier(actual);
    const cases = [
      [12, 7, 103, 2, 7], [13, 7, 78.50, 3, 6],
      [12, 8, 63.50, 3, 5], [11, 5, 116, 3, 7],
    ];
    const casesPass = cases.every(([workload, waited, inventory, low, high]) => {
      const result = PeakOptimizer.solve(frontier, workload, QUARTER_DAYS * waited / 19);
      return result && near(result.inv, inventory)
        && result.picks.length === 2 && result.picks.every((policy, group) => {
          const expectedPolicy = actual[group === 0 ? low : high];
          return policy.group === group && policy.multiplier === expectedPolicy.multiplier
            && policy.quantity === expectedPolicy.quantity;
        });
    });
    passed = passed && casesPass && !PeakOptimizer.solve(frontier, 7, QUARTER_DAYS)
      && !PeakOptimizer.solve(frontier, 17, QUARTER_DAYS * 4 / 19);
    $("check-table").innerHTML = actual.map((row) =>
      `<tr><td>${row.group + 1}</td><td>${row.multiplier}</td><td>${row.quantity}</td><td>${cents.format(row.inventory)}</td><td>${row.buys}</td><td>${row.fills}/${row.orders}</td><td>${row.waited}</td></tr>`
    ).join("");
    $("check-status").textContent = passed
      ? `Passed. Eight candidates, the baseline, four optima, and two infeasible settings match. Baseline ${cents.format(baseline.inventory)}, 11 buys/year, 14/19 immediate fills.`
      : "Verification failed. One or more model results differ from the six-item reference.";
    $("check-status").style.color = passed ? "#245b49" : "#a3362d";
  }

  for (let group = 0; group < 7; group += 1) {
    $("group-filters").insertAdjacentHTML("beforeend",
      `<label class="group-check"><input class="group-filter" type="checkbox" value="${group}" checked> G${group + 1}</label>`);
  }
  $("workload").addEventListener("input", updateLimits);
  $("wait").addEventListener("input", updateLimits);
  $("run").addEventListener("click", recalculate);
  $("group-filters").addEventListener("change", renderPolicies);
  $("item-levels").addEventListener("toggle", renderPolicies);
  $("check-case").addEventListener("click", checkSmallCase);
  recalculate();
})();
