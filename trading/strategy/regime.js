import { sma } from "../indicators/sma.js";
import { macd } from "../indicators/macd.js";
import { rsi } from "../indicators/rsi.js";
import { adx } from "../indicators/adx.js";

export const REGIME_PARAMS = {
  smaPeriod: 50,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  adxPeriod: 14,
  adxMin: 20,
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

    const trending = adxV >= params.adxMin;
    const bullChecks = close > smaV && histV > 0 && rsiV > 50;
    const bearChecks = close < smaV && histV < 0 && rsiV < 50;

    let state = "FLAT";
    if (trending && bullChecks) state = "LONG_OK";
    else if (trending && bearChecks) state = "SHORT_OK";

    series[i] = { state, close, sma: smaV, hist: histV, rsi: rsiV, adx: adxV };
  }

  return { series, latest: series[len - 1] };
}
