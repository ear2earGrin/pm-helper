import { describe, it, expect } from "vitest";
import { adx } from "../adx.js";

const c = (h, l, cl) => ({ high: h, low: l, close: cl, open: cl });

describe("adx", () => {
  it("stays within 0-100", () => {
    const candles = Array.from({ length: 100 }, (_, i) => {
      const base = 100 + Math.sin(i / 4) * 5;
      return c(base + 1, base - 1, base);
    });
    const { adx: a, plusDI, minusDI } = adx(candles, 14);
    [a, plusDI, minusDI].forEach((arr) => {
      arr.forEach((v) => {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      });
    });
  });

  it("rises for a clean uptrend", () => {
    const candles = Array.from({ length: 80 }, (_, i) => {
      const base = 100 + i;
      return c(base + 0.5, base - 0.5, base);
    });
    const { adx: a, plusDI, minusDI } = adx(candles, 14);
    const last = a[79];
    expect(last).toBeGreaterThan(40);
    expect(plusDI[79]).toBeGreaterThan(minusDI[79]);
  });

  it("rises for a clean downtrend with minusDI > plusDI", () => {
    const candles = Array.from({ length: 80 }, (_, i) => {
      const base = 200 - i;
      return c(base + 0.5, base - 0.5, base);
    });
    const { plusDI, minusDI } = adx(candles, 14);
    expect(minusDI[79]).toBeGreaterThan(plusDI[79]);
  });
});
