/**
 * Perpetual-futures funding cost model.
 *
 * Binance USDT-M perps settle funding every 8h. A LONG pays when the rate is
 * positive and receives when negative; SHORT is the mirror. For a swing system
 * holding positions for days-to-weeks this is a first-order cost, not a nicety:
 * 0.01%/8h ≈ 0.03%/day ≈ ~0.9%/month of notional.
 *
 * Daily-bar approximation: sum the (up to 3) settlement rates that fall on each
 * UTC day, and charge them against the position's notional at that day's close.
 * Exact settlement-time marks aren't available from daily candles; this is the
 * honest approximation and it errs in neither direction systematically.
 */

export function dayKey(unixSecs) {
  return Math.floor(unixSecs / 86400);
}

/** funding: [{ time: unixSecs, fundingRate: number }] → Map<dayKey, summedRate> */
export function buildDailyFundingMap(funding) {
  const map = new Map();
  if (!Array.isArray(funding)) return map;
  for (const r of funding) {
    if (!Number.isFinite(r?.time) || !Number.isFinite(r?.fundingRate)) continue;
    const k = dayKey(r.time);
    map.set(k, (map.get(k) || 0) + r.fundingRate);
  }
  return map;
}

/**
 * Funding accrued by a position over one daily bar.
 * Positive return value = cost to the position (long paying positive funding,
 * or short paying negative funding). Negative = the position RECEIVES funding.
 */
export function accrueFunding({ direction, qty, markPrice, rateSum }) {
  if (!rateSum) return 0;
  const dir = direction === "LONG" ? 1 : -1;
  return dir * rateSum * qty * markPrice;
}
