import { describe, it, expect } from "vitest";
import { macd } from "../macd.js";
import { ema } from "../sma.js";

describe("macd", () => {
  it("macd line = ema(fast) - ema(slow)", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const { macd: line } = macd(closes, 12, 26, 9);
    const fast = ema(closes, 12);
    const slow = ema(closes, 26);
    for (let i = 25; i < closes.length; i++) {
      expect(line[i]).toBeCloseTo(fast[i] - slow[i], 10);
    }
  });

  it("histogram is zero when macd equals signal", () => {
    const closes = new Array(80).fill(100);
    const { hist } = macd(closes, 12, 26, 9);
    expect(hist[79]).toBeCloseTo(0, 8);
  });

  it("histogram is positive after upward break", () => {
    const flat = new Array(60).fill(50);
    const rise = Array.from({ length: 30 }, (_, i) => 50 + i * 2);
    const { hist } = macd([...flat, ...rise], 12, 26, 9);
    expect(hist[hist.length - 1]).toBeGreaterThan(0);
  });
});
