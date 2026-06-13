import { rma } from "./sma.js";

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  const gains = new Array(closes.length).fill(0);
  const losses = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }

  const avgG = rma(gains.slice(1), period);
  const avgL = rma(losses.slice(1), period);

  for (let i = 0; i < avgG.length; i++) {
    const g = avgG[i];
    const l = avgL[i];
    if (g === null || l === null) continue;
    const rs = l === 0 ? Infinity : g / l;
    const r = l === 0 ? 100 : 100 - 100 / (1 + rs);
    out[i + 1] = r;
  }
  return out;
}
