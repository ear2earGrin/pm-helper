// Entry point for the standalone Options page.
//
// The main trading app is now the prebuilt crypto-entry-checker bundle (a React
// SPA under trading/index.html). The options payoff tool predates that and has
// no equivalent upstream, so it lives on as its own page built from the same
// source it always used: ui/options.js + options/*.js, no framework.
//
// Bundled to a classic script by scripts/build_trading_pages.sh — same approach the
// old trading section used, so it loads like the site's other scripts.
import { mount } from "./options.js";

const root = document.getElementById("options-root");
if (root) mount(root);
