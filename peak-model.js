(() => {
  "use strict";

  const QUARTER_DAYS = 365 / 4;
  const HISTORY_QUARTERS = 20;
  const WARMUP_QUARTERS = 20;
  const SCORED_QUARTERS = 20;
  const TRIALS = 20;
  const MULTIPLIERS = [0, 0.25, 0.5, 0.75, 1, 1.5];
  const QUANTITIES = [
    [2, 4, 8, 16], [2, 4, 8, 12], [1, 3, 6, 10], [1, 3, 5, 8],
    [1, 2, 4, 6], [1, 2, 3, 5], [1, 2, 3, 4],
  ];
  const PRICE_BREAKS = [0.10, 0.25, 0.50, 0.75, 0.90, 0.95];

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

  function describeHistory(history) {
    const mean = history.reduce((sum, quantity) => sum + quantity, 0) / history.length;
    const variance = history.reduce((sum, quantity) => sum + (quantity - mean) ** 2, 0) / history.length;
    return { peak: Math.max(...history), mean, std: Math.sqrt(variance) };
  }

  function generatePortfolio(seed, count = 2000) {
    const random = rng(seed);
    const items = Array.from({ length: count }, (_, index) => {
      const price = Math.round(Math.exp(random() * Math.log(1000)) * 100) / 100;
      const activity = 0.08 + random() * 0.27;
      let mask;
      let activeCount;
      do {
        mask = Array.from({ length: HISTORY_QUARTERS }, () => random() < activity);
        activeCount = mask.filter(Boolean).length;
      } while (activeCount < 1 || activeCount > 9);
      const history = mask.map((active) => {
        if (!active) return 0;
        return random() < 0.1 ? 8 + poisson(random, 6) : 1 + poisson(random, 2);
      });
      const lead = random() < 0.35 ? 2 : 1;
      const id = `PNG-${String(index + 1).padStart(4, "0")}`;
      return { id, price, lead, history, ...describeHistory(history) };
    });
    items.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
    const cuts = PRICE_BREAKS.map((fraction) => Math.ceil(fraction * count));
    items.forEach((item, index) => {
      item.group = cuts.filter((cut) => index >= cut).length;
    });
    const draw = rng((seed ^ 0x08292016) >>> 0);
    const trials = Array.from({ length: TRIALS }, () => items.map(({ history }) => (
      Array.from({ length: WARMUP_QUARTERS + SCORED_QUARTERS },
        () => history[Math.floor(draw() * HISTORY_QUARTERS)])
    )));
    return { items, trials, warmup: WARMUP_QUARTERS };
  }

  function simulateItem(item, demand, reorder, quantity, warmup, scheduled, pending) {
    const target = reorder + quantity;
    scheduled.fill(0);
    let firstPending = 0;
    let pendingCount = 0;
    let received = target;
    let demanded = 0;
    let position = target;
    let inventoryUnits = 0;
    let buys = 0;
    let orders = 0;
    let fills = 0;
    let waited = 0;

    for (let quarter = 0; quarter < demand.length + item.lead; quarter += 1) {
      received += scheduled[quarter];
      // Each order completes when cumulative supply reaches its FIFO demand threshold.
      while (firstPending < pendingCount && received >= pending[firstPending]) firstPending += 1;

      if (quarter < demand.length) {
        const units = demand[quarter];
        const scoring = quarter >= warmup;
        demanded += units;
        position -= units;
        if (scoring) {
          inventoryUnits += Math.max(received - demanded, 0);
          if (units > 0) {
            orders += 1;
            if (received >= demanded) fills += 1;
            else pending[pendingCount++] = demanded;
          }
        }
        if (position <= reorder) {
          scheduled[quarter + item.lead] = target - position;
          position = target;
          if (scoring) buys += 1;
        }
      }
      // Open scored orders each accrue one more quarter of wait.
      waited += pendingCount - firstPending;
    }
    if (firstPending !== pendingCount) throw new Error("The receipt tail did not clear all scored orders.");
    return { inventoryUnits, buys, orders, fills, waited };
  }

  function evaluate(items, trials, warmup, indices, levels) {
    const quarters = trials[0][0].length;
    const maxLead = Math.max(...items.map((item) => item.lead));
    const scheduled = new Int32Array(quarters + maxLead);
    const pending = new Int32Array(quarters);
    let inventoryCents = 0;
    let buys = 0, orders = 0, fills = 0, waited = 0;
    for (const index of indices) {
      const item = items[index];
      const [reorder, quantity] = levels(item);
      const unitCents = Math.round(item.price * 100);
      for (const trial of trials) {
        const result = simulateItem(item, trial[index], reorder, quantity, warmup, scheduled, pending);
        inventoryCents += unitCents * result.inventoryUnits;
        buys += result.buys;
        orders += result.orders;
        fills += result.fills;
        waited += result.waited;
      }
    }
    const exposure = trials.length * (quarters - warmup);
    return { inventory: inventoryCents / (100 * exposure), buys: 4 * buys / exposure, orders, fills, waited };
  }

  function groupIndices(items) {
    const groups = new Map();
    items.forEach((item, index) => {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(index);
    });
    return groups;
  }

  function peakMetrics(items, trials, warmup, indices, group, multiplier, quantity) {
    return {
      group, multiplier, quantity,
      ...evaluate(items, trials, warmup, indices, (item) => [Math.ceil(multiplier * item.peak), quantity]),
    };
  }

  function evaluateCandidate(items, trials, group, multiplier, quantity, warmup = 0) {
    return peakMetrics(items, trials, warmup, groupIndices(items).get(group), group, multiplier, quantity);
  }

  function* candidateRows({ items, trials, warmup = 0 }) {
    for (const [group, indices] of groupIndices(items)) {
      for (const multiplier of MULTIPLIERS) {
        for (const quantity of QUANTITIES[group]) {
          yield peakMetrics(items, trials, warmup, indices, group, multiplier, quantity);
        }
      }
    }
  }

  function candidateTable(data) {
    return Array.from(candidateRows(data));
  }

  function evaluateBaseline({ items, trials, warmup = 0 }) {
    return evaluate(items, trials, warmup, items.keys(), ({ lead, mean, std }) => [
      Math.ceil(lead * mean + Math.sqrt(lead) * std), Math.max(1, Math.ceil(4 * mean)),
    ]);
  }

  function fixture() {
    const historyCounts = [
      [[0, 15], [1, 3], [3, 2]], [[0, 14], [2, 4], [5, 2]], [[0, 16], [1, 2], [4, 2]],
      [[0, 16], [1, 2], [3, 2]], [[0, 15], [1, 4], [5, 1]], [[0, 15], [2, 3], [4, 2]],
    ];
    const prices = [2, 3, 4, 10, 12, 15];
    const leads = [1, 2, 1, 2, 1, 2];
    const demands = [[0, 3, 1, 3], [2, 5, 0, 2], [4, 0, 1, 4], [1, 3, 3, 3], [5, 1, 0, 1], [0, 2, 4, 2]];
    const items = historyCounts.map((counts, index) => {
      const history = counts.flatMap(([units, count]) => Array(count).fill(units));
      return {
        id: "ABCDEF"[index], price: prices[index], lead: leads[index],
        group: index < 3 ? 0 : 1, history, ...describeHistory(history),
      };
    });
    return { items, trials: [demands], warmup: 0 };
  }

  globalThis.PeakModel = {
    QUARTER_DAYS, generatePortfolio, candidateRows, candidateTable, evaluateBaseline, evaluateCandidate, fixture,
  };
})();
