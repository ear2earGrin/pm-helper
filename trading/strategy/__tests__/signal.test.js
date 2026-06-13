import { describe, it, expect } from "vitest";
import { computeSignal } from "../signal.js";

function buildCandles(closes) {
  return closes.map((c) => ({ open: c, high: c * 1.005, low: c * 0.995, close: c }));
}

describe("computeSignal", () => {
  it("waits during warmup", () => {
    const candles = buildCandles(new Array(10).fill(100));
    const { latest } = computeSignal(candles, "LONG_OK");
    expect(latest.action).toBe("WAIT");
  });

  it("issues LONG on a breakout above 20-day high in LONG_OK regime", () => {
    const noisy = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 3);
    const candles = buildCandles([...noisy, 104]);
    const { latest } = computeSignal(candles, "LONG_OK");
    expect(latest.action).toBe("LONG");
    expect(latest.stop).toBeLessThan(104);
  });

  it("issues SHORT on a breakout below 20-day low in SHORT_OK regime", () => {
    const noisy = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 3);
    const candles = buildCandles([...noisy, 96]);
    const { latest } = computeSignal(candles, "SHORT_OK");
    expect(latest.action).toBe("SHORT");
    expect(latest.stop).toBeGreaterThan(96);
  });

  it("does not enter long when regime is FLAT", () => {
    const noisy = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 3);
    const candles = buildCandles([...noisy, 104]);
    const { latest } = computeSignal(candles, "FLAT");
    expect(latest.action).not.toBe("LONG");
  });

  it("vetoes long if daily RSI is overbought", () => {
    const ramp = Array.from({ length: 40 }, (_, i) => 100 + i * 2);
    const candles = buildCandles(ramp);
    const { latest } = computeSignal(candles, "LONG_OK");
    expect(latest.action).toBe("VETO");
    expect(latest.reason).toMatch(/RSI/);
  });
});
