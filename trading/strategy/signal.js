import { donchianCloses } from "../indicators/donchian.js";
import { bollinger } from "../indicators/bollinger.js";
import { rsi } from "../indicators/rsi.js";
import { atr } from "../indicators/atr.js";

export const SIGNAL_PARAMS = {
  donchianEntry: 20,
  donchianExit: 10,
  bbPeriod: 20,
  bbMult: 2,
  bbExtensionSigmas: 0.5,
  rsiPeriod: 14,
  rsiLongMax: 75,
  rsiShortMin: 25,
  atrPeriod: 14,
  atrStopMult: 2.5,
  // Ablation switches. The anti-chase filters (RSI gate, BB-extension veto) are the
  // most suspect rules: they reject the strongest breakouts, which may be the very
  // right-tail trends the system needs. Turn them off to measure their real effect.
  useRsiVeto: true,
  useBbVeto: true,
  // When true, breakouts fire regardless of weekly regime — the bare-Donchian
  // baseline for ablation. Production keeps this false.
  ignoreRegime: false,
  // Direction switches. The predeclared long/short decision rule says: if one
  // book fails after costs, cut it rather than keep it for symmetry.
  allowLong: true,
  allowShort: true,
};

function bbExtensionVeto(close, basis, upper, lower, sigmas) {
  if ([basis, upper, lower].some((v) => v === null || v === undefined)) return false;
  const sigma = (upper - basis) / 2;
  if (sigma <= 0) return false;
  const upperVetoLine = upper + sigmas * sigma;
  const lowerVetoLine = lower - sigmas * sigma;
  return { extendedUp: close > upperVetoLine, extendedDown: close < lowerVetoLine };
}

export function computeSignal(dailyCandles, regimeState, params = SIGNAL_PARAMS) {
  const len = dailyCandles.length;
  const closes = dailyCandles.map((c) => c.close);
  // regimeState may be a single state string or a per-bar array of states
  const stateAt = Array.isArray(regimeState) ? (i) => regimeState[i] : () => regimeState;

  const entry = donchianCloses(closes, params.donchianEntry);
  const exit = donchianCloses(closes, params.donchianExit);
  const bb = bollinger(closes, params.bbPeriod, params.bbMult);
  const rsiArr = rsi(closes, params.rsiPeriod);
  const atrArr = atr(dailyCandles, params.atrPeriod);

  const series = new Array(len).fill(null);

  for (let i = 0; i < len; i++) {
    const close = closes[i];
    const prevEntryUpper = i > 0 ? entry.upper[i - 1] : null;
    const prevEntryLower = i > 0 ? entry.lower[i - 1] : null;
    const exitUpper = exit.upper[i];
    const exitLower = exit.lower[i];
    const atrV = atrArr[i];
    const rsiV = rsiArr[i];

    const ready =
      prevEntryUpper !== null &&
      prevEntryLower !== null &&
      exitUpper !== null &&
      exitLower !== null &&
      atrV !== null &&
      atrV !== undefined &&
      rsiV !== null;

    if (!ready) {
      series[i] = { action: "WAIT", reason: "warmup", close };
      continue;
    }

    const veto = bbExtensionVeto(close, bb.basis[i], bb.upper[i], bb.lower[i], params.bbExtensionSigmas);

    const breakoutUp = close > prevEntryUpper;
    const breakoutDown = close < prevEntryLower;

    let action = "NONE";
    let reason = "no breakout";
    let stop = null;

    const longAllowed = params.allowLong !== false && (params.ignoreRegime || stateAt(i) === "LONG_OK");
    const shortAllowed = params.allowShort !== false && (params.ignoreRegime || stateAt(i) === "SHORT_OK");

    if (breakoutUp && longAllowed) {
      if (params.useBbVeto && veto && veto.extendedUp) {
        action = "VETO";
        reason = "long breakout but price extended above upper BB band";
      } else if (params.useRsiVeto && rsiV >= params.rsiLongMax) {
        action = "VETO";
        reason = `daily RSI ${rsiV.toFixed(1)} >= ${params.rsiLongMax} (overbought)`;
      } else {
        const atrStop = close - params.atrStopMult * atrV;
        stop = Math.max(atrStop, exitLower);
        action = "LONG";
        reason = `daily close ${close} broke 20-day high ${prevEntryUpper.toFixed(2)}`;
      }
    } else if (breakoutDown && shortAllowed) {
      if (params.useBbVeto && veto && veto.extendedDown) {
        action = "VETO";
        reason = "short breakout but price extended below lower BB band";
      } else if (params.useRsiVeto && rsiV <= params.rsiShortMin) {
        action = "VETO";
        reason = `daily RSI ${rsiV.toFixed(1)} <= ${params.rsiShortMin} (oversold)`;
      } else {
        const atrStop = close + params.atrStopMult * atrV;
        stop = Math.min(atrStop, exitUpper);
        action = "SHORT";
        reason = `daily close ${close} broke 20-day low ${prevEntryLower.toFixed(2)}`;
      }
    } else if (breakoutUp || breakoutDown) {
      action = "NONE";
      reason = `breakout against regime (${stateAt(i)})`;
    }

    series[i] = {
      action,
      reason,
      close,
      entryUpper: prevEntryUpper,
      entryLower: prevEntryLower,
      exitUpper,
      exitLower,
      atr: atrV,
      rsi: rsiV,
      stop,
    };
  }

  return { series, latest: series[len - 1] };
}
