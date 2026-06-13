// Shared formatting helpers for the trading views. Mirrors the fmt/date helpers the
// original React pages defined inline, kept in one place so every view formats numbers
// and dates identically.

export function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export function fmtDate(unixSecs) {
  if (!unixSecs) return "-";
  return new Date(unixSecs * 1000).toISOString().slice(0, 10);
}

// Trade log uses the same day formatting as the backtest.
export const ymd = fmtDate;
