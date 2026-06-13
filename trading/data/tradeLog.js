const KEY = "tradeLog.v1";

/**
 * Local trade log persisted in localStorage. Schema versioned.
 *
 * Trade shape:
 *   {
 *     id: string,                  // uuid-ish
 *     asset: string,               // "BTC"
 *     direction: "LONG" | "SHORT",
 *     status: "OPEN" | "CLOSED",
 *     entry: { time: unix, price: number, stop: number, qty: number, riskDollar: number, leverage: number | null },
 *     exit: { time: unix, price: number, reason: string } | null,
 *     regimeSnapshot: { state, sma, hist, adx, rsi } | null,
 *     signalSnapshot: { action, reason, close, rsi, atr } | null,
 *     notes: string,
 *     systemSource: "scanner" | "manual",
 *   }
 */

export function loadTrades() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTrades(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* empty */ }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function addTrade(partial) {
  const trade = {
    id: uid(),
    status: "OPEN",
    exit: null,
    notes: "",
    systemSource: "scanner",
    ...partial,
  };
  const all = loadTrades();
  all.push(trade);
  saveTrades(all);
  return trade;
}

export function closeTrade(id, exit) {
  const all = loadTrades();
  const i = all.findIndex((t) => t.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], status: "CLOSED", exit };
  saveTrades(all);
  return all[i];
}

export function updateTrade(id, patch) {
  const all = loadTrades();
  const i = all.findIndex((t) => t.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch };
  saveTrades(all);
  return all[i];
}

export function deleteTrade(id) {
  const all = loadTrades().filter((t) => t.id !== id);
  saveTrades(all);
}

export function importTrades(jsonString) {
  const data = JSON.parse(jsonString);
  if (!Array.isArray(data)) throw new Error("Import payload must be an array.");
  saveTrades(data);
  return data.length;
}

export function exportTradesJSON() {
  return JSON.stringify(loadTrades(), null, 2);
}

/**
 * Produces an Obsidian-flavored Markdown note for a single trade. YAML frontmatter
 * makes the note queryable by Dataview and Memory Wiki; the body is human-readable.
 *
 * Suggested vault path: `trading/trades/YYYY-MM-DD-ASSET-DIRECTION.md`
 */
export function tradeToObsidianMarkdown(t) {
  const date = t.entry?.time ? new Date(t.entry.time * 1000) : new Date();
  const ymd = date.toISOString().slice(0, 10);
  const exitYmd = t.exit?.time ? new Date(t.exit.time * 1000).toISOString().slice(0, 10) : null;
  const pnl = t.exit ? (t.direction === "LONG" ? 1 : -1) * t.entry.qty * (t.exit.price - t.entry.price) : null;
  const rMultiple = pnl !== null && t.entry?.riskDollar ? pnl / t.entry.riskDollar : null;

  const fm = {
    date: ymd,
    asset: t.asset,
    direction: t.direction,
    status: t.status,
    entry: t.entry?.price,
    stop: t.entry?.stop,
    qty: t.entry?.qty,
    risk_dollar: t.entry?.riskDollar,
    leverage_used: t.entry?.leverage,
    exit_date: exitYmd,
    exit_price: t.exit?.price,
    exit_reason: t.exit?.reason,
    pnl_dollar: pnl,
    r_multiple: rMultiple,
    regime_state: t.regimeSnapshot?.state,
    weekly_sma50: t.regimeSnapshot?.sma,
    weekly_macd_hist: t.regimeSnapshot?.hist,
    weekly_adx: t.regimeSnapshot?.adx,
    weekly_rsi: t.regimeSnapshot?.rsi,
    daily_rsi: t.signalSnapshot?.rsi,
    daily_atr: t.signalSnapshot?.atr,
    source: t.systemSource,
    tags: ["trade", "mechanical-swing", t.asset.toLowerCase()],
  };

  const fmYaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${formatYamlValue(v)}`)
    .join("\n");

  const lines = [
    "---",
    fmYaml,
    "---",
    "",
    `# ${t.asset} ${t.direction} — ${ymd}`,
    "",
    `**Status**: ${t.status}`,
    "",
    "## Entry",
    "",
    `- Time: ${date.toISOString()}`,
    `- Price: ${t.entry?.price}`,
    `- Stop: ${t.entry?.stop}`,
    `- Quantity: ${t.entry?.qty}`,
    `- Risk: $${t.entry?.riskDollar?.toFixed(2)}`,
    t.entry?.leverage != null ? `- Leverage: ${t.entry.leverage}x` : null,
    "",
    "## Regime snapshot (weekly, at entry)",
    "",
    t.regimeSnapshot ? [
      `- State: \`${t.regimeSnapshot.state}\``,
      `- 50W SMA: ${t.regimeSnapshot.sma?.toFixed?.(4)}`,
      `- MACD hist: ${t.regimeSnapshot.hist?.toFixed?.(4)}`,
      `- ADX: ${t.regimeSnapshot.adx?.toFixed?.(2)}`,
      `- RSI: ${t.regimeSnapshot.rsi?.toFixed?.(2)}`,
    ].join("\n") : "_no snapshot captured_",
    "",
    "## Signal snapshot (daily, at entry)",
    "",
    t.signalSnapshot ? [
      `- Action: \`${t.signalSnapshot.action}\``,
      `- Reason: ${t.signalSnapshot.reason}`,
      `- Close: ${t.signalSnapshot.close}`,
      `- Daily RSI: ${t.signalSnapshot.rsi?.toFixed?.(2)}`,
      `- ATR(14): ${t.signalSnapshot.atr?.toFixed?.(4)}`,
    ].join("\n") : "_no snapshot captured_",
    "",
    t.exit ? "## Exit\n" : null,
    t.exit ? `- Time: ${new Date(t.exit.time * 1000).toISOString()}` : null,
    t.exit ? `- Price: ${t.exit.price}` : null,
    t.exit ? `- Reason: ${t.exit.reason}` : null,
    t.exit ? `- PnL: $${pnl?.toFixed(2)}` : null,
    t.exit ? `- R multiple: ${rMultiple?.toFixed(2)}` : null,
    "",
    "## Notes",
    "",
    t.notes || "_no notes_",
    "",
    "---",
    "_Auto-generated by Crypto Entry Checker. Schema v1._",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function obsidianFilename(t) {
  const date = t.entry?.time ? new Date(t.entry.time * 1000) : new Date();
  const ymd = date.toISOString().slice(0, 10);
  return `${ymd}-${t.asset}-${t.direction}.md`;
}

function formatYamlValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (Array.isArray(v)) return `[${v.map((x) => formatYamlValue(x)).join(", ")}]`;
  const s = String(v);
  if (/[:#\-?,&*!|>'"%@`{}\[\]]/.test(s) || s.includes("\n")) {
    return JSON.stringify(s);
  }
  return s;
}
