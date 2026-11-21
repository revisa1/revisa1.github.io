(() => {
  "use strict";

  const M_VALUES = [0, 0.25, 0.5, 0.75, 1, 1.5];
  const Q_VALUES = [[2, 4, 8, 16], [2, 4, 8, 12], [1, 3, 6, 10], [1, 3, 5, 8], [1, 2, 4, 6], [1, 2, 3, 5], [1, 2, 3, 4]];
  const PRICE_CUTS = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
  const QUARTER_DAYS = 91.25;
  const $ = (id) => document.getElementById(id);
  let current = null;

  function rng(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function poisson(random, mean) {
    const threshold = Math.exp(-mean);
    let product = 1;
    let count = 0;
    do { count += 1; product *= random(); } while (product > threshold);
    return count - 1;
  }
  function normal(random) {
    return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
  }
  function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    const position = fraction * (sorted.length - 1);
    const lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  }
  function generatePortfolio(seed, count = 2000) {
    const random = rng(seed);
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const price = Math.round(Math.exp(Math.log(1) + random() * (Math.log(1000) - Math.log(1))) * 100) / 100;
      const activity = 0.08 + random() * 0.27;
      const history = Array(20).fill(0);
      const active = Math.min(9, Math.max(1, Array.from({ length: 20 }, () => random() < activity).filter(Boolean).length));
      const quarters = Array.from({ length: 20 }, (_, j) => j).sort(() => random() - 0.5).slice(0, active);
      for (const quarter of quarters) history[quarter] = random() < 0.1 ? 8 + poisson(random, 6) : 1 + poisson(random, 2);
      items.push({ id: `PNG-${String(i + 1).padStart(4, "0")}`, price, lead: random() < 0.35 ? 2 : 1, history });
    }
    const sorted = [...items].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
    const cuts = PRICE_CUTS.map((fraction) => Math.ceil(fraction * count));
    for (let rank = 0; rank < sorted.length; rank += 1) {
      sorted[rank].group = cuts.filter((cut) => rank + 1 > cut).length;
      sorted[rank].peak = Math.max(...sorted[rank].history);
      const mean = sorted[rank].history.reduce((a, b) => a + b, 0) / 20;
      sorted[rank].mean = mean;
      sorted[rank].std = Math.sqrt(sorted[rank].history.reduce((sum, x) => sum + (x - mean) ** 2, 0) / 20);
    }
    const trialRandom = rng((seed ^ 0x08292016) >>> 0);
    const trials = Array.from({ length: 20 }, () => sorted.map((item) => Array.from({ length: 20 }, () => item.history[Math.floor(trialRandom() * 20)])));
    return { items: sorted, trials };
  }

  function simulateItem(item, demand, reorder, quantity) {
    const horizon = demand.length;
    const scoredEnd = horizon;
    let stock = reorder + quantity;
    const pipeline = new Map();
    const backlog = [];
    const orderRemaining = [];
    const lastFulfilled = [];
    let inventoryUnits = 0;
    let buys = 0;
    let orders = 0;
    let fills = 0;
    let waited = 0;
    for (let quarter = 0; quarter < horizon; quarter += 1) {
      stock += pipeline.get(quarter) || 0;
      pipeline.delete(quarter);
      while (stock > 0 && backlog.length) {
        const head = backlog[0];
        const issued = Math.min(stock, head.remaining);
        stock -= issued;
        head.remaining -= issued;
        orderRemaining[head.index] -= issued;
        if (head.remaining === 0) {
          lastFulfilled[head.index] = quarter;
          backlog.shift();
        }
      }
      if (quarter < scoredEnd) {
        const quantityDemanded = demand[quarter];
        if (quantityDemanded > 0) {
          orders += 1;
          const index = orderRemaining.length;
          orderRemaining.push(quantityDemanded);
          lastFulfilled.push(quantityDemanded <= stock ? quarter : null);
          const issued = Math.min(stock, quantityDemanded);
          stock -= issued;
          if (issued === quantityDemanded) fills += 1;
          else backlog.push({ index, remaining: quantityDemanded - issued });
        }
        inventoryUnits += stock;
        const inventoryPosition = stock + [...pipeline.values()].reduce((a, b) => a + b, 0) - orderRemaining.reduce((a, b) => a + b, 0);
        if (inventoryPosition <= reorder) {
          const purchase = reorder + quantity - inventoryPosition;
          pipeline.set(quarter + item.lead, (pipeline.get(quarter + item.lead) || 0) + purchase);
          buys += 1;
        }
      }
    }
    let tail = horizon;
    while (backlog.length) {
      stock += pipeline.get(tail) || 0;
      while (stock > 0 && backlog.length) {
        const head = backlog[0];
        const issued = Math.min(stock, head.remaining);
        stock -= issued;
        head.remaining -= issued;
        orderRemaining[head.index] -= issued;
        if (!head.remaining) {
          lastFulfilled[head.index] = tail;
          backlog.shift();
        }
      }
      tail += 1;
    }
    for (let i = 0; i < lastFulfilled.length; i += 1) {
      if (lastFulfilled[i] === null) throw new Error("Receipt tail did not fulfill an order");
      const arrival = orderArrivalQuarter(i, demand, scoredEnd);
      waited += lastFulfilled[i] - arrival;
    }
    return { inventory: item.price * inventoryUnits / scoredEnd, buys, orders, fills, waited };
  }
  function orderArrivalQuarter(orderIndex, demand, scoredEnd) {
    let seen = -1;
    for (let q = 0; q < scoredEnd; q += 1) if (demand[q] > 0 && ++seen === orderIndex) return q;
    throw new Error("Customer order index is outside the scored demand window");
  }
  function evaluateCandidate(items, trials, group, multiplier, quantity) {
    let inventory = 0, buys = 0, orders = 0, fills = 0, waited = 0;
    const selected = items.filter((item) => item.group === group);
    for (const trial of trials) for (let i = 0; i < selected.length; i += 1) {
      const item = selected[i];
      const result = simulateItem(item, trial[items.indexOf(item)], Math.ceil(multiplier * item.peak), quantity);
      inventory += result.inventory;
      buys += result.buys;
      orders += result.orders;
      fills += result.fills;
      waited += result.waited;
    }
    return { group, multiplier, quantity, inventory: inventory / trials.length,
      buys: buys * 4 / trials.length, orders: Math.round(orders / trials.length),
      fills: Math.round(fills / trials.length), waited: Math.round(waited / trials.length) };
  }
  function candidateTable(data) {
    const rows = [];
    for (let group = 0; group < 7; group += 1) for (const multiplier of M_VALUES) for (const quantity of Q_VALUES[group])
      rows.push(evaluateCandidate(data.items, data.trials, group, multiplier, quantity));
    return rows;
  }
  function evaluateBaseline(data) {
    let inventory = 0, buys = 0, orders = 0, fills = 0, waited = 0;
    for (const trial of data.trials) for (let i = 0; i < data.items.length; i += 1) {
      const item = data.items[i];
      const reorder = Math.ceil(item.lead * item.mean + Math.sqrt(item.lead) * item.std);
      const quantity = Math.max(1, Math.ceil(4 * item.mean));
      const result = simulateItem(item, trial[i], reorder, quantity);
      inventory += result.inventory; buys += result.buys; orders += result.orders; fills += result.fills; waited += result.waited;
    }
    const n = data.trials.length;
    return { inventory: inventory / n, buys: buys * 4 / n, orders: Math.round(orders / n), fills: Math.round(fills / n), waited: Math.round(waited / n) };
  }
  function solve(table, workload, waitDays) {
    const groups = Array.from({ length: 7 }, (_, i) => table.filter((row) => row.group === i));
    let states = [{ inv: 0, buys: 0, waited: 0, orders: 0, fills: 0, picks: [] }];
    for (const rows of groups) {
      const expanded = [];
      for (const state of states) for (const row of rows) {
        const next = { inv: state.inv + row.inventory, buys: state.buys + row.buys,
          waited: state.waited + row.waited, orders: state.orders + row.orders,
          fills: state.fills + row.fills, picks: [...state.picks, row] };
        if (next.buys <= workload && QUARTER_DAYS * next.waited <= waitDays * next.orders)
          expanded.push(next);
      }
      const best = new Map();
      for (const state of expanded) {
        const key = `${Math.round(state.buys * 1000)}:${state.waited}:${state.orders}`;
        const previous = best.get(key);
        if (!previous || state.inv < previous.inv) best.set(key, state);
      }
      states = [...best.values()];
    }
    const feasible = states.filter((state) => state.buys <= workload && QUARTER_DAYS * state.waited <= waitDays * state.orders);
    feasible.sort((a, b) => a.inv - b.inv || a.waited - b.waited || a.buys - b.buys);
    return feasible[0] || null;
  }
  function formatMoney(value) { return `$${Math.round(value).toLocaleString("en-US")}`; }
  function waitDays(result) { return result.orders ? QUARTER_DAYS * result.waited / result.orders : 0; }
  function renderChart(points, selected, baseline) {
    const svg = $("chart");
    const width = 760, height = 330, pad = { left: 72, right: 22, top: 20, bottom: 48 };
    const xs = points.map((p) => p.inv).concat([baseline.inventory, selected.inv]);
    const ys = points.map(waitDays).concat([waitDays(baseline), waitDays(selected)]);
    let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    if (minX === maxX) maxX += 1; if (minY === maxY) maxY += 1;
    const sx = (x) => pad.left + (x - minX) / (maxX - minX) * (width - pad.left - pad.right);
    const sy = (y) => height - pad.bottom - (y - minY) / (maxY - minY) * (height - pad.top - pad.bottom);
    let content = "";
    for (let tick = 0; tick <= 4; tick += 1) {
      const x = minX + (maxX - minX) * tick / 4;
      const y = minY + (maxY - minY) * tick / 4;
      content += `<line class="gridline" x1="${sx(x)}" y1="${pad.top}" x2="${sx(x)}" y2="${height - pad.bottom}"/><text class="axis-text" x="${sx(x)}" y="${height - 20}" text-anchor="middle">${formatMoney(x)}</text>`;
      content += `<line class="gridline" x1="${pad.left}" y1="${sy(y)}" x2="${width - pad.right}" y2="${sy(y)}"/><text class="axis-text" x="${pad.left - 12}" y="${sy(y) + 3}" text-anchor="end">${y.toFixed(0)}d</text>`;
    }
    content += `<line class="axis" x1="${pad.left}" y1="${height-pad.bottom}" x2="${width-pad.right}" y2="${height-pad.bottom}"/><line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height-pad.bottom}"/>`;
    const curve = [...points].sort((a, b) => a.inv - b.inv).map((p) => `${sx(p.inv)},${sy(waitDays(p))}`).join(" ");
    content += `<polyline class="frontier" points="${curve}"/>`;
    points.forEach((p) => { content += `<circle class="point" cx="${sx(p.inv)}" cy="${sy(waitDays(p))}" r="4"><title>${formatMoney(p.inv)}, ${waitDays(p).toFixed(1)} wait days, ${Math.round(p.buys)} buys/year</title></circle>`; });
    content += `<circle class="baseline-point" cx="${sx(baseline.inventory)}" cy="${sy(waitDays(baseline))}" r="6"><title>Forecast baseline</title></circle>`;
    content += `<circle class="selected-point" cx="${sx(selected.inv)}" cy="${sy(waitDays(selected))}" r="7"><title>Selected policy</title></circle>`;
    content += `<text class="axis-text" x="${(pad.left + width-pad.right)/2}" y="${height-3}" text-anchor="middle">Average on-hand inventory value</text><text class="axis-text" transform="translate(15 ${(height+pad.top-pad.bottom)/2}) rotate(-90)" text-anchor="middle">Wait days per customer order</text>`;
    svg.innerHTML = content;
  }
  function render() {
    $("status").classList.remove("visible");
    const seed = Math.max(0, Number($("seed").value) || 11);
    const data = generatePortfolio(seed);
    const table = candidateTable(data);
    const baseline = evaluateBaseline(data);
    const workload = Number($("workload").value);
    const waitLimit = Number($("wait").value);
    const selected = solve(table, workload, waitLimit);
    if (!selected) {
      $("status").textContent = "No candidate policy meets both limits. Increase the workload limit or allow more customer wait.";
      $("status").classList.add("visible");
      return;
    }
    current = { data, table, baseline, selected };
    const days = waitDays(selected), baselineDays = waitDays(baseline);
    $("inventory-metric").textContent = formatMoney(selected.inv);
    $("inventory-delta").textContent = `${formatMoney(selected.inv - baseline.inventory)} vs forecast baseline`;
    $("fill-metric").textContent = `${(100 * selected.fills / selected.orders).toFixed(1)}%`;
    $("fill-delta").textContent = `${((selected.fills / selected.orders - baseline.fills / baseline.orders) * 100).toFixed(1)} pts vs baseline`;
    $("wait-metric").textContent = `${days.toFixed(1)} days`;
    $("wait-delta").textContent = `${(days - baselineDays).toFixed(1)} days vs baseline`;
    $("buys-metric").textContent = `${Math.round(selected.buys).toLocaleString()} / year`;
    $("buys-delta").textContent = `${Math.round(selected.buys - baseline.buys).toLocaleString()} vs baseline`;
    const caps = [...new Set([workload, baseline.buys, selected.buys * 0.75, selected.buys, selected.buys * 1.15])];
    const waitCaps = [...new Set([waitLimit, baselineDays, days * 0.8, days, days * 1.2])];
    const frontier = [];
    for (const cap of caps) for (const waitCap of waitCaps) {
      const point = solve(table, cap, waitCap);
      if (point && !frontier.some((p) => p.inv === point.inv && p.waited === point.waited && p.buys === point.buys)) frontier.push(point);
    }
    renderChart(frontier, selected, baseline);
    const checked = [...document.querySelectorAll(".group-filter")].filter((input) => input.checked).map((input) => Number(input.value));
    $("policy-count").textContent = `${checked.length} of 7 groups · ${data.items.length.toLocaleString()} items`;
    $("policy-table").innerHTML = selected.picks.filter((p) => checked.includes(p.group)).map((p) => {
      const n = data.items.filter((item) => item.group === p.group).length;
      return `<tr><td>Group ${p.group + 1}</td><td>${n}</td><td>${p.multiplier}</td><td>${p.quantity}</td><td>${formatMoney(p.inv)}</td><td>${Math.round(p.buys)}</td></tr>`;
    }).join("");
    $("items-table").innerHTML = data.items.filter((item) => checked.includes(item.group)).slice(0, 300).map((item) => {
      const policy = selected.picks[item.group];
      const reorder = Math.ceil(policy.multiplier * item.peak);
      return `<tr><td>${item.id}</td><td>$${item.price.toFixed(2)}</td><td>${item.group + 1}</td><td>${item.peak}</td><td>${policy.multiplier}</td><td>${policy.quantity}</td><td>${reorder}</td><td>${reorder + policy.quantity}</td></tr>`;
    }).join("");
  }

  function fixture() {
    const histories = [
      [...Array(15).fill(0), ...Array(3).fill(1), ...Array(2).fill(3)],
      [...Array(14).fill(0), ...Array(4).fill(2), ...Array(2).fill(5)],
      [...Array(16).fill(0), ...Array(2).fill(1), ...Array(2).fill(4)],
      [...Array(16).fill(0), ...Array(2).fill(1), ...Array(2).fill(3)],
      [...Array(15).fill(0), ...Array(4).fill(1), 5],
      [...Array(15).fill(0), ...Array(3).fill(2), ...Array(2).fill(4)],
    ];
    const demands = [[0,3,1,3],[2,5,0,2],[4,0,1,4],[1,3,3,3],[5,1,0,1],[0,2,4,2]];
    const prices = [2,3,4,10,12,15], leads = [1,2,1,2,1,2];
    const items = histories.map((history, i) => ({ id: "ABCDEF"[i], price: prices[i], lead: leads[i], group: i < 3 ? 0 : 1,
      history, peak: Math.max(...history), mean: history.reduce((a,b)=>a+b,0)/20,
      std: Math.sqrt(history.reduce((a,x)=>a+(x-history.reduce((u,v)=>u+v,0)/20)**2,0)/20) }));
    return { items, trials: [demands] };
  }
  function checkSmallCase() {
    const data = fixture();
    const expected = [
      [0,0,2,4.5,7,4,6],[0,0,5,11.5,3,7,3],[0,.5,2,15.5,7,7,2],[0,.5,5,28.5,3,9,0],
      [1,0,1,6.75,10,3,13],[1,0,3,35,5,4,8],[1,.5,1,50,10,4,7],[1,.5,3,87.5,5,6,5],
    ];
    const actual = expected.map(([group,m,q]) => evaluateCandidate(data.items,data.trials,group,m,q));
    let ok = actual.every((row,i) => Math.abs(row.inventory-expected[i][3])<1e-9 && row.buys===expected[i][4] && row.fills===expected[i][5] && row.waited===expected[i][6]);
    const base = evaluateBaseline(data);
    ok = ok && Math.abs(base.inventory-109.75)<1e-9 && base.buys===11 && base.fills===14 && base.waited===5;
    $("check-table").innerHTML = actual.map((row) => `<tr><td>${row.group+1}</td><td>${row.multiplier}</td><td>${row.quantity}</td><td>${formatMoney(row.inventory)}</td><td>${row.buys}</td><td>${row.fills}/${row.orders}</td><td>${row.waited}</td></tr>`).join("");
    const smallRows = expected.map((entry) => ({group:entry[0],multiplier:entry[1],quantity:entry[2],inventory:entry[3],buys:entry[4],fills:entry[5],waited:entry[6],orders:entry[0]===0?9:10}));
    for (const [workload,waitQ,inv] of [[12,7,103],[13,7,78.5],[12,8,63.5],[11,5,116]]) {
      const result = solve(smallRows,workload,QUARTER_DAYS*waitQ/19);
      ok = ok && result && Math.abs(result.inv-inv)<1e-9;
    }
    ok = ok && !solve(smallRows,7,QUARTER_DAYS*19/19) && !solve(smallRows,17,QUARTER_DAYS*4/19);
    $("check-status").textContent = ok ? `Passed · baseline ${formatMoney(base.inventory)}, ${base.buys} buys/year, ${base.fills}/${base.orders} immediate fills.` : "Failed · inspect candidate metrics and fixture expectations.";
    $("check-status").style.color = ok ? "#245b49" : "#a3362d";
  }

  for (let group = 0; group < 7; group += 1) {
    $("group-filters").insertAdjacentHTML("beforeend", `<label class="group-check"><input class="group-filter" type="checkbox" value="${group}" checked> G${group+1}</label>`);
  }
  $("workload").addEventListener("input", () => { $("workload-value").textContent = Number($("workload").value).toLocaleString(); });
  $("wait").addEventListener("input", () => { $("wait-value").textContent = `${$("wait").value} days`; });
  $("run").addEventListener("click", render);
  $("group-filters").addEventListener("change", () => { if (current) {
    const checked = [...document.querySelectorAll(".group-filter")].filter((input)=>input.checked).map((input)=>Number(input.value));
    $("policy-count").textContent = `${checked.length} of 7 groups · ${current.data.items.length.toLocaleString()} items`;
    $("policy-table").innerHTML = current.selected.picks.filter((p)=>checked.includes(p.group)).map((p)=>`<tr><td>Group ${p.group+1}</td><td>${current.data.items.filter((i)=>i.group===p.group).length}</td><td>${p.multiplier}</td><td>${p.quantity}</td><td>${formatMoney(p.inventory)}</td><td>${Math.round(p.buys)}</td></tr>`).join("");
    $("items-table").innerHTML = current.data.items.filter((item)=>checked.includes(item.group)).slice(0,300).map((item)=>{const p=current.selected.picks[item.group],s=Math.ceil(p.multiplier*item.peak);return `<tr><td>${item.id}</td><td>$${item.price.toFixed(2)}</td><td>${item.group+1}</td><td>${item.peak}</td><td>${p.multiplier}</td><td>${p.quantity}</td><td>${s}</td><td>${s+p.quantity}</td></tr>`}).join("");
  }});
  $("check-case").addEventListener("click", checkSmallCase);
  render();
})();
