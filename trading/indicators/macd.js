import { ema } from "./sma.js";

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);

  const macdLine = closes.map((_, i) => {
    if (fastE[i] === null || slowE[i] === null) return null;
    return fastE[i] - slowE[i];
  });

  const firstIdx = macdLine.findIndex((v) => v !== null);
  let signalLine = new Array(closes.length).fill(null);

  if (firstIdx !== -1) {
    const tail = macdLine.slice(firstIdx);
    const sig = ema(tail, signal);
    for (let i = 0; i < sig.length; i++) signalLine[firstIdx + i] = sig[i];
  }

  const hist = closes.map((_, i) => {
    if (macdLine[i] === null || signalLine[i] === null) return null;
    return macdLine[i] - signalLine[i];
  });

  return { macd: macdLine, signal: signalLine, hist };
}
