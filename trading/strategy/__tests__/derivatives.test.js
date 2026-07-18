import { describe, it, expect } from "vitest";
import { assessDerivatives } from "../derivatives.js";

describe("assessDerivatives", () => {
  it("flags stand-down on a long into extremely crowded long funding", () => {
    const r = assessDerivatives({ direction: "LONG", fundingRate: 0.0012, oiChangePct: null, cvdSlope: null });
    expect(r.grade).toBe("CROWDED");
    expect(r.standDown).toBe(true);
  });

  it("flags stand-down on a short into extremely crowded short funding", () => {
    const r = assessDerivatives({ direction: "SHORT", fundingRate: -0.0012, oiChangePct: null, cvdSlope: null });
    expect(r.standDown).toBe(true);
  });

  it("treats funding on the opposite side as favorable (contrarian to crowd)", () => {
    // We're LONG, crowd is heavily SHORT (negative funding) -> favorable
    const r = assessDerivatives({ direction: "LONG", fundingRate: -0.0008, oiChangePct: 5, cvdSlope: 0.2 });
    expect(r.grade).toBe("CONFIRMED");
    expect(r.standDown).toBe(false);
  });

  it("rising OI plus aligned flow confirms an entry", () => {
    const r = assessDerivatives({ direction: "LONG", fundingRate: 0.0001, oiChangePct: 6, cvdSlope: 0.3 });
    expect(r.confirm).toBeGreaterThanOrEqual(2);
    expect(r.grade).toBe("CONFIRMED");
  });

  it("falling OI plus diverging flow raises caution but not necessarily stand-down", () => {
    const r = assessDerivatives({ direction: "LONG", fundingRate: 0.0001, oiChangePct: -5, cvdSlope: -0.3 });
    expect(r.crowding).toBeGreaterThanOrEqual(2);
    expect(r.standDown).toBe(true);
  });

  it("returns NEUTRAL when no derivatives data is available", () => {
    const r = assessDerivatives({ direction: "LONG", fundingRate: null, oiChangePct: null, cvdSlope: null });
    expect(r.grade).toBe("NEUTRAL");
    expect(r.standDown).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("never auto-generates a direction — it only grades the one given", () => {
    const long = assessDerivatives({ direction: "LONG", fundingRate: 0.0012, oiChangePct: null, cvdSlope: null });
    const short = assessDerivatives({ direction: "SHORT", fundingRate: 0.0012, oiChangePct: null, cvdSlope: null });
    // Same funding, opposite trades: crowded for the long, favorable-ish for the short.
    expect(long.standDown).toBe(true);
    expect(short.standDown).toBe(false);
  });
});
