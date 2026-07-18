import { sma } from "../indicators/sma.js";
import { macd } from "../indicators/macd.js";
import { rsi } from "../indicators/rsi.js";
import { adx } from "../indicators/dmi.js";

export const REGIME_PARAMS = {
  smaPeriod: 50,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  adxPeriod: 14,
  adxMin: 20,
  // Ablation switches: turn individual regime conditions on/off to test whether
  // each actually contributes out-of-sample edge (see scripts/ablation.mjs). All
  // true = the v1.1 spec regime.
  use: { sma: true, macd: true, rsi: true, adx: true },
};

export function computeRegime(weeklyCandles, params = REGIME_PARAMS) {
  const len = weeklyCandles.length;
  const closes = weeklyCandles.map((c) => c.close);

  const smaArr = sma(closes, params.smaPeriod);
  const { hist } = macd(closes, params.macdFast, params.macdSlow, params.macdSignal);
  const rsiArr = rsi(closes, params.rsiPeriod);
  const { adx: adxArr } = adx(weeklyCandles, params.adxPeriod);

  const series = new Array(len).fill(null);

  for (let i = 0; i < len; i++) {
    const close = closes[i];
    const smaV = smaArr[i];
    const histV = hist[i];
    const rsiV = rsiArr[i];
    const adxV = adxArr[i];

    if ([smaV, histV, rsiV, adxV].some((v) => v === null || v === undefined)) {
      series[i] = { state: "WARMUP", close, sma: smaV, hist: histV, rsi: rsiV, adx: adxV };
      continue;
    }

    const use = params.use || { sma: true, macd: true, rsi: true, adx: true };
    const trending = use.adx ? adxV >= params.adxMin : true;
    const directionalEnabled = use.sma || use.macd || use.rsi;
    const bullChecks =
      (!use.sma || close > smaV) && (!use.macd || histV > 0) && (!use.rsi || rsiV > 50);
    const bearChecks =
      (!use.sma || close < smaV) && (!use.macd || histV < 0) && (!use.rsi || rsiV < 50);

    // With no directional condition enabled, bull and bear are both vacuously true;
    // that is not a tradeable regime, so it stays FLAT.
    let state = "FLAT";
    if (directionalEnabled && trending && bullChecks && !bearChecks) state = "LONG_OK";
    else if (directionalEnabled && trending && bearChecks && !bullChecks) state = "SHORT_OK";

    series[i] = { state, close, sma: smaV, hist: histV, rsi: rsiV, adx: adxV };
  }

  return { series, latest: series[len - 1] };
}
