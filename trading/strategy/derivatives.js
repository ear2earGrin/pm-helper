/**
 * Derivatives positioning assessment — the orthogonal, futures-specific axis.
 *
 * Design role (one input, one job): decide whether to STAND DOWN on a new entry
 * because the crowd is already maxed out in our direction and the squeeze risk is
 * against us. It NEVER generates entries — it only downgrades them. This keeps it
 * from competing with the trend hypothesis (the "one hypothesis, not a blend" rule).
 *
 * Inputs are orthogonal to price:
 *   - fundingRate: perp funding. Positive = longs pay shorts = longs crowded.
 *   - oiChangePct: open-interest change. Rising = new conviction; falling = unwind /
 *     short-covering (a weaker move).
 *   - cvdSlope: aggressor flow direction (from indicators/cvd.js).
 *
 * IMPORTANT (see docs/STRATEGY-SPEC.md): this is CONTEXT, not yet a hard gate in the
 * backtested system. Funding is backtestable; OI from free Binance is not (30-day
 * history cap). Promote any of these to a hard entry gate only after walk-forward
 * shows it improves out-of-sample expectancy.
 */

export const DERIVATIVES_PARAMS = {
  fundingElevated: 0.0005, // 0.05% per interval — crowded
  fundingExtreme: 0.001,   // 0.10% — very crowded, squeeze risk high
  oiConfirmPct: 3,         // OI up >3% over window = conviction
  oiFadePct: -3,           // OI down >3% = unwinding / weaker move
};

export function assessDerivatives(
  { direction, fundingRate, oiChangePct, cvdSlope },
  params = DERIVATIVES_PARAMS,
) {
  const reasons = [];
  let crowding = 0; // higher = more crowded against us
  let confirm = 0;  // higher = flow/OI confirms our entry

  // Funding ---------------------------------------------------------------
  if (Number.isFinite(fundingRate)) {
    const f = fundingRate;
    const crowdedDir = f > 0 ? "LONG" : "SHORT";
    const mag = Math.abs(f);
    const pct = (f * 100).toFixed(4);
    if (mag >= params.fundingExtreme && crowdedDir === direction) {
      crowding += 2;
      reasons.push(`funding ${pct}% extreme — ${direction.toLowerCase()}s very crowded`);
    } else if (mag >= params.fundingElevated && crowdedDir === direction) {
      crowding += 1;
      reasons.push(`funding ${pct}% elevated — ${direction.toLowerCase()}s crowded`);
    } else if (mag >= params.fundingElevated && crowdedDir !== direction) {
      confirm += 1;
      reasons.push(`funding ${pct}% favors us — crowd is ${crowdedDir.toLowerCase()}`);
    }
  }

  // Open interest ---------------------------------------------------------
  if (Number.isFinite(oiChangePct)) {
    if (oiChangePct >= params.oiConfirmPct) {
      confirm += 1;
      reasons.push(`OI +${oiChangePct.toFixed(1)}% — rising conviction`);
    } else if (oiChangePct <= params.oiFadePct) {
      crowding += 1;
      reasons.push(`OI ${oiChangePct.toFixed(1)}% — positions unwinding, weaker move`);
    }
  }

  // Aggressor flow --------------------------------------------------------
  if (Number.isFinite(cvdSlope) && cvdSlope !== 0) {
    const flowDir = cvdSlope > 0 ? "LONG" : "SHORT";
    if (flowDir === direction) {
      confirm += 1;
      reasons.push("aggressor flow confirms direction");
    } else {
      crowding += 1;
      reasons.push("aggressor flow diverges from price");
    }
  }

  let grade = "NEUTRAL";
  let standDown = false;
  if (crowding >= 2 && crowding > confirm) {
    grade = "CROWDED";
    standDown = true;
  } else if (confirm >= 2 && confirm > crowding) {
    grade = "CONFIRMED";
  } else if (crowding > confirm) {
    grade = "CAUTION";
  }

  return { grade, standDown, crowding, confirm, reasons };
}
