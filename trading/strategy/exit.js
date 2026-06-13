import { donchianCloses } from "../indicators/donchian.js";

export function trailingStop(dailyCandles, direction, exitPeriod = 10) {
  const closes = dailyCandles.map((c) => c.close);
  const { upper, lower } = donchianCloses(closes, exitPeriod);
  return dailyCandles.map((_, i) => (direction === "LONG" ? lower[i] : upper[i]));
}

export function updatePositionExit(position, dailyCandles, params = { exitPeriod: 10 }) {
  const trail = trailingStop(dailyCandles, position.direction, params.exitPeriod);
  const i = dailyCandles.length - 1;
  const trailed = trail[i];
  if (trailed === null || trailed === undefined) return position.stop;

  if (position.direction === "LONG") {
    return Math.max(position.stop, trailed);
  }
  return Math.min(position.stop, trailed);
}

export function shouldExit(position, latestDaily, latestRegimeState) {
  const reasons = [];
  if (position.direction === "LONG") {
    if (latestDaily.close <= position.stop) reasons.push("trailing stop hit");
    if (latestRegimeState === "SHORT_OK" || latestRegimeState === "FLAT") {
      reasons.push(`regime flipped to ${latestRegimeState}`);
    }
  } else {
    if (latestDaily.close >= position.stop) reasons.push("trailing stop hit");
    if (latestRegimeState === "LONG_OK" || latestRegimeState === "FLAT") {
      reasons.push(`regime flipped to ${latestRegimeState}`);
    }
  }
  return { exit: reasons.length > 0, reasons };
}
