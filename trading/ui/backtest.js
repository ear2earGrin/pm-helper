// BACKTEST view — single-asset historical replay with equity curve + metrics.
// Vanilla port of src/pages/Backtest.jsx. The engine (backtestOne) and metrics are the
// ported pure modules, unchanged. lightweight-charts is loaded as a global (CDN) rather
// than an npm import, since pm-brief has no bundler.

import { fetchKlinesRange, dropUnclosedCandle, binanceSymbol } from "../data/binance.js";
import { backtestOne } from "../backtest/engine.js";
import { computeMetrics } from "../backtest/metrics.js";
import { el, clear, append } from "./dom.js";
import { fmt, fmtDate } from "./format.js";

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const START_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const LS_KEY = "backtest.config.v1";
const DEFAULT_CFG = { asset: "BTC", startYear: 2020, equity: 100000, riskPct: 1, feePct: 0.08 };

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

const CHART_OPTS = {
  height: 300,
  layout: { background: { color: "#0A0E1A" }, textColor: "#8B93A8" },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  rightPriceScale: { borderVisible: false },
  timeScale: { borderVisible: false },
};
const AREA_OPTS = {
  lineColor: "#0FD9A0",
  topColor: "rgba(15, 217, 160, 0.22)",
  bottomColor: "rgba(15, 217, 160, 0.02)",
  lineWidth: 2,
};

function metricCard(label, value, sub, tone) {
  return el("div", { class: "tr-metric" },
    el("div", { class: "tr-metric-label" }, label.toUpperCase()),
    el("div", { class: `tr-metric-value ${tone ? "tr-" + tone : ""}` }, value),
    sub ? el("div", { class: "tr-metric-sub" }, sub) : null,
  );
}

const TRADE_COLS = ["#", "Dir", "Entry date", "Entry", "Exit date", "Exit", "Days", "PnL", "R", "Exit reason"];

export function mount(root) {
  let cfg = loadCfg();
  let chart = null;
  let series = null;

  const runBtn = el("button", { class: "btn btn-primary", type: "button", onClick: run }, "RUN BACKTEST");
  const statusEl = el("div", { class: "tr-status-line" });
  const chartDiv = el("div", { class: "tr-chart" });
  const resultsHost = el("div", { class: "tr-results" });

  const inputs = {
    asset: el("select", { class: "tr-input", onChange: (e) => setCfg("asset", e.target.value) },
      ...UNIVERSE.map((a) => el("option", { value: a, selected: a === cfg.asset }, binanceSymbol(a)))),
    startYear: el("select", { class: "tr-input", onChange: (e) => setCfg("startYear", e.target.value) },
      ...START_YEARS.map((y) => el("option", { value: y, selected: String(y) === String(cfg.startYear) }, String(y)))),
    equity: el("input", { class: "tr-input", value: cfg.equity, onInput: (e) => setCfg("equity", e.target.value) }),
    riskPct: el("input", { class: "tr-input", value: cfg.riskPct, onInput: (e) => setCfg("riskPct", e.target.value) }),
    feePct: el("input", { class: "tr-input", value: cfg.feePct, onInput: (e) => setCfg("feePct", e.target.value) }),
  };

  function setCfg(k, v) { cfg[k] = v; saveCfg(cfg); }

  function field(label, control) {
    return el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, label), control);
  }

  function setStatus(message, kind) {
    clear(statusEl);
    if (message) statusEl.appendChild(el("div", { class: `tr-status tr-status--${kind || "info"}` },
      (kind === "error" ? "⚠️ " : "") + message));
  }

  function ensureChart() {
    if (chart || typeof window.LightweightCharts === "undefined") return;
    chart = window.LightweightCharts.createChart(chartDiv, {
      width: chartDiv.clientWidth || 800,
      ...CHART_OPTS,
    });
    series = chart.addAreaSeries(AREA_OPTS);
  }

  function drawCurve(equityCurve) {
    ensureChart();
    if (!series) return;
    series.setData(equityCurve.map((p) => ({ time: p.time, value: p.equity })));
    try { chart.timeScale().fitContent(); } catch { /* empty */ }
  }

  function renderResults(result) {
    clear(resultsHost);
    const m = result.metrics;
    const grid = el("div", { class: "tr-metrics-grid" },
      metricCard("Trades", String(m.numTrades)),
      metricCard("Win rate", `${fmt(m.winRate * 100, 1)}%`),
      metricCard("Expectancy", `${fmt(m.expectancyR, 2)}R`, `${fmt(m.expectancy, 0)} USDT`),
      metricCard("Profit factor", m.profitFactor === Infinity ? "∞" : fmt(m.profitFactor, 2)),
      metricCard("Total return", `${fmt(m.totalReturnPct, 1)}%`, `${fmt(m.totalReturn, 0)} USDT`,
        m.totalReturn > 0 ? "pos" : m.totalReturn < 0 ? "neg" : null),
      metricCard("CAGR", `${fmt(m.cagr, 1)}%`),
      metricCard("Max drawdown", `${fmt(m.maxDDPct, 1)}%`, `${fmt(m.maxDD, 0)} USDT / ${fmt(m.maxDDDays, 0)}d`,
        m.maxDDPct > 20 ? "neg" : null),
      metricCard("Avg hold", `${fmt(m.avgBarsHeld, 0)} days`),
      metricCard("Avg win", fmt(m.avgWin, 0)),
      metricCard("Avg loss", fmt(m.avgLoss, 0)),
      metricCard("Best trade", fmt(m.bestTrade?.pnl, 0)),
      metricCard("Worst trade", fmt(m.worstTrade?.pnl, 0)),
    );
    append(resultsHost, [grid]);

    if (m.maxDDPct > 20) {
      resultsHost.appendChild(el("div", { class: "tr-warn-banner" },
        `⚠️ Max drawdown ${fmt(m.maxDDPct, 1)}% exceeds your 20% circuit-breaker threshold. `
        + "Either reduce risk % or accept that you WILL see this drawdown live and plan for it."));
    }

    const tbody = el("tbody", null, ...result.trades.map((t, i) =>
      el("tr", null,
        el("td", { class: "tr-td" }, String(i + 1)),
        el("td", { class: `tr-td tr-strong ${t.direction === "LONG" ? "tr-pos" : "tr-neg"}` }, t.direction),
        el("td", { class: "tr-td" }, fmtDate(t.entryTime)),
        el("td", { class: "tr-td" }, fmt(t.entry, 4)),
        el("td", { class: "tr-td" }, fmtDate(t.exitTime)),
        el("td", { class: "tr-td" }, fmt(t.exit, 4)),
        el("td", { class: "tr-td" }, String(t.barsHeld)),
        el("td", { class: `tr-td ${t.pnl >= 0 ? "tr-pos" : "tr-neg"}` }, fmt(t.pnl, 0)),
        el("td", { class: `tr-td ${t.rMultiple >= 0 ? "tr-pos" : "tr-neg"}` }, fmt(t.rMultiple, 2)),
        el("td", { class: "tr-td tr-mut" }, t.exitReason),
      )));
    resultsHost.appendChild(el("div", { class: "tr-table-wrap tr-table-wrap--tall" },
      el("div", { class: "tr-section-title tr-section-title--pad" }, `TRADES (${result.trades.length})`),
      el("table", { class: "tr-table" },
        el("thead", null, el("tr", null, ...TRADE_COLS.map((c) => el("th", { class: "tr-th" }, c)))),
        tbody),
    ));
  }

  function renderEmpty() {
    clear(resultsHost);
    resultsHost.appendChild(el("div", { class: "tr-empty" },
      "Pick asset + start year, click RUN BACKTEST. Single asset for now — portfolio-level "
      + "replay (correlation caps, 1-entry-per-day across assets) comes later."));
  }

  async function run() {
    runBtn.disabled = true;
    runBtn.textContent = "RUNNING...";
    setStatus("Fetching history...", "info");
    clear(resultsHost);
    try {
      const startTime = Date.UTC(Number(cfg.startYear), 0, 1);
      const [weeklyRaw, dailyRaw] = await Promise.all([
        fetchKlinesRange({ asset: cfg.asset, timeframe: "1W", startTime: startTime - 55 * 7 * 86400 * 1000 }),
        fetchKlinesRange({ asset: cfg.asset, timeframe: "1D", startTime }),
      ]);
      const weekly = dropUnclosedCandle(weeklyRaw);
      const daily = dropUnclosedCandle(dailyRaw);

      if (daily.length < 60) {
        throw new Error(`Only ${daily.length} daily candles — not enough history for ${cfg.asset} from ${cfg.startYear}.`);
      }
      setStatus(`Replaying ${daily.length} days...`, "info");

      const bt = backtestOne({
        asset: cfg.asset,
        weekly,
        daily,
        startEquity: Number(cfg.equity) || 100000,
        riskPct: Number(cfg.riskPct) || 1,
        feePct: Number(cfg.feePct) || 0,
      });
      const metrics = computeMetrics(bt);
      const result = { ...bt, metrics, candles: daily.length };

      drawCurve(result.equityCurve);
      renderResults(result);
      setStatus(`Done: ${daily.length} days, ${bt.trades.length} trades.`, "ok");
    } catch (e) {
      setStatus(e?.message || "Backtest failed.", "error");
      renderEmpty();
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "RUN BACKTEST";
    }
  }

  const onResize = () => { if (chart) chart.applyOptions({ width: chartDiv.clientWidth || 800 }); };

  clear(root);
  root.appendChild(
    el("div", { class: "tr-view" },
      el("div", { class: "tr-header" },
        el("div", null,
          el("h1", { class: "tr-title" }, "BACKTEST"),
          el("div", { class: "tr-subtitle" },
            "Same rules the Scanner runs live: weekly regime → daily Donchian-20 breakout → "
            + "fixed-fractional risk → Donchian-10 trail. If you wouldn't have followed this equity "
            + "curve through its worst stretch, don't trade it live."),
        ),
        el("div", { class: "tr-header-actions" }, runBtn),
      ),
      el("div", { class: "tr-controls tr-controls--5" },
        field("ASSET", inputs.asset),
        field("FROM YEAR", inputs.startYear),
        field("START EQUITY", inputs.equity),
        field("RISK %", inputs.riskPct),
        field("FEE % (ROUND-TRIP)", inputs.feePct),
      ),
      statusEl,
      el("div", { class: "tr-card" },
        el("div", { class: "tr-section-title" }, "EQUITY CURVE"),
        chartDiv,
      ),
      resultsHost,
    ),
  );

  ensureChart();
  if (!chart) {
    setStatus("Chart library not loaded (CDN blocked?) — metrics and trades still work.", "warn");
  }
  renderEmpty();
  window.addEventListener("resize", onResize);

  return function cleanup() {
    window.removeEventListener("resize", onResize);
    try { chart?.remove(); } catch { /* empty */ }
    chart = null;
    series = null;
  };
}
