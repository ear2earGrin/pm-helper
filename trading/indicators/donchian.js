export function donchian(candles, period = 20) {
  const len = candles.length;
  const upper = new Array(len).fill(null);
  const lower = new Array(len).fill(null);
  const middle = new Array(len).fill(null);

  for (let i = period - 1; i < len; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low < lo) lo = candles[j].low;
    }
    upper[i] = hi;
    lower[i] = lo;
    middle[i] = (hi + lo) / 2;
  }
  return { upper, lower, middle };
}

export function donchianCloses(closes, period = 20) {
  const len = closes.length;
  const upper = new Array(len).fill(null);
  const lower = new Array(len).fill(null);

  for (let i = period - 1; i < len; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (closes[j] > hi) hi = closes[j];
      if (closes[j] < lo) lo = closes[j];
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}
