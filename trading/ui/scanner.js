// SCANNER view — once-a-day mechanical verdict per asset.
// Vanilla port of src/pages/Scanner.jsx. Strategy logic is untouched: it calls the
// same runOne() over weekly+daily Binance klines with the live candle dropped.

import { fetchKlines, dropUnclosedCandle, binanceSymbol } from "../data/binance.js";
import { runOne } from "../strategy/runOne.js";
import { el, clear, append } from "./dom.js";
import { fmt } from "./format.js";

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const QUOTE = "USDT";
const WEEKLY_LIMIT = 200;
const DAILY_LIMIT = 200;

const LS_KEY = "scanner.config.v1";
const DEFAULT_CFG = { equity: 100000, riskPct: 1 };

function loadCfg() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_CFG };
    return { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CFG };
  }
}
function saveCfg(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* empty */ }
}

async function scanAsset(asset, equity, riskPct) {
  const [weekly, daily] = await Promise.all([
    fetchKlines({ asset, quote: QUOTE, timeframe: "1W", limit: WEEKLY_LIMIT }),
    fetchKlines({ asset, quote: QUOTE, timeframe: "1D", limit: DAILY_LIMIT }),
  ]);
  return runOne({
    asset,
    weekly: dropUnclosedCandle(weekly),
    daily: dropUnclosedCandle(daily),
    equity,
    riskPct,
  });
}

function badge(text, kind) {
  return el("span", { class: `tr-badge tr-badge--${String(kind || "flat").toLowerCase()}` }, text);
}

function entryTrigger(sig) {
  if (sig.action === "LONG") return `> ${fmt(sig.entryUpper, 4)}`;
  if (sig.action === "SHORT") return `< ${fmt(sig.entryLower, 4)}`;
  return "-";
}

function dataRow(r) {
  if (!r.ok) {
    return el("tr", null,
      el("td", { class: "tr-td" }, r.asset),
      el("td", { class: "tr-td tr-err", colspan: 13 }, `error: ${r.error}`),
    );
  }
  const sig = r.signal || {};
  const rl = r.regimeLatest || {};
  const sz = r.sizing;
  const histClass = rl.hist > 0 ? "tr-pos" : rl.hist < 0 ? "tr-neg" : "tr-mut";

  return el("tr", null,
    el("td", { class: "tr-td tr-strong" }, binanceSymbol(r.asset)),
    el("td", { class: "tr-td" }, badge(r.regimeState, r.regimeState)),
    el("td", { class: "tr-td", title: sig.reason || "" }, badge(sig.action || "WAIT", sig.action || "WAIT")),
    el("td", { class: "tr-td" }, fmt(sig.close, 4)),
    el("td", { class: "tr-td" }, entryTrigger(sig)),
    el("td", { class: "tr-td" }, fmt(sig.stop, 4)),
    el("td", { class: "tr-td" }, sz?.ok ? `${fmt(sz.stopDistPct, 2)}%` : "-"),
    el("td", { class: "tr-td" }, sz?.ok ? fmt(sz.qty, 6) : "-"),
    el("td", { class: "tr-td" }, sz?.ok ? fmt(sz.notional, 0) : "-"),
    el("td", { class: "tr-td" }, fmt(rl.sma, 2)),
    el("td", { class: `tr-td ${histClass}` }, fmt(rl.hist, 3)),
    el("td", { class: "tr-td" }, fmt(rl.adx, 1)),
    el("td", { class: "tr-td" }, fmt(rl.rsi, 1)),
    el("td", { class: "tr-td" }, fmt(sig.rsi, 1)),
  );
}

const COLS = ["Asset", "Regime", "Action", "Close", "Entry trigger", "Stop", "Stop dist",
  "Qty", "Notional", "50W SMA", "W MACD hist", "W ADX", "W RSI", "D RSI"];

export function mount(root) {
  let cfg = loadCfg();
  let rows = [];
  let lastScan = null;
  let loading = false;

  const subtitle = "Mechanical swing: weekly regime (50W SMA · MACD hist · ADX≥20 · RSI vs 50) → "
    + "daily Donchian-20 breakout → 1% risk per trade, Donchian-10 trailing exit.";

  const runBtn = el("button", { class: "btn btn-primary", type: "button", onClick: runScan }, "RUN SCAN");
  const lastEl = el("div", { class: "tr-last" });
  const equityInput = el("input", { class: "tr-input", value: cfg.equity, onInput: (e) => { cfg.equity = e.target.value; saveCfg(cfg); updateRiskReadout(); } });
  const riskInput = el("input", { class: "tr-input", value: cfg.riskPct, onInput: (e) => { cfg.riskPct = e.target.value; saveCfg(cfg); updateRiskReadout(); } });
  const riskReadout = el("div", { class: "tr-readonly" });
  const summary = el("div", { class: "tr-summary" });
  const tableHost = el("div", { class: "tr-table-host" });

  function updateRiskReadout() {
    const v = (Number(cfg.equity) || 0) * (Number(cfg.riskPct) || 0) / 100;
    riskReadout.textContent = `${fmt(v, 2)} USDT`;
  }

  function renderSummary(message, kind) {
    clear(summary);
    const longOk = rows.filter((r) => r.ok && r.regimeState === "LONG_OK").length;
    const shortOk = rows.filter((r) => r.ok && r.regimeState === "SHORT_OK").length;
    const flat = rows.filter((r) => r.ok && r.regimeState === "FLAT").length;
    const entries = rows.filter((r) => r.ok && (r.signal?.action === "LONG" || r.signal?.action === "SHORT")).length;
    const vetoes = rows.filter((r) => r.ok && r.signal?.action === "VETO").length;
    append(summary, [
      el("span", { class: "tr-pill tr-pill--longok" }, `LONG-OK: ${longOk}`),
      el("span", { class: "tr-pill tr-pill--shortok" }, `SHORT-OK: ${shortOk}`),
      el("span", { class: "tr-pill tr-pill--flat" }, `FLAT: ${flat}`),
      el("span", { class: "tr-pill tr-pill--signal" }, `SIGNALS: ${entries}`),
      el("span", { class: "tr-pill tr-pill--veto" }, `VETOES: ${vetoes}`),
      message ? el("span", { class: `tr-status tr-status--${kind || "ok"}` }, message) : null,
    ]);
  }

  function renderTable() {
    clear(tableHost);
    if (rows.length === 0) {
      tableHost.appendChild(el("div", { class: "tr-empty" },
        "Click RUN SCAN. Manual refresh only — this is a once-a-day system."));
      return;
    }
    const table = el("table", { class: "tr-table" },
      el("thead", null, el("tr", null, ...COLS.map((c) => el("th", { class: "tr-th" }, c)))),
      el("tbody", null, ...rows.map(dataRow)),
    );
    tableHost.appendChild(el("div", { class: "tr-table-wrap" }, table));
  }

  async function runScan() {
    if (loading) return;
    loading = true;
    runBtn.textContent = "SCANNING...";
    runBtn.disabled = true;
    renderSummary(`Scanning ${UNIVERSE.length} assets...`, "info");

    const equity = Number(cfg.equity) || 0;
    const riskPct = Number(cfg.riskPct) || 0;
    const results = await Promise.allSettled(UNIVERSE.map((a) => scanAsset(a, equity, riskPct)));
    rows = results.map((res, i) =>
      res.status === "fulfilled"
        ? { ok: true, ...res.value }
        : { ok: false, asset: UNIVERSE[i], error: res.reason?.message || "fetch failed" });

    lastScan = new Date();
    lastEl.textContent = `Last: ${lastScan.toLocaleTimeString()}`;
    const errs = rows.filter((r) => !r.ok).length;
    renderSummary(errs ? `Done with ${errs} error(s).` : "Scan complete.", errs ? "warn" : "ok");
    renderTable();

    loading = false;
    runBtn.textContent = "RUN SCAN";
    runBtn.disabled = false;
  }

  clear(root);
  root.appendChild(
    el("div", { class: "tr-view" },
      el("div", { class: "tr-header" },
        el("div", null,
          el("h1", { class: "tr-title" }, "SCANNER"),
          el("div", { class: "tr-subtitle" }, subtitle),
        ),
        el("div", { class: "tr-header-actions" }, runBtn, lastEl),
      ),
      el("div", { class: "tr-controls tr-controls--3" },
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "EQUITY (USDT)"), equityInput),
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "RISK % PER TRADE"), riskInput),
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "RISK $ (LOSS @ STOP)"), riskReadout),
      ),
      summary,
      tableHost,
      el("div", { class: "tr-foot" },
        `Source: Binance spot ${QUOTE} klines (1W, 1D), live unclosed candle excluded. `
        + `Universe: ${UNIVERSE.join(" · ")}.`),
    ),
  );

  updateRiskReadout();
  renderSummary("", "ok");
  renderTable();
}
