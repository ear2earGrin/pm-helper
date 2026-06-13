import { describe, it, expect } from "vitest";
import { updatePositionExit, shouldExit } from "../exit.js";

function buildCandles(closes) {
  return closes.map((c) => ({ open: c, high: c * 1.005, low: c * 0.995, close: c }));
}

describe("updatePositionExit", () => {
  it("ratchets long stops up but never down", () => {
    const candles = buildCandles(Array.from({ length: 30 }, (_, i) => 100 + i));
    const pos = { direction: "LONG", stop: 90 };
    const newStop = updatePositionExit(pos, candles);
    expect(newStop).toBeGreaterThanOrEqual(90);
  });

  it("ratchets short stops down but never up", () => {
    const candles = buildCandles(Array.from({ length: 30 }, (_, i) => 200 - i));
    const pos = { direction: "SHORT", stop: 250 };
    const newStop = updatePositionExit(pos, candles);
    expect(newStop).toBeLessThanOrEqual(250);
  });
});

describe("shouldExit", () => {
  it("exits when long close <= stop", () => {
    const r = shouldExit({ direction: "LONG", stop: 100 }, { close: 99 }, "LONG_OK");
    expect(r.exit).toBe(true);
  });

  it("exits when regime flips to FLAT for an open long", () => {
    const r = shouldExit({ direction: "LONG", stop: 50 }, { close: 100 }, "FLAT");
    expect(r.exit).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/regime/);
  });

  it("holds when long close > stop and regime still LONG_OK", () => {
    const r = shouldExit({ direction: "LONG", stop: 90 }, { close: 100 }, "LONG_OK");
    expect(r.exit).toBe(false);
  });
});
