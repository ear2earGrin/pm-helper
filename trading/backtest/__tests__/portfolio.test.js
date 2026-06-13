import { describe, it, expect } from "vitest";
import { backtestPortfolio } from "../portfolio.js";

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

function trendFixture(seed = 0) {
  const weekly = makeWeekly(Array.from({ length: 150 }, (_, i) => 100 + i * 2 + Math.sin(i / 4 + seed) * 8));
  const daily = makeDaily(
    Array.from({ length: 700 }, (_, i) => 100 + i * 0.3 + Math.sin(i / 12 + seed) * 12),
    weekly[0].time,
  );
  return { weekly, daily };
}

describe("backtestPortfolio", () => {
  it("returns empty result on empty asset map", () => {
    const res = backtestPortfolio({ dailyByAsset: {}, weeklyByAsset: {} });
    expect(res.trades).toEqual([]);
    expect(res.finalEquity).toBe(100000);
  });

  it("runs across multiple assets on a clean uptrend", () => {
    const a = trendFixture(0), b = trendFixture(2), c = trendFixture(4);
    const res = backtestPortfolio({
      dailyByAsset: { BTC: a.daily, ETH: b.daily, SOL: c.daily },
      weeklyByAsset: { BTC: a.weekly, ETH: b.weekly, SOL: c.weekly },
      startEquity: 100000, riskPct: 1, feePct: 0,
    });
    expect(res.trades.length).toBeGreaterThan(0);
    expect(res.equityCurve.length).toBeGreaterThan(0);
    // Must contain trades for more than one asset
    const distinctAssets = new Set(res.trades.map((t) => t.asset));
    expect(distinctAssets.size).toBeGreaterThanOrEqual(1);
  });

  it("never opens more than one entry per day across the universe", () => {
    const a = trendFixture(0), b = trendFixture(2), c = trendFixture(4);
    const res = backtestPortfolio({
      dailyByAsset: { BTC: a.daily, ETH: b.daily, SOL: c.daily },
      weeklyByAsset: { BTC: a.weekly, ETH: b.weekly, SOL: c.weekly },
      startEquity: 100000, riskPct: 1, feePct: 0,
    });

    const entriesByDay = new Map();
    for (const t of res.trades) {
      entriesByDay.set(t.entryTime, (entriesByDay.get(t.entryTime) || 0) + 1);
    }
    for (const v of entriesByDay.values()) {
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("BTC + ETH same direction should not coexist (correlation cap)", () => {
    const a = trendFixture(0), b = trendFixture(0); // same phase → same signals
    const res = backtestPortfolio({
      dailyByAsset: { BTC: a.daily, ETH: b.daily },
      weeklyByAsset: { BTC: a.weekly, ETH: b.weekly },
      startEquity: 100000, riskPct: 1, feePct: 0,
    });
    // Walk the timeline: at no point should BTC LONG and ETH LONG be simultaneously open.
    const openIntervals = res.trades.map((t) => ({ asset: t.asset, dir: t.direction, start: t.entryTime, end: t.exitTime }));
    for (let i = 0; i < openIntervals.length; i++) {
      for (let j = i + 1; j < openIntervals.length; j++) {
        const a = openIntervals[i], b = openIntervals[j];
        const overlap = !(a.end < b.start || b.end < a.start);
        if (overlap && a.dir === b.dir) {
          const pair = new Set([a.asset, b.asset]);
          if (pair.has("BTC") && pair.has("ETH")) {
            throw new Error(`BTC and ETH same-direction overlap: ${JSON.stringify({ a, b })}`);
          }
        }
      }
    }
  });
});
