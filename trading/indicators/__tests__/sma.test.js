import { describe, it, expect } from "vitest";
import { sma, ema, rma } from "../sma.js";

describe("sma", () => {
  it("returns null until period is reached", () => {
    expect(sma([1, 2, 3], 5)).toEqual([null, null, null]);
  });

  it("computes simple averages", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("handles constant series", () => {
    const out = sma([7, 7, 7, 7], 2);
    expect(out[3]).toBe(7);
  });
});

describe("ema", () => {
  it("seeds with SMA at index period-1", () => {
    const out = ema([2, 4, 6, 8, 10], 3);
    expect(out[2]).toBe(4);
  });

  it("converges toward constant input", () => {
    const out = ema(new Array(50).fill(5), 10);
    expect(out[49]).toBeCloseTo(5, 10);
  });

  it("returns nulls before seed", () => {
    const out = ema([1, 2, 3], 5);
    expect(out).toEqual([null, null, null]);
  });
});

describe("rma (Wilder)", () => {
  it("seeds with SMA", () => {
    const out = rma([2, 4, 6, 8], 4);
    expect(out[3]).toBe(5);
  });

  it("smooths slower than EMA for same period", () => {
    const data = [1, 1, 1, 1, 1, 10, 10, 10, 10, 10];
    const rmaOut = rma(data, 5);
    const emaOut = ema(data, 5);
    expect(rmaOut[9]).toBeLessThan(emaOut[9]);
  });
});
