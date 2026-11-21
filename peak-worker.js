"use strict";

importScripts("peak-model.js?v=2", "peak-optimizer.js?v=2");

self.onmessage = ({ data: seed }) => {
  try {
    const portfolio = PeakModel.generatePortfolio(seed);
    const baseline = PeakModel.evaluateBaseline(portfolio);
    const frontier = PeakOptimizer.buildFrontier(PeakModel.candidateTable(portfolio));
    const items = portfolio.items.map(({ id, price, group, peak }) => ({ id, price, group, peak }));
    self.postMessage({ items, baseline, frontier });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
