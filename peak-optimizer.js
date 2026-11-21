(() => {
  "use strict";

  const DAYS_PER_QUARTER = 365 / 4;
  const comparePolicies = (a, b) => a.inv - b.inv || a.waited - b.waited || a.buys - b.buys;

  function nondominated(states) {
    states.sort(comparePolicies);
    const buyLevels = [...new Set(states.map((state) => state.buys))].sort((a, b) => a - b);
    const ranks = new Map(buyLevels.map((buys, i) => [buys, i + 1]));
    const minWait = new Float64Array(buyLevels.length + 1).fill(Infinity);
    const frontier = [];
    for (const state of states) {
      const rank = ranks.get(state.buys);
      let priorWait = Infinity;
      // A Fenwick tree finds the lowest wait at or below this workload.
      for (let i = rank; i > 0; i -= i & -i) priorWait = Math.min(priorWait, minWait[i]);
      if (priorWait <= state.waited) continue;
      frontier.push(state);
      for (let i = rank; i < minWait.length; i += i & -i) minWait[i] = Math.min(minWait[i], state.waited);
    }
    return frontier;
  }

  function buildFrontier(table) {
    const groups = new Map();
    for (const row of table) {
      if (!groups.has(row.group)) groups.set(row.group, []);
      groups.get(row.group).push(row);
    }
    let frontier = [{ inv: 0, buys: 0, waited: 0, orders: 0, fills: 0, picks: [] }];
    for (const group of [...groups.keys()].sort((a, b) => a - b)) {
      const rows = groups.get(group);
      if (rows.some((row) => row.orders !== rows[0].orders)) {
        throw new Error("Every policy in a price group must use the same demand paths.");
      }
      const candidates = nondominated(rows.map((row) => ({
        inv: row.inventory, buys: row.buys, waited: row.waited, row,
      })));
      const next = [];
      for (const state of frontier) {
        for (const { row } of candidates) {
          next.push({
            inv: state.inv + row.inventory,
            buys: state.buys + row.buys,
            waited: state.waited + row.waited,
            orders: state.orders + row.orders,
            fills: state.fills + row.fills,
            picks: [...state.picks, row],
          });
        }
      }
      // Every remaining group adds the same metrics to either partial portfolio,
      // so a dominated partial portfolio cannot improve a later solution.
      frontier = nondominated(next);
    }
    return frontier;
  }

  function solve(frontier, workload, waitDays) {
    return frontier.find((state) => state.buys <= workload + 1e-9
      && state.waited * DAYS_PER_QUARTER <= waitDays * state.orders + 1e-9) ?? null;
  }

  globalThis.PeakOptimizer = { buildFrontier, solve };
})();
