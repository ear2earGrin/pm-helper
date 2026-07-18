import { describe, it, expect } from "vitest";
import { computeRegime } from "../regime.js";
import { computeSignal } from "../signal.js";

function buildCandles(closes) {
  return closes.map((c) => ({ open: c, high: c * 1.005, low: c * 0.995, close: c, volume: 1, takerBuyBase: 0.5 }));
}

describe("regime ablation flags", () => {
  it("with only sma enabled, an uptrend above the SMA is LONG_OK even if other conditions would disagree", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i); // steady linear up
    const candles = buildCandles(closes);
    // full v1.1 regime may go FLAT on a pure ramp (MACD hist ~0); sma-only should be LONG_OK
    const smaOnly = computeRegime(candles, {
      smaPeriod: 50, macdFast: 12, macdSlow: 26, macdSignal: 9, rsiPeriod: 14, adxPeriod: 14, adxMin: 20,
      use: { sma: true, macd: false, rsi: false, adx: false },
    });
    expect(smaOnly.latest.state).toBe("LONG_OK");
  });

  it("with no directional condition enabled, regime is always FLAT", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i);
    const candles = buildCandles(closes);
    const none = computeRegime(candles, {
      smaPeriod: 50, macdFast: 12, macdSlow: 26, macdSignal: 9, rsiPeriod: 14, adxPeriod: 14, adxMin: 20,
      use: { sma: false, macd: false, rsi: false, adx: true },
    });
    expect(none.latest.state).toBe("FLAT");
  });
});

describe("signal ablation flags", () => {
  it("ignoreRegime lets a breakout fire even when regime is FLAT", () => {
    const noisy = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 3);
    const candles = buildCandles([...noisy, 104]);
    const off = computeSignal(candles, "FLAT", { ...baseSignal(), ignoreRegime: true });
    expect(off.latest.action).toBe("LONG");
  });

  it("allowShort=false suppresses short signals even in SHORT_OK regime", () => {
    const noisy = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 3);
    const candles = buildCandles([...noisy, 96]);
    const withShorts = computeSignal(candles, "SHORT_OK", { ...baseSignal() });
    const noShorts = computeSignal(candles, "SHORT_OK", { ...baseSignal(), allowShort: false });
    expect(withShorts.latest.action).toBe("SHORT");
    expect(noShorts.latest.action).not.toBe("SHORT");
  });

  it("disabling the RSI veto allows an overbought breakout that the veto would block", () => {
    const ramp = Array.from({ length: 40 }, (_, i) => 100 + i * 2); // drives RSI high
    const candles = buildCandles(ramp);
    const withVeto = computeSignal(candles, "LONG_OK", { ...baseSignal(), useRsiVeto: true, useBbVeto: false, ignoreRegime: true });
    const noVeto = computeSignal(candles, "LONG_OK", { ...baseSignal(), useRsiVeto: false, useBbVeto: false, ignoreRegime: true });
    expect(withVeto.latest.action).toBe("VETO");
    expect(noVeto.latest.action).toBe("LONG");
  });
});

function baseSignal() {
  return {
    donchianEntry: 20, donchianExit: 10, bbPeriod: 20, bbMult: 2, bbExtensionSigmas: 0.5,
    rsiPeriod: 14, rsiLongMax: 75, rsiShortMin: 25, atrPeriod: 14, atrStopMult: 2.5,
    useRsiVeto: true, useBbVeto: true, ignoreRegime: false,
  };
}
