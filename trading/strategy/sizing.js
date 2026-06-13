export function sizePosition({ equity, riskPct, entry, stop, direction, leverage = null }) {
  const reasons = [];
  if (!Number.isFinite(equity) || equity <= 0) return { ok: false, reason: "equity invalid" };
  if (!Number.isFinite(riskPct) || riskPct <= 0) return { ok: false, reason: "riskPct invalid" };
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
    return { ok: false, reason: "entry/stop invalid" };
  }
  if (direction === "LONG" && stop >= entry) return { ok: false, reason: "long stop >= entry" };
  if (direction === "SHORT" && stop <= entry) return { ok: false, reason: "short stop <= entry" };

  const riskDollar = equity * (riskPct / 100);
  const perUnitRisk = Math.abs(entry - stop);
  const qty = riskDollar / perUnitRisk;
  const notional = qty * entry;
  const stopDistPct = (perUnitRisk / entry) * 100;

  let requiredLeverage = null;
  let marginUsed = null;
  if (Number.isFinite(leverage) && leverage > 0) {
    marginUsed = notional / leverage;
    if (marginUsed > equity) {
      reasons.push(`margin (${marginUsed.toFixed(0)}) exceeds equity (${equity}) at ${leverage}x`);
    }
  }
  requiredLeverage = notional / equity;

  return {
    ok: true,
    riskDollar,
    perUnitRisk,
    qty,
    notional,
    stopDistPct,
    requiredLeverage,
    marginUsed,
    warnings: reasons,
  };
}
