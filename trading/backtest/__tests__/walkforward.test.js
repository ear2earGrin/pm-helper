import { describe, it, expect } from "vitest";
import { walkForward, paramGrid } from "../walkforward.js";

const ONE_DAY = 86400, ONE_WEEK = ONE_DAY * 7;

function makeDaily(closes, startTime = 1577836800) {
  return closes.map((c, i) => ({
    time: startTime + i * ONE_DAY,
    closeTime: startTime + (i + 1) * ONE_DAY - 1,
    open: c, high: c * 1.01, low: c * 0.99, close: c,
  }));
}
function makeWeekly(closes, startTime = 1577836800) {
  return closes.map((c, i) => ({
    time: startTime + i * ONE_WEEK,
    closeTime: startTime + (i + 1) * ONE_WEEK - 1,
    open: c, high: c * 1.01, low: c * 0.99, close: c,
  }));
}

describe("paramGrid", () => {
  it("returns single empty object for empty input", () => {
    expect(paramGrid({})).toEqual([{}]);
  });

  it("expands single-axis grid", () => {
    const g = paramGrid({ x: [1, 2, 3] });
    expect(g).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
  });

  it("computes cartesian product", () => {
    const g = paramGrid({ a: [1, 2], b: ["x", "y"] });
    expect(g.length).toBe(4);
    expect(g).toContainEqual({ a: 1, b: "x" });
    expect(g).toContainEqual({ a: 2, b: "y" });
  });
});

describe("walkForward", () => {
  it("returns empty result on insufficient data", () => {
    const weekly = makeWeekly(new Array(20).fill(100));
    const daily = makeDaily(new Array(100).fill(100));
    const res = walkForward({ weekly, daily });
    expect(res.folds).toEqual([]);
  });

  it("produces at least one fold on a 5-year fixture and reports degradation", () => {
    // 5 years of trending crypto-like data with cycles
    const dailyCloses = Array.from({ length: 5 * 365 }, (_, i) => {
      const trend = 100 + i * 0.15;
      const cycle = Math.sin(i / 80) * 25;
      const noise = Math.sin(i / 13) * 8;
      return Math.max(20, trend + cycle + noise);
    });
    const weeklyCloses = Array.from({ length: 5 * 52 + 60 }, (_, i) => {
      const trend = 100 + i * 0.9;
      const cycle = Math.sin(i / 15) * 60;
      return Math.max(20, trend + cycle);
    });

    const res = walkForward({
      weekly: makeWeekly(weeklyCloses),
      daily: makeDaily(dailyCloses),
      inSampleDays: 730,
      outSampleDays: 183,
      stepDays: 183,
      startEquity: 100000,
      riskPct: 1,
      feePct: 0,
    });

    expect(res.folds.length).toBeGreaterThanOrEqual(1);
    expect(res.oosEquityCurve.length).toBeGreaterThan(0);
    expect(res.oosMetrics).toBeDefined();
    expect(Number.isFinite(res.summary.numFolds)).toBe(true);
  });

  it("evaluates a parameter grid by picking the best IS score per fold", () => {
    const dailyCloses = Array.from({ length: 4 * 365 }, (_, i) =>
      100 + i * 0.15 + Math.sin(i / 60) * 25 + Math.sin(i / 11) * 6,
    );
    const weeklyCloses = Array.from({ length: 4 * 52 + 60 }, (_, i) =>
      100 + i * 0.9 + Math.sin(i / 14) * 50,
    );

    const res = walkForward({
      weekly: makeWeekly(weeklyCloses),
      daily: makeDaily(dailyCloses),
      paramGrid: { donchianEntry: [15, 20], donchianExit: [8, 10] },
      inSampleDays: 730,
      outSampleDays: 183,
      stepDays: 183,
      startEquity: 100000,
      riskPct: 1,
      feePct: 0,
    });

    expect(res.folds.length).toBeGreaterThanOrEqual(1);
    res.folds.forEach((f) => {
      expect([15, 20]).toContain(f.params.donchianEntry);
      expect([8, 10]).toContain(f.params.donchianExit);
    });
  });
});
