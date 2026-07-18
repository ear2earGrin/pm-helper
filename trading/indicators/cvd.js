/**
 * Cumulative Volume Delta (CVD) — the volume/flow axis.
 *
 * Binance klines expose taker-buy base volume (the portion of a bar's volume that
 * came from aggressor market BUYS). Taker sells = volume - takerBuyBase. The per-bar
 * delta = takerBuy - takerSell = 2*takerBuy - volume. CVD is the running sum.
 *
 * Why this is NOT redundant with price: price can rise while net aggressor buying
 * falls (delta negative) — a divergence that means the move is being sold into.
 * Pure price oscillators (RSI, MACD, %b) cannot see this; they're deterministic
 * functions of the candles you already have. CVD is genuinely new information about
 * WHO is pushing the move. That's the point of giving flow its own axis.
 *
 * All functions are pure and require candles carrying `volume` and `takerBuyBase`
 * (provided by data/binance.js toCandles).
 */

export function volumeDelta(candles) {
  return candles.map((c) => {
    const v = c.volume;
    const tb = c.takerBuyBase;
    if (!Number.isFinite(v) || !Number.isFinite(tb)) return null;
    return 2 * tb - v;
  });
}

export function cvd(candles) {
  const delta = volumeDelta(candles);
  const out = new Array(candles.length).fill(null);
  let run = 0;
  let started = false;
  for (let i = 0; i < candles.length; i++) {
    if (delta[i] === null) {
      out[i] = started ? run : null;
      continue;
    }
    run += delta[i];
    started = true;
    out[i] = run;
  }
  return { delta, cvd: out };
}

/**
 * Slope of CVD over the last `lookback` bars, normalized by total volume across
 * that window so the value is comparable between assets and timeframes. Positive
 * means net aggressor buying is building; negative means net selling. Range is
 * roughly [-1, 1] (it's a fraction of traded volume that was net-directional).
 */
export function cvdSlope(candles, lookback = 10) {
  const { cvd: c } = cvd(candles);
  const out = new Array(candles.length).fill(null);
  for (let i = lookback; i < candles.length; i++) {
    if (c[i] === null || c[i - lookback] === null) continue;
    let vol = 0;
    for (let j = i - lookback + 1; j <= i; j++) vol += candles[j].volume || 0;
    if (vol <= 0) continue;
    out[i] = (c[i] - c[i - lookback]) / vol;
  }
  return out;
}
