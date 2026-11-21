# Peak Policy inventory prototype

Static, browser-only prototype based on Bachman et al. (2016), “PNG: Effective Inventory Control for Items with Highly Variable Demand,” *Interfaces* 46(1), 18–32. The model follows Peak Policy and Appendix A. It excludes Appendix B Next Gen.

## Run locally

Open `index.html` in a modern browser. The application uses plain HTML, CSS, and JavaScript with no Python, package manager, build step, server, or external JavaScript dependency. The operating model, generated data, and simulation execute in the user's browser. No demand or item information is sent to a server.

## Publish with GitHub Pages

1. Create a GitHub repository and upload `index.html`, `styles.css`, `app.js`, and this README.
2. In the repository settings, open **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select the default branch and `/ (root)`, then save.
4. Open the Pages URL shown by GitHub.

The page references the paper DOI and an optional Google font stylesheet. The app itself does not make network requests for data, scripts, solvers, or analytics. For fully offline use, remove the Google Fonts `@import` in `styles.css`. GitHub Pages hosting itself requires loading the published page from GitHub.

## Model and assumptions

Each item's peak is the maximum quarterly demand from its 20-quarter history. A price-group candidate `(M, Q)` sets `s = ceil(M × peak)` and `S = s + Q`. One candidate is chosen per group to minimize portfolio inventory value under workload and customer wait constraints. The browser uses dynamic programming to find the minimum-inventory feasible combination across seven groups. Demand is generated from a seeded random stream and resampled for 20 scenarios shared across candidates.

The portfolio has 2,000 items and price boundaries at the 10th, 25th, 50th, 75th, 90th, and 95th percentiles. Synthetic prices, sparse-demand rates and sizes, lead times, policy candidate grids, and forecast baseline settings are illustrative. The paper's item-level DLA histories are proprietary. One replenishment action proxies buyer workload. Customer wait is measured in quarters and converted at 91.25 days per quarter. Full-order fill rate counts orders filled completely on arrival.

The baseline uses `s = ceil(L × mean + sqrt(L) × population_std)` and `Q = max(1, ceil(4 × mean))`. The annual workload and wait limits are selected in the interface.

## Verification

Open **Small-case verification** and select **Run six-item checks**. It compares eight candidate outcomes, the Forecast + Safety Stock baseline, four exact binary policy optima, and two infeasible settings against the deterministic six-item fixture. No random resampling is involved in this check.

## Citation

Bachman, T. C., P. J. Williams, K. M. Cheman, J. Curtis, and R. Carroll (2016). “PNG: Effective Inventory Control for Items with Highly Variable Demand.” *Interfaces*, 46(1), 18–32. https://doi.org/10.1287/inte.2015.0829
