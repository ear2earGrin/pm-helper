import { rma } from "./sma.js";
import { trueRange } from "./atr.js";

export function adx(candles, period = 14) {
  const len = candles.length;
  const empty = () => new Array(len).fill(null);

  if (len < period * 2) return { plusDI: empty(), minusDI: empty(), adx: empty() };

  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }

  const tr = trueRange(candles);

  const trS = rma(tr.slice(1), period);
  const plusS = rma(plusDM.slice(1), period);
  const minusS = rma(minusDM.slice(1), period);

  const plusDI = empty();
  const minusDI = empty();
  const dx = new Array(len).fill(null);

  for (let i = 0; i < trS.length; i++) {
    const idx = i + 1;
    if (trS[i] === null || trS[i] === 0) continue;
    const p = (100 * plusS[i]) / trS[i];
    const m = (100 * minusS[i]) / trS[i];
    plusDI[idx] = p;
    minusDI[idx] = m;
    const sum = p + m;
    dx[idx] = sum === 0 ? 0 : (100 * Math.abs(p - m)) / sum;
  }

  const firstDx = dx.findIndex((v) => v !== null);
  const adxOut = empty();
  if (firstDx !== -1) {
    const dxTail = dx.slice(firstDx).filter((v) => v !== null);
    const adxTail = rma(dxTail, period);
    for (let i = 0; i < adxTail.length; i++) adxOut[firstDx + i] = adxTail[i];
  }

  return { plusDI, minusDI, adx: adxOut };
}
