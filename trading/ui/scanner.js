// SCANNER view — once-a-day mechanical verdict per asset.
// Vanilla port of src/pages/Scanner.jsx (strategy v2.0). Strategy logic is
// untouched: it calls the same runOne() (default PRODUCTION_PRESET = PRESET_V2)
// over weekly+daily Binance klines with the live candle dropped.

import { fetchKlines, dropUnclosedCandle, binanceSymbol, fetchDerivsContext } from "../data/binance.js";
import { runOne } from "../strategy/runOne.js";
import { estimateLiquidation, stopToLiqBufferPct, maxSafeLeverage } from "../strategy/liquidation.js";
import { el, clear, append } from "./dom.js";
import { fmt } from "./format.js";

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const QUOTE = "USDT";
const WEEKLY_LIMIT = 200;
const DAILY_LIMIT = 200;
const LEVERAGE_BUCKETS = [1, 2, 3, 5, 8, 10, 15, 20, 25];

const LS_KEY = "scanner.config.v1";
const DEFAULT_CFG = { equity: 100000, riskPct: 1, fetchDerivs: false, leverage: 5, mmrPct: 0.5 };

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

async function scanAsset(asset, equity, riskPct, fetchDerivs) {
  const [weekly, daily] = await Promise.all([
    fetchKlines({ asset, quote: QUOTE, timeframe: "1W", limit: WEEKLY_LIMIT }),
    fetchKlines({ asset, quote: QUOTE, timeframe: "1D", limit: DAILY_LIMIT }),
  ]);
  // Derivatives are best-effort and only fetched when toggled on. A failure here
  // must not break the price-based scan.
  let derivs = null;
  if (fetchDerivs) {
    try { derivs = await fetchDerivsContext(asset); } catch { derivs = null; }
  }
  return runOne({
    asset,
    weekly: dropUnclosedCandle(weekly),
    daily: dropUnclosedCandle(daily),
    equity,
    riskPct,
    derivs,
  });
}

function badge(text, kind, title) {
  return el("span", { class: `tr-badge tr-badge--${String(kind || "flat").toLowerCase()}`, title: title || null }, text);
}

// v2.0 is long-only: a bear regime does NOT mean "go short" — it means buying
// is forbidden. Label it as the instruction, not the raw state.
function regimeBadge(state) {
  const label = state === "SHORT_OK" ? "BEAR — NO LONGS"
    : state === "LONG_OK" ? "BULL — LONGS OK" : state;
  const title = state === "SHORT_OK"
    ? "Price is below the 50W SMA. System is long-only: DO NOT buy, DO NOT short. Stand aside."
    : state === "LONG_OK" ? "Price is above the 50W SMA. Breakout signals may fire." : "";
  return badge(label, state, title);
}

function entryTrigger(sig) {
  if (sig.action === "LONG") return `> ${fmt(sig.entryUpper, 4)}`;
  if (sig.action === "SHORT") return `< ${fmt(sig.entryLower, 4)}`;
  return "-";
}

const COLS = ["Asset", "Regime", "Action", "Close", "Entry trigger", "Stop", "D10 exit",
  "Stop dist", "Qty", "Notional", "Margin", "Liq ≈", "Stop→Liq", "Max lev",
  "50W SMA", "W MACD hist", "W ADX", "W RSI", "D RSI", "Flow", "Funding", "OI 24h", "Derivs"];

export function mount(root) {
  let cfg = loadCfg();
  let rows = [];
  let lastScan = null;
  let loading = false;

  const subtitle = "Mechanical swing v2.0 (validated 2026-07-18): weekly 50W-SMA regime → "
    + "daily Donchian-20 breakout, LONG-ONLY → fixed-risk sizing, Donchian-10 trailing exit. "
    + "No vetoes, no shorts — the ablation showed they subtract.";

  const runBtn = el("button", { class: "btn btn-primary", type: "button", onClick: runScan }, "RUN SCAN");
  const lastEl = el("div", { class: "tr-last" });
  const equityInput = el("input", { class: "tr-input", value: cfg.equity, onInput: (e) => { cfg.equity = e.target.value; saveCfg(cfg); updateRiskReadout(); } });
  const riskInput = el("input", { class: "tr-input", value: cfg.riskPct, onInput: (e) => { cfg.riskPct = e.target.value; saveCfg(cfg); updateRiskReadout(); } });
  const riskReadout = el("div", { class: "tr-readonly" });
  const levSelect = el("select", {
    class: "tr-input",
    onChange: (e) => { cfg.leverage = Number(e.target.value); saveCfg(cfg); renderTable(); },
  }, ...LEVERAGE_BUCKETS.map((l) => el("option", { value: l, selected: Number(cfg.leverage) === l ? true : null }, `${l}x`)));
  const derivsBox = el("input", { type: "checkbox", checked: cfg.fetchDerivs ? true : null,
    onChange: (e) => { cfg.fetchDerivs = e.target.checked; saveCfg(cfg); derivsLabel.textContent = derivsText(); } });
  const derivsLabel = el("span", { class: "tr-mut", style: "font-size:12px" });
  const summary = el("div", { class: "tr-summary" });
  const tableHost = el("div", { class: "tr-table-host" });

  function derivsText() {
    return cfg.fetchDerivs ? "On — fetches positioning per asset (slower)" : "Off — price/flow only";
  }
  function updateRiskReadout() {
    const v = (Number(cfg.equity) || 0) * (Number(cfg.riskPct) || 0) / 100;
    riskReadout.textContent = `${fmt(v, 2)} USDT`;
  }

  function dataRow(r) {
    if (!r.ok) {
      return el("tr", null,
        el("td", { class: "tr-td" }, r.asset),
        el("td", { class: "tr-td tr-err", colspan: 22 }, `error: ${r.error}`),
      );
    }
    const sig = r.signal || {};
    const rl = r.regimeLatest || {};
    const sz = r.sizing;
    const d = r.derivs || {};
    const flow = r.flowSlope;
    const da = r.derivsAssessment;

    const leverage = Number(cfg.leverage) || 5;
    const mmrPct = Number(cfg.mmrPct) || 0.5;
    const hasSignal = sig.action === "LONG" || sig.action === "SHORT";
    const liq = hasSignal ? estimateLiquidation({ entry: sig.close, direction: sig.action, leverage, mmrPct }) : null;
    const liqBuf = hasSignal ? stopToLiqBufferPct({ entry: sig.close, stop: sig.stop, direction: sig.action, leverage, mmrPct }) : null;
    const safeLev = hasSignal ? maxSafeLeverage({ entry: sig.close, stop: sig.stop, direction: sig.action, mmrPct }) : null;
    const margin = hasSignal && sz?.ok ? sz.notional / leverage : null;
    const liqDanger = liqBuf !== null && liqBuf < 2;

    const histClass = rl.hist > 0 ? "tr-pos" : rl.hist < 0 ? "tr-neg" : "tr-mut";
    const flowClass = flow > 0 ? "tr-pos" : flow < 0 ? "tr-neg" : "tr-mut";
    const fundClass = d.fundingRate > 0 ? "tr-neg" : d.fundingRate < 0 ? "tr-pos" : "tr-mut";
    const oiClass = d.oiChange24hPct > 0 ? "tr-pos" : d.oiChange24hPct < 0 ? "tr-neg" : "tr-mut";

    return el("tr", null,
      el("td", { class: "tr-td tr-strong" }, binanceSymbol(r.asset)),
      el("td", { class: "tr-td" }, regimeBadge(r.regimeState)),
      el("td", { class: "tr-td" }, badge(sig.action || "WAIT", sig.action || "WAIT", sig.reason || "")),
      el("td", { class: "tr-td" }, fmt(sig.close, 4)),
      el("td", { class: "tr-td" }, entryTrigger(sig)),
      el("td", { class: "tr-td" }, fmt(sig.stop, 4)),
      el("td", { class: "tr-td", title: "10-day trailing exit line. If you HOLD: exit when the daily close is below this. Ratchet your stop up to it daily — never down." }, fmt(sig.exitLower, 4)),
      el("td", { class: "tr-td" }, sz?.ok ? `${fmt(sz.stopDistPct, 2)}%` : "-"),
      el("td", { class: "tr-td" }, sz?.ok ? fmt(sz.qty, 6) : "-"),
      el("td", { class: "tr-td" }, sz?.ok ? fmt(sz.notional, 0) : "-"),
      el("td", { class: "tr-td" }, margin !== null ? fmt(margin, 0) : "-"),
      el("td", { class: "tr-td" }, liq !== null ? fmt(liq, 4) : "-"),
      el("td", { class: `tr-td ${liqDanger ? "tr-neg tr-strong" : liqBuf !== null ? "tr-pos" : "tr-mut"}`,
        title: "Distance from stop to estimated liquidation. Below 2% = a wick can liquidate you before your stop fires — lower the leverage." },
        liqBuf !== null ? `${fmt(liqBuf, 1)}%${liqDanger ? " ⚠" : ""}` : "-"),
      el("td", { class: "tr-td", title: "Largest leverage that keeps the stop ≥2% inside liquidation" },
        safeLev !== null ? `${safeLev}x` : hasSignal ? "none" : "-"),
      el("td", { class: "tr-td" }, fmt(rl.sma, 2)),
      el("td", { class: `tr-td ${histClass}` }, fmt(rl.hist, 3)),
      el("td", { class: "tr-td" }, fmt(rl.adx, 1)),
      el("td", { class: "tr-td" }, fmt(rl.rsi, 1)),
      el("td", { class: "tr-td" }, fmt(sig.rsi, 1)),
      el("td", { class: `tr-td ${flowClass}`, title: "CVD slope over last 10 days (aggressor flow)" },
        flow === null || flow === undefined ? "-" : `${flow > 0 ? "▲" : "▼"} ${fmt(Math.abs(flow) * 100, 1)}`),
      el("td", { class: `tr-td ${fundClass}` }, Number.isFinite(d.fundingRate) ? `${fmt(d.fundingRate * 100, 4)}%` : "-"),
      el("td", { class: `tr-td ${oiClass}` }, Number.isFinite(d.oiChange24hPct) ? `${fmt(d.oiChange24hPct, 1)}%` : "-"),
      el("td", { class: "tr-td" }, da ? badge(da.grade, da.grade, (da.reasons || []).join("\n")) : "-"),
    );
  }

  function renderSummary(message, kind) {
    clear(summary);
    const longOk = rows.filter((r) => r.ok && r.regimeState === "LONG_OK").length;
    const shortOk = rows.filter((r) => r.ok && r.regimeState === "SHORT_OK").length;
    const flat = rows.filter((r) => r.ok && r.regimeState === "FLAT").length;
    const entries = rows.filter((r) => r.ok && (r.signal?.action === "LONG" || r.signal?.action === "SHORT")).length;
    const vetoes = rows.filter((r) => r.ok && r.signal?.action === "VETO").length;
    append(summary, [
      el("span", { class: "tr-pill tr-pill--longok" }, `BULL (longs allowed): ${longOk}`),
      el("span", { class: "tr-pill tr-pill--shortok" }, `BEAR (stand aside): ${shortOk}`),
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
    const results = await Promise.allSettled(UNIVERSE.map((a) => scanAsset(a, equity, riskPct, cfg.fetchDerivs)));
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
      el("div", { class: "tr-controls tr-controls--5" },
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "EQUITY (USDT)"), equityInput),
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "RISK % PER TRADE"), riskInput),
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "RISK $ (LOSS @ STOP)"), riskReadout),
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "LEVERAGE (ISOLATED)"), levSelect),
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "DERIVATIVES (FUNDING / OI)"),
          el("label", { class: "tr-readonly", style: "display:flex;align-items:center;gap:8px;cursor:pointer" }, derivsBox, derivsLabel)),
      ),
      summary,
      tableHost,
      el("div", { class: "tr-foot" },
        `Source: Binance spot ${QUOTE} klines (1W, 1D), live unclosed candle excluded. `
        + `Universe: ${UNIVERSE.join(" · ")}.`),
    ),
  );

  derivsLabel.textContent = derivsText();
  updateRiskReadout();
  renderSummary("", "ok");
  renderTable();
}
