import { describe, it, expect } from "vitest";
import { bollinger } from "../bollinger.js";
import { sma } from "../sma.js";

describe("bollinger", () => {
  it("basis equals SMA", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
    const { basis } = bollinger(closes, 20, 2);
    const ref = sma(closes, 20);
    for (let i = 19; i < closes.length; i++) {
      expect(basis[i]).toBeCloseTo(ref[i], 10);
    }
  });

  it("bands collapse to basis on constant input", () => {
    const closes = new Array(30).fill(50);
    const { basis, upper, lower } = bollinger(closes, 20, 2);
    expect(upper[29]).toBeCloseTo(basis[29], 10);
    expect(lower[29]).toBeCloseTo(basis[29], 10);
  });

  it("upper > basis > lower for volatile input", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    const { basis, upper, lower } = bollinger(closes, 20, 2);
    expect(upper[29]).toBeGreaterThan(basis[29]);
    expect(lower[29]).toBeLessThan(basis[29]);
  });
});
