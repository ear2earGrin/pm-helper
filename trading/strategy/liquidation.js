/**
 * Approximate isolated-margin liquidation math for USDT-M perps.
 *
 * liq_long  ≈ entry * (1 - 1/leverage + mmr)
 * liq_short ≈ entry * (1 + 1/leverage - mmr)
 *
 * Exchanges use tiered maintenance margin and fee adjustments, so this is an
 * APPROXIMATION — treat it as a safety-margin check, not a promise. The number
 * that actually matters for survival: the stop must sit well inside the
 * liquidation price (stop-to-liq buffer), otherwise a wick that should have been
 * a controlled 1R loss becomes a forced liquidation at a worse price plus fees.
 */

export function estimateLiquidation({ entry, direction, leverage, mmrPct = 0.5 }) {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(leverage) || leverage <= 0) return null;
  const mmr = mmrPct / 100;
  const invLev = 1 / leverage;
  return direction === "LONG"
    ? entry * (1 - invLev + mmr)
    : entry * (1 + invLev - mmr);
}

/**
 * Distance from stop to estimated liquidation, as % of entry price.
 * Positive = stop is safely inside liquidation (stop fires first).
 * Zero or negative = the stop is beyond liquidation — the position would be
 * liquidated before the stop triggers. NEVER take that trade at that leverage.
 */
export function stopToLiqBufferPct({ entry, stop, direction, leverage, mmrPct = 0.5 }) {
  const liq = estimateLiquidation({ entry, direction, leverage, mmrPct });
  if (liq === null || !Number.isFinite(stop) || !Number.isFinite(entry) || entry <= 0) return null;
  return direction === "LONG"
    ? ((stop - liq) / entry) * 100
    : ((liq - stop) / entry) * 100;
}

/**
 * Largest leverage bucket that keeps the stop at least `minBufferPct` inside
 * liquidation. Returns null if even the lowest bucket can't (stop too wide —
 * which for this system means: use lower leverage or more margin, never a
 * tighter stop).
 */
export function maxSafeLeverage({ entry, stop, direction, mmrPct = 0.5, minBufferPct = 2, buckets = [1, 2, 3, 5, 8, 10, 15, 20, 25] }) {
  let best = null;
  for (const lev of buckets) {
    const buf = stopToLiqBufferPct({ entry, stop, direction, leverage: lev, mmrPct });
    if (buf !== null && buf >= minBufferPct) best = lev;
  }
  return best;
}
