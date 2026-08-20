// Entry point for the standalone Watchlist page. See ui/options-entry.js —
// same pattern: an ES-module view bundled to a classic script by
// scripts/build_trading_pages.sh.
import { mount } from "./watchlist.js";

const root = document.getElementById("watchlist-root");
if (root) mount(root);
