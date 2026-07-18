import { describe, it, expect } from "vitest";
import { estimateLiquidation, stopToLiqBufferPct, maxSafeLeverage } from "../liquidation.js";

describe("estimateLiquidation", () => {
  it("long liq sits below entry, short liq above", () => {
    const liqL = estimateLiquidation({ entry: 100, direction: "LONG", leverage: 5 });
    const liqS = estimateLiquidation({ entry: 100, direction: "SHORT", leverage: 5 });
    expect(liqL).toBeLessThan(100);
    expect(liqS).toBeGreaterThan(100);
  });

  it("higher leverage pulls liquidation closer to entry", () => {
    const lo = estimateLiquidation({ entry: 100, direction: "LONG", leverage: 2 });
    const hi = estimateLiquidation({ entry: 100, direction: "LONG", leverage: 20 });
    expect(hi).toBeGreaterThan(lo);
  });

  it("matches the closed form", () => {
    // 10x long, 0.5% mmr: 100 * (1 - 0.1 + 0.005) = 90.5
    expect(estimateLiquidation({ entry: 100, direction: "LONG", leverage: 10 })).toBeCloseTo(90.5, 10);
  });

  it("returns null on invalid input", () => {
    expect(estimateLiquidation({ entry: 0, direction: "LONG", leverage: 5 })).toBeNull();
    expect(estimateLiquidation({ entry: 100, direction: "LONG", leverage: 0 })).toBeNull();
  });
});

describe("stopToLiqBufferPct", () => {
  it("positive when stop is inside liquidation", () => {
    // 5x long: liq = 100*(1-0.2+0.005)=80.5; stop 90 → buffer (90-80.5)/100 = 9.5%
    const buf = stopToLiqBufferPct({ entry: 100, stop: 90, direction: "LONG", leverage: 5 });
    expect(buf).toBeCloseTo(9.5, 10);
  });

  it("negative when the stop is beyond liquidation (deadly)", () => {
    // 20x long: liq = 100*(1-0.05+0.005)=95.5; stop 90 is BELOW liq → negative
    const buf = stopToLiqBufferPct({ entry: 100, stop: 90, direction: "LONG", leverage: 20 });
    expect(buf).toBeLessThan(0);
  });

  it("mirrors for shorts", () => {
    // 5x short: liq = 100*(1+0.2-0.005)=119.5; stop 110 → (119.5-110)/100 = 9.5%
    const buf = stopToLiqBufferPct({ entry: 100, stop: 110, direction: "SHORT", leverage: 5 });
    expect(buf).toBeCloseTo(9.5, 10);
  });
});

describe("maxSafeLeverage", () => {
  it("returns a lower bucket for wider stops", () => {
    const tight = maxSafeLeverage({ entry: 100, stop: 97, direction: "LONG" });
    const wide = maxSafeLeverage({ entry: 100, stop: 85, direction: "LONG" });
    expect(tight).toBeGreaterThan(wide);
  });

  it("never returns a leverage whose buffer violates the minimum", () => {
    const lev = maxSafeLeverage({ entry: 100, stop: 92, direction: "LONG", minBufferPct: 2 });
    const buf = stopToLiqBufferPct({ entry: 100, stop: 92, direction: "LONG", leverage: lev });
    expect(buf).toBeGreaterThanOrEqual(2);
  });
});
