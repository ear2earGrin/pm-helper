import { describe, it, expect } from "vitest";
import { volumeDelta, cvd, cvdSlope } from "../cvd.js";

// Helper: candle with volume v, of which tb was taker-buy.
const c = (v, tb) => ({ open: 1, high: 1, low: 1, close: 1, volume: v, takerBuyBase: tb });

describe("volumeDelta", () => {
  it("is positive when buyers dominate, negative when sellers do", () => {
    expect(volumeDelta([c(100, 80)])[0]).toBe(60);  // 2*80 - 100
    expect(volumeDelta([c(100, 20)])[0]).toBe(-60); // 2*20 - 100
  });

  it("is zero on a perfectly balanced bar", () => {
    expect(volumeDelta([c(100, 50)])[0]).toBe(0);
  });

  it("returns null when taker volume is missing", () => {
    expect(volumeDelta([{ volume: 100 }])[0]).toBeNull();
  });
});

describe("cvd", () => {
  it("accumulates deltas into a running sum", () => {
    const candles = [c(100, 80), c(100, 80), c(100, 20)];
    const { cvd: out } = cvd(candles);
    expect(out[0]).toBe(60);
    expect(out[1]).toBe(120);
    expect(out[2]).toBe(60);
  });

  it("rises monotonically when every bar is net buying", () => {
    const candles = Array.from({ length: 20 }, () => c(100, 70));
    const { cvd: out } = cvd(candles);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
  });
});

describe("cvdSlope", () => {
  it("is positive for sustained buying, negative for sustained selling", () => {
    const buy = Array.from({ length: 30 }, () => c(100, 75));
    const sell = Array.from({ length: 30 }, () => c(100, 25));
    expect(cvdSlope(buy, 10).at(-1)).toBeGreaterThan(0);
    expect(cvdSlope(sell, 10).at(-1)).toBeLessThan(0);
  });

  it("is normalized to roughly [-1, 1]", () => {
    const buy = Array.from({ length: 30 }, () => c(100, 100)); // all buys, extreme
    const slope = cvdSlope(buy, 10).at(-1);
    expect(slope).toBeLessThanOrEqual(1 + 1e-9);
    expect(slope).toBeGreaterThanOrEqual(-1 - 1e-9);
  });

  it("returns null during warmup", () => {
    const candles = Array.from({ length: 5 }, () => c(100, 60));
    expect(cvdSlope(candles, 10).every((v) => v === null)).toBe(true);
  });
});
