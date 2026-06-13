import { describe, it, expect } from "vitest";
import { rsi } from "../rsi.js";

describe("rsi", () => {
  it("returns 100 for monotonically increasing series", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const out = rsi(closes, 14);
    expect(out[29]).toBe(100);
  });

  it("returns 0 for monotonically decreasing series", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
    const out = rsi(closes, 14);
    expect(out[29]).toBe(0);
  });

  it("stays within 0-100", () => {
    const closes = [10, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21, 24, 23, 26, 25];
    const out = rsi(closes, 14);
    out.forEach((v) => {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    });
  });

  it("Wilder textbook series — first RSI is roughly 70", () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
      45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    const out = rsi(closes, 14);
    expect(out[14]).toBeGreaterThan(68);
    expect(out[14]).toBeLessThan(73);
  });
});
