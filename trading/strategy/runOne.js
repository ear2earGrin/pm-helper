import { computeRegime } from "./regime.js";
import { computeSignal } from "./signal.js";
import { sizePosition } from "./sizing.js";

export function runOne({ asset, weekly, daily, equity, riskPct }) {
  const regime = computeRegime(weekly);
  const regimeState = regime.latest?.state || "WARMUP";
  const signal = computeSignal(daily, regimeState);
  const latestSignal = signal.latest;

  let sizing = null;
  if (latestSignal && (latestSignal.action === "LONG" || latestSignal.action === "SHORT")) {
    sizing = sizePosition({
      equity,
      riskPct,
      entry: latestSignal.close,
      stop: latestSignal.stop,
      direction: latestSignal.action,
    });
  }

  return {
    asset,
    regimeState,
    regimeLatest: regime.latest,
    signal: latestSignal,
    sizing,
  };
}
