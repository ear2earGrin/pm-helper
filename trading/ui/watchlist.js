// Watchlist view — a plain list of coins you intend to buy, with the three
// numbers worth glancing at: 24h change, 24h volume and market cap.
//
// Deliberately not a scanner. It holds no signals and makes no judgements; it
// is a memory aid, so the only state it keeps is which coins you saved and an
// optional note about why.

import { el, clear } from "./dom.js";
import { fmt } from "./format.js";
import { searchCoins, fetchMarkets } from "../data/coingecko.js";
import { load, save, add, remove, setNote } from "../data/watchlist.js";

/** 1.27T / 28.4B / 950M / 12.3K — market caps and volumes are unreadable in full. */
function compact(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${(n / size).toFixed(abs / size >= 100 ? 0 : 1)}${suffix}`;
  }
  return fmt(n, 0);
}

/** Sub-cent coins need more decimals than BTC does. */
function price(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1000) return `$${fmt(n, 0)}`;
  if (n >= 1) return `$${fmt(n, 2)}`;
  if (n >= 0.01) return `$${fmt(n, 4)}`;
  return `$${fmt(n, 8)}`;
}

function pct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function mount(root) {
  let entries = load();
  let stats = {};
  let status = null; // { kind: 'error'|'ok'|'warn', text }
  let lastUpdated = null;
  let results = [];
  let searching = false;

  const searchHost = el("div", { class: "tr-wl-search" });
  const resultsHost = el("div", { class: "tr-wl-results" });
  const tableHost = el("div", { class: "tr-table-wrap" });
  const statusHost = el("div", { class: "tr-status-line" });

  function setStatus(kind, text) {
    status = text ? { kind, text } : null;
    renderStatus();
  }

  function renderStatus() {
    clear(statusHost);
    if (status) {
      statusHost.appendChild(
        el("span", { class: `tr-status tr-status--${status.kind}` }, status.text),
      );
    }
    if (lastUpdated) {
      statusHost.appendChild(
        el("span", { class: "tr-mut" }, `Updated ${lastUpdated.toLocaleTimeString()}`),
      );
    }
  }

  async function refresh() {
    if (!entries.length) {
      stats = {};
      lastUpdated = null;
      setStatus(null, null);
      renderTable();
      return;
    }
    setStatus("warn", "Loading…");
    try {
      stats = await fetchMarkets(entries.map((e) => e.id));
      lastUpdated = new Date();
      const missing = entries.filter((e) => !stats[e.id]).length;
      setStatus(
        missing ? "warn" : "ok",
        missing ? `${missing} coin(s) returned no data.` : null,
      );
    } catch (err) {
      setStatus("error", err.message);
    }
    renderTable();
  }

  function persist() {
    if (!save(entries)) {
      setStatus("warn", "Could not save — browser storage is unavailable.");
    }
  }

  function addCoin(coin) {
    const before = entries.length;
    entries = add(entries, coin);
    if (entries.length === before) {
      setStatus("warn", `${coin.name} is already on the list.`);
      return;
    }
    persist();
    results = [];
    renderResults();
    renderTable();
    refresh();
  }

  function removeCoin(id) {
    entries = remove(entries, id);
    persist();
    renderTable();
  }

  // ── Search ────────────────────────────────────────────────────────────
  let searchTimer = null;
  const input = el("input", {
    class: "tr-input",
    placeholder: "Search a coin — name or symbol, e.g. solana or SOL",
    onInput: (e) => {
      const q = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(q), 300);
    },
    onKeydown: (e) => {
      if (e.key === "Enter") {
        clearTimeout(searchTimer);
        runSearch(e.target.value);
      }
    },
  });

  async function runSearch(q) {
    if (!String(q || "").trim()) {
      results = [];
      renderResults();
      return;
    }
    searching = true;
    renderResults();
    try {
      results = await searchCoins(q);
      if (!results.length) setStatus("warn", `Nothing found for "${q}".`);
      else setStatus(null, null);
    } catch (err) {
      results = [];
      setStatus("error", err.message);
    }
    searching = false;
    renderResults();
  }

  function renderResults() {
    clear(resultsHost);
    if (searching) {
      resultsHost.appendChild(el("div", { class: "tr-mut" }, "Searching…"));
      return;
    }
    if (!results.length) return;
    for (const c of results) {
      resultsHost.appendChild(
        el("button", { class: "tr-wl-result", type: "button", onClick: () => addCoin(c) },
          el("span", { class: "tr-strong" }, c.symbol),
          el("span", { class: "tr-mut" }, c.name),
          c.rank ? el("span", { class: "tr-mut" }, `#${c.rank}`) : null,
          el("span", { class: "tr-wl-add" }, "+ ADD"),
        ),
      );
    }
  }

  // ── Table ─────────────────────────────────────────────────────────────
  function renderTable() {
    clear(tableHost);
    if (!entries.length) {
      tableHost.appendChild(
        el("div", { class: "tr-empty" },
          "Nothing saved yet. Search above and add the coins you are planning to buy."),
      );
      return;
    }

    const head = el("div", { class: "tr-wl-row tr-wl-row--head" },
      el("span", null, "COIN"),
      el("span", null, "PRICE"),
      el("span", null, "24H"),
      el("span", null, "24H VOLUME"),
      el("span", null, "MARKET CAP"),
      el("span", null, "NOTE"),
      el("span", null, ""),
    );

    const rows = entries.map((e) => {
      const s = stats[e.id];
      const ch = s ? s.change24h : null;
      const chClass =
        ch === null || ch === undefined || !Number.isFinite(ch)
          ? "tr-mut"
          : ch > 0 ? "tr-pos" : ch < 0 ? "tr-neg" : "tr-mut";

      return el("div", { class: "tr-wl-row" },
        el("span", null,
          el("span", { class: "tr-strong" }, e.symbol || "—"),
          el("span", { class: "tr-mut tr-wl-name" }, e.name),
        ),
        el("span", null, price(s?.price)),
        el("span", { class: chClass }, pct(ch)),
        el("span", null, s ? `$${compact(s.volume24h)}` : "—"),
        el("span", null, s ? `$${compact(s.marketCap)}` : "—"),
        el("span", null,
          el("input", {
            class: "tr-input tr-wl-note",
            value: e.note,
            placeholder: "why you're watching",
            onChange: (ev) => {
              entries = setNote(entries, e.id, ev.target.value);
              persist();
            },
          }),
        ),
        el("button", {
          class: "tr-act tr-act--danger tr-wl-x",
          type: "button",
          title: `Remove ${e.name}`,
          onClick: () => removeCoin(e.id),
        }, "×"),
      );
    });

    tableHost.appendChild(el("div", { class: "tr-wl-table" }, head, ...rows));
  }

  // ── Layout ────────────────────────────────────────────────────────────
  searchHost.appendChild(input);

  const view = el("div", { class: "tr-view" },
    el("div", { class: "tr-header" },
      el("div", null,
        el("h1", { class: "tr-title" }, "WATCHLIST"),
        el("p", { class: "tr-subtitle" },
          "Coins you are planning to buy, with 24h change, 24h volume and market cap. " +
          "Saved in this browser only — no account, and it never places an order."),
      ),
      el("div", { class: "tr-header-actions" },
        el("button", { class: "tr-act", type: "button", onClick: refresh }, "REFRESH"),
      ),
    ),
    el("div", { class: "tr-card" }, searchHost, resultsHost),
    statusHost,
    tableHost,
    el("p", { class: "tr-foot" },
      "Prices, volume and market cap from CoinGecko's public API. Figures are " +
      "indicative and can lag the exchange — this is a reminder list, not a quote feed."),
  );

  clear(root);
  root.appendChild(view);
  renderTable();
  renderStatus();
  refresh();
}
