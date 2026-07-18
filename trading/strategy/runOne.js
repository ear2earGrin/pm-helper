import { computeRegime } from "./regime.js";
import { computeSignal } from "./signal.js";
import { sizePosition } from "./sizing.js";
import { assessDerivatives } from "./derivatives.js";
import { cvdSlope as cvdSlopeFn } from "../indicators/cvd.js";
import { PRODUCTION_PRESET } from "./presets.js";

export function runOne({ asset, weekly, daily, equity, riskPct, derivs = null, preset = PRODUCTION_PRESET }) {
  const regime = computeRegime(weekly, preset.regimeParams);
  const regimeState = regime.latest?.state || "WARMUP";
  const signal = computeSignal(daily, regimeState, preset.signalParams);
  const latestSignal = signal.latest;

  // Volume/flow axis: net aggressor pressure over the last 10 daily bars.
  // Context only — does not alter the mechanical signal.
  const cvdSlopeArr = cvdSlopeFn(daily, 10);
  const flowSlope = cvdSlopeArr.length ? cvdSlopeArr[cvdSlopeArr.length - 1] : null;

  let sizing = null;
  let derivsAssessment = null;
  if (latestSignal && (latestSignal.action === "LONG" || latestSignal.action === "SHORT")) {
    sizing = sizePosition({
      equity,
      riskPct,
      entry: latestSignal.close,
      stop: latestSignal.stop,
      direction: latestSignal.action,
    });

    // Positioning / flow context for the proposed entry. Orthogonal to price;
    // surfaced as a grade, NOT applied as a hard gate (see STRATEGY-SPEC.md).
    derivsAssessment = assessDerivatives({
      direction: latestSignal.action,
      fundingRate: derivs?.fundingRate ?? null,
      oiChangePct: derivs?.oiChange24hPct ?? null,
      cvdSlope: flowSlope,
    });
  }

  return {
    asset,
    regimeState,
    regimeLatest: regime.latest,
    signal: latestSignal,
    sizing,
    flowSlope,
    derivs,
    derivsAssessment,
  };
}
