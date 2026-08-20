// Watchlist view — a plain list of coins you intend to buy, with the numbers
// worth glancing at: price change over a chosen window (24h, 1W or 1M), 24h
// volume and market cap.
//
// Deliberately not a scanner. It holds no signals and makes no judgements; it
// is a memory aid, so the only state it keeps is which coins you saved and an
// optional note about why.

import { el, clear } from "./dom.js";
import { fmt } from "./format.js";
import { searchCoins, fetchMarkets, cachedMarkets, RateLimitError } from "../data/coingecko.js";
import { load, save, add, remove, setNote } from "../data/watchlist.js";

/** 1.27T / 28.4B / 950M / 12.3K — market caps and volumes are unreadable in full. */
function compact(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  for (const [size, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
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

// The change windows CoinGecko returns in one call, in display order.
const WINDOWS = [
  { key: "change24h", label: "24H" },
  { key: "change7d", label: "1W" },
  { key: "change30d", label: "1M" },
];
const WINDOW_KEY = "yf-trading-watchlist-window";

function loadWindow() {
  try {
    const saved = localStorage.getItem(WINDOW_KEY);
    if (WINDOWS.some((w) => w.key === saved)) return saved;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return "change24h";
}

function ago(ms) {
  if (!Number.isFinite(ms)) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function mount(root) {
  let entries = load();
  let stats = cachedMarkets(entries.map((e) => e.id));
  let status = null; // { kind, text }
  let lastUpdated = null;
  let results = [];
  let searching = false;
  let retryTimer = null;
  let countdownTimer = null;
  // Consecutive rate limits, used to back off: 12s, 24s, 48s, then 60s.
  let limitStreak = 0;

  const input = el("input", {
    class: "tr-input tr-wl-input",
    placeholder: "Search a coin — name or symbol, e.g. solana or SOL",
    autocomplete: "off",
  });
  const resultsHost = el("div", { class: "tr-wl-results" });
  const listHost = el("div", { class: "tr-wl-list" });
  const statusHost = el("div", { class: "tr-wl-status" });
  const refreshBtn = el("button", { class: "tr-act", type: "button", onClick: () => refresh({ force: true }) }, "REFRESH");

  // Which change window the list shows. Every window is already in the cached
  // row, so switching is instant and makes no request.
  let activeWindow = loadWindow();
  const windowHost = el("div", { class: "tr-wl-window", role: "group", "aria-label": "Price change window" });

  function selectWindow(key) {
    activeWindow = key;
    try {
      localStorage.setItem(WINDOW_KEY, key);
    } catch {
      /* the choice just won't persist */
    }
    renderWindow();
    renderList();
  }

  function renderWindow() {
    clear(windowHost);
    for (const w of WINDOWS) {
      windowHost.appendChild(
        el("button", {
          class: `tr-wl-window-btn${w.key === activeWindow ? " tr-wl-window-btn--active" : ""}`,
          type: "button",
          "aria-pressed": w.key === activeWindow ? "true" : "false",
          onClick: () => selectWindow(w.key),
        }, w.label),
      );
    }
  }

  function setStatus(kind, text) {
    status = text ? { kind, text } : null;
    renderStatus();
  }

  function renderStatus() {
    clear(statusHost);
    if (status) {
      statusHost.appendChild(el("span", { class: `tr-status tr-status--${status.kind}` }, status.text));
    }
    if (lastUpdated) {
      statusHost.appendChild(el("span", { class: "tr-mut" }, `Updated ${lastUpdated.toLocaleTimeString()}`));
    }
  }

  function clearRetry() {
    clearTimeout(retryTimer);
    clearInterval(countdownTimer);
    retryTimer = null;
    countdownTimer = null;
  }

  /**
   * A rate limit is temporary, so rather than leaving a dead-end message we
   * count down and retry on the user's behalf. Cached rows stay on screen
   * throughout, flagged as stale.
   */
  function scheduleRetry(ms, opts) {
    clearRetry();
    let left = Math.ceil(ms / 1000);
    const tick = () => {
      setStatus("warn", `Rate limited by CoinGecko — retrying in ${left}s…`);
      left -= 1;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
    retryTimer = setTimeout(() => {
      clearRetry();
      refresh(opts);
    }, ms);
  }

  async function refresh({ force = false } = {}) {
    clearRetry();
    if (!entries.length) {
      stats = {};
      lastUpdated = null;
      setStatus(null, null);
      renderList();
      return;
    }
    refreshBtn.disabled = true;
    setStatus("warn", "Loading…");
    try {
      stats = await fetchMarkets(entries.map((e) => e.id), { force });
      limitStreak = 0;
      lastUpdated = new Date();
      const missing = entries.filter((e) => !stats[e.id]).length;
      setStatus(missing ? "warn" : "ok", missing ? `${missing} coin(s) returned no data.` : null);
    } catch (err) {
      // Keep whatever we already had; the list must survive a bad call.
      stats = { ...cachedMarkets(entries.map((e) => e.id)), ...stats };
      if (err instanceof RateLimitError) {
        limitStreak += 1;
        renderList();
        refreshBtn.disabled = false;
        const backoff = Math.min(12_000 * 2 ** (limitStreak - 1), 60_000);
        scheduleRetry(err.retryAfterMs || backoff, { force });
        return;
      }
      setStatus("error", err.message);
    }
    refreshBtn.disabled = false;
    renderList();
  }

  function persist() {
    if (!save(entries)) setStatus("warn", "Could not save — browser storage is unavailable.");
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
    input.value = "";
    renderResults();
    renderList();
    refresh();
  }

  function removeCoin(id) {
    entries = remove(entries, id);
    persist();
    renderList();
  }

  // ── Search ────────────────────────────────────────────────────────────
  // 450ms and a 2-character floor: enough that ordinary typing produces one
  // request rather than one per keystroke.
  let searchTimer = null;
  input.addEventListener("input", (e) => {
    const q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(q), 450);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      runSearch(e.target.value);
    }
    if (e.key === "Escape") {
      results = [];
      renderResults();
    }
  });

  async function runSearch(q) {
    const query = String(q || "").trim();
    if (query.length < 2) {
      results = [];
      renderResults();
      return;
    }
    searching = true;
    renderResults();
    try {
      results = await searchCoins(query);
      setStatus(results.length ? null : "warn", results.length ? null : `Nothing found for "${query}".`);
    } catch (err) {
      results = [];
      if (err instanceof RateLimitError) {
        setStatus("warn", `Rate limited by CoinGecko — try that search again in ${Math.ceil(err.retryAfterMs / 1000)}s.`);
      } else {
        setStatus("error", err.message);
      }
    }
    searching = false;
    renderResults();
  }

  function renderResults() {
    clear(resultsHost);
    if (searching) {
      resultsHost.appendChild(el("div", { class: "tr-wl-searching" }, "Searching…"));
      return;
    }
    for (const c of results) {
      resultsHost.appendChild(
        el("button", { class: "tr-wl-result", type: "button", onClick: () => addCoin(c) },
          el("span", { class: "tr-wl-result-sym" }, c.symbol),
          el("span", { class: "tr-wl-result-name" }, c.name),
          el("span", { class: "tr-wl-result-rank" }, c.rank ? `#${c.rank}` : ""),
          el("span", { class: "tr-wl-add" }, "+ ADD"),
        ),
      );
    }
  }

  // ── List ──────────────────────────────────────────────────────────────
  function cell(label, value, extraClass) {
    return el("div", { class: `tr-wl-cell${extraClass ? " " + extraClass : ""}` },
      el("span", { class: "tr-wl-cell-label" }, label),
      el("span", { class: "tr-wl-cell-value" }, value),
    );
  }

  function renderList() {
    clear(listHost);
    if (!entries.length) {
      listHost.appendChild(
        el("div", { class: "tr-empty" },
          "Nothing saved yet. Search above and add the coins you are planning to buy."),
      );
      return;
    }

    const win = WINDOWS.find((w) => w.key === activeWindow) || WINDOWS[0];

    for (const e of entries) {
      const s = stats[e.id];
      const ch = s ? s[win.key] : null;
      const dir = !Number.isFinite(ch) ? "flat" : ch > 0 ? "up" : ch < 0 ? "down" : "flat";
      // Hovering shows every window, so the other two are one gesture away
      // rather than requiring a click on the toggle.
      const allWindows = s
        ? WINDOWS.map((w) => `${w.label} ${pct(s[w.key])}`).join("   ")
        : "No data yet";

      listHost.appendChild(
        el("div", { class: "tr-wl-item" },
          el("div", { class: "tr-wl-coin" },
            el("span", { class: "tr-wl-sym" }, e.symbol || "—"),
            el("span", { class: "tr-wl-name" }, e.name),
            s && s.stale ? el("span", { class: "tr-wl-stale", title: `Last fetched ${ago(s.ageMs)}` }, ago(s.ageMs)) : null,
          ),
          el("div", { class: "tr-wl-figures" },
            cell("PRICE", price(s?.price)),
            el("div", { class: `tr-wl-cell tr-wl-cell--change tr-wl-cell--${dir}`, title: allWindows },
              el("span", { class: "tr-wl-cell-label" }, win.label),
              el("span", { class: "tr-wl-cell-value" }, pct(ch)),
            ),
            cell("24H VOLUME", s ? `$${compact(s.volume24h)}` : "—"),
            cell("MARKET CAP", s ? `$${compact(s.marketCap)}` : "—"),
          ),
          el("div", { class: "tr-wl-tail" },
            // A textarea rather than an input: notes run to a sentence or two,
            // and an input can only ever show the first line. Collapsed to one
            // line by default, it expands over the rows below on hover or
            // focus, so the whole note is readable without opening anything.
            el("div", { class: "tr-wl-note-wrap" },
              el("textarea", {
                class: "tr-input tr-wl-note",
                rows: "1",
                placeholder: "why you're watching",
                title: e.note || "",
                onChange: (ev) => {
                  entries = setNote(entries, e.id, ev.target.value);
                  ev.target.title = ev.target.value;
                  persist();
                },
              }, e.note),
            ),
            el("button", {
              class: "tr-wl-x",
              type: "button",
              title: `Remove ${e.name}`,
              "aria-label": `Remove ${e.name}`,
              onClick: () => removeCoin(e.id),
            }, "×"),
          ),
        ),
      );
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────
  const view = el("div", { class: "tr-view" },
    el("div", { class: "tr-header" },
      el("div", null,
        el("h1", { class: "tr-title" }, "WATCHLIST"),
        el("p", { class: "tr-subtitle" },
          "Coins you are planning to buy. Switch the change column between 24h, 1 week " +
          "and 1 month; volume and market cap sit alongside. " +
          "Saved in this browser only — no account, and it never places an order."),
      ),
      el("div", { class: "tr-header-actions" },
        el("div", { class: "tr-wl-window-wrap" },
          el("span", { class: "tr-wl-window-label" }, "CHANGE"),
          windowHost,
        ),
        refreshBtn,
      ),
    ),
    el("div", { class: "tr-wl-searchbar" }, input, resultsHost),
    statusHost,
    listHost,
    el("p", { class: "tr-foot" },
      "Prices, volume and market cap from CoinGecko's public API. Figures are " +
      "indicative and can lag the exchange — this is a reminder list, not a quote feed."),
  );

  clear(root);
  root.appendChild(view);
  renderWindow();
  renderList();
  renderStatus();
  refresh();
}
