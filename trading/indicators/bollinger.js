import { sma } from "./sma.js";

export function bollinger(closes, period = 20, mult = 2) {
  const basis = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = basis[i];
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - mean;
      sq += d * d;
    }
    const stdev = Math.sqrt(sq / period);
    upper[i] = mean + mult * stdev;
    lower[i] = mean - mult * stdev;
  }
  return { basis, upper, lower };
}
