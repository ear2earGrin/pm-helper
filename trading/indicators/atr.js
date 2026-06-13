import { rma } from "./sma.js";

export function trueRange(candles) {
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      out[i] = c.high - c.low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    out[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  }
  return out;
}

export function atr(candles, period = 14) {
  const tr = trueRange(candles);
  const trFromOne = tr.slice(1);
  const smoothed = rma(trFromOne, period);
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < smoothed.length; i++) out[i + 1] = smoothed[i];
  return out;
}
