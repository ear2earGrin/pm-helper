import { describe, it, expect } from "vitest";
import { computeRegime } from "../regime.js";

function buildCandles(closes) {
  return closes.map((c) => ({ open: c, high: c * 1.005, low: c * 0.995, close: c }));
}

function noisyTrend(len, accel, base = 500) {
  return Array.from({ length: len }, (_, i) =>
    base + accel * i * i + Math.sin(i / 3) * 6 + Math.cos(i / 7) * 4,
  );
}

describe("computeRegime", () => {
  it("returns WARMUP before enough data", () => {
    const candles = buildCandles(new Array(10).fill(100));
    const { latest } = computeRegime(candles);
    expect(latest.state).toBe("WARMUP");
  });

  it("flags LONG_OK on a strong sustained uptrend", () => {
    const { latest } = computeRegime(buildCandles(noisyTrend(200, 0.05)));
    expect(latest.state).toBe("LONG_OK");
  });

  it("flags SHORT_OK on a strong sustained downtrend", () => {
    const { latest } = computeRegime(buildCandles(noisyTrend(200, -0.05, 3000)));
    expect(latest.state).toBe("SHORT_OK");
  });

  it("returns FLAT on choppy sideways action", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 2) * 0.5);
    const { latest } = computeRegime(buildCandles(closes));
    expect(latest.state).toBe("FLAT");
  });
});
