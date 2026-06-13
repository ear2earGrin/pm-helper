import { describe, it, expect } from "vitest";
import { atr, trueRange } from "../atr.js";

const candle = (h, l, c) => ({ high: h, low: l, close: c, open: c });

describe("trueRange", () => {
  it("first value is high-low", () => {
    const tr = trueRange([candle(10, 5, 8)]);
    expect(tr[0]).toBe(5);
  });

  it("uses max of three definitions", () => {
    const candles = [candle(10, 5, 8), candle(20, 12, 15)];
    const tr = trueRange(candles);
    expect(tr[1]).toBe(Math.max(20 - 12, Math.abs(20 - 8), Math.abs(12 - 8)));
  });

  it("gap up produces TR larger than H-L", () => {
    const candles = [candle(10, 5, 8), candle(30, 25, 28)];
    const tr = trueRange(candles);
    expect(tr[1]).toBe(Math.abs(30 - 8));
  });
});

describe("atr", () => {
  it("returns nulls before period+1", () => {
    const candles = [candle(10, 5, 8), candle(11, 6, 9)];
    const out = atr(candles, 14);
    expect(out.every((v) => v === null)).toBe(true);
  });

  it("converges on constant TR", () => {
    const candles = Array.from({ length: 50 }, () => candle(11, 9, 10));
    const out = atr(candles, 14);
    expect(out[49]).toBeCloseTo(2, 6);
  });
});
