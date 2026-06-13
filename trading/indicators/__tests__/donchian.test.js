import { describe, it, expect } from "vitest";
import { donchian, donchianCloses } from "../donchian.js";

const c = (h, l) => ({ high: h, low: l, close: (h + l) / 2, open: (h + l) / 2 });

describe("donchian", () => {
  it("upper is max of high over window", () => {
    const candles = [c(10, 5), c(12, 6), c(11, 7), c(15, 8), c(13, 9)];
    const { upper, lower } = donchian(candles, 3);
    expect(upper[2]).toBe(12);
    expect(upper[3]).toBe(15);
    expect(upper[4]).toBe(15);
    expect(lower[2]).toBe(5);
    expect(lower[4]).toBe(7);
  });

  it("returns null before period", () => {
    const candles = [c(1, 0), c(2, 1)];
    const { upper, lower } = donchian(candles, 5);
    expect(upper).toEqual([null, null]);
    expect(lower).toEqual([null, null]);
  });

  it("donchianCloses uses closes not highs", () => {
    const closes = [10, 12, 8, 15, 11];
    const { upper, lower } = donchianCloses(closes, 3);
    expect(upper[2]).toBe(12);
    expect(upper[3]).toBe(15);
    expect(lower[3]).toBe(8);
  });
});
