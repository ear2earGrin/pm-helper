import { describe, it, expect } from "vitest";
import { sizePosition } from "../sizing.js";

describe("sizePosition", () => {
  it("computes qty such that loss at stop equals risk budget", () => {
    const r = sizePosition({ equity: 100000, riskPct: 1, entry: 100, stop: 95, direction: "LONG" });
    expect(r.ok).toBe(true);
    expect(r.riskDollar).toBe(1000);
    expect(r.qty).toBeCloseTo(200, 6);
    const lossAtStop = r.qty * (100 - 95);
    expect(lossAtStop).toBeCloseTo(1000, 6);
  });

  it("rejects long where stop is above entry", () => {
    const r = sizePosition({ equity: 100000, riskPct: 1, entry: 100, stop: 105, direction: "LONG" });
    expect(r.ok).toBe(false);
  });

  it("rejects short where stop is below entry", () => {
    const r = sizePosition({ equity: 100000, riskPct: 1, entry: 100, stop: 95, direction: "SHORT" });
    expect(r.ok).toBe(false);
  });

  it("warns if leverage cap can't support notional", () => {
    const r = sizePosition({
      equity: 1000,
      riskPct: 1,
      entry: 100,
      stop: 99.99,
      direction: "LONG",
      leverage: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
