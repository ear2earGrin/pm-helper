// Trading section router. No framework: a tiny hash router swaps the active view into
// #trading-root and runs the previous view's cleanup (e.g. disposing the chart).
// Deep-linkable: /trading/#/scanner, /trading/#/backtest, /trading/#/log.

import { mount as mountScanner } from "./scanner.js";
import { mount as mountBacktest } from "./backtest.js";
import { mount as mountTradeLog } from "./tradelog.js";
import { mount as mountOptions } from "./options.js";

// Lattice is a standalone, self-contained page; embed it in-place via an iframe
// so it behaves like the other Trading Desk tabs (deep-linkable at #/lattice).
function mountLattice(root) {
  root.innerHTML = "";
  const f = document.createElement("iframe");
  f.src = "../lattice.html?embed=1";
  f.title = "Lattice — options pricer";
  f.style.cssText = "width:100%;border:0;display:block;min-height:calc(100vh - 120px);background:#05080F;";
  root.appendChild(f);
  return () => { root.innerHTML = ""; };
}

const ROUTES = {
  scanner: mountScanner,
  backtest: mountBacktest,
  log: mountTradeLog,
  options: mountOptions,
  lattice: mountLattice,
};
const DEFAULT = "scanner";

function currentRoute() {
  const key = (window.location.hash || "").replace(/^#\/?/, "").trim();
  return ROUTES[key] ? key : DEFAULT;
}

function init() {
  const root = document.getElementById("trading-root");
  if (!root) return;

  const links = {};
  document.querySelectorAll("[data-route]").forEach((a) => { links[a.dataset.route] = a; });

  let cleanup = null;
  function navigate() {
    const key = currentRoute();
    if (typeof cleanup === "function") {
      try { cleanup(); } catch { /* empty */ }
    }
    cleanup = ROUTES[key](root) || null;
    for (const [k, a] of Object.entries(links)) {
      a.classList.toggle("tr-subnav--active", k === key);
    }
    window.scrollTo({ top: 0 });
  }

  window.addEventListener("hashchange", navigate);
  navigate();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
