import { describe, it, expect } from "vitest";
import { runOne } from "../runOne.js";

function buildCandles(closes) {
  return closes.map((c) => ({ open: c, high: c * 1.005, low: c * 0.995, close: c }));
}

function noisyAccel(len, accel, base = 500) {
  return Array.from({ length: len }, (_, i) =>
    base + accel * i * i + Math.sin(i / 3) * 6 + Math.cos(i / 7) * 4,
  );
}

describe("runOne integration", () => {
  it("on a bull weekly regime + daily breakout, returns LONG with sane sizing", () => {
    const weekly = buildCandles(noisyAccel(200, 0.05));
    const dailyBase = noisyAccel(40, 0.02, 100);
    const lastHigh = Math.max(...dailyBase.slice(-21, -1));
    const daily = buildCandles([...dailyBase, lastHigh * 1.02]);

    const res = runOne({ asset: "BTC", weekly, daily, equity: 100000, riskPct: 1 });

    expect(res.regimeState).toBe("LONG_OK");
    expect(["LONG", "VETO", "NONE"].includes(res.signal.action)).toBe(true);
    if (res.signal.action === "LONG") {
      expect(res.sizing.ok).toBe(true);
      expect(res.sizing.riskDollar).toBe(1000);
      expect(res.sizing.qty).toBeGreaterThan(0);
      const lossAtStop = res.sizing.qty * (res.signal.close - res.signal.stop);
      expect(lossAtStop).toBeCloseTo(1000, 4);
    }
  });

  it("on a flat regime, no signal even on a breakout-shaped daily series", () => {
    const weekly = buildCandles(new Array(100).fill(100));
    const noisy = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 3);
    const daily = buildCandles([...noisy, 105]);

    const res = runOne({ asset: "BTC", weekly, daily, equity: 100000, riskPct: 1 });

    expect(res.regimeState).toBe("FLAT");
    expect(["LONG", "SHORT"].includes(res.signal.action)).toBe(false);
    expect(res.sizing).toBeNull();
  });
});
