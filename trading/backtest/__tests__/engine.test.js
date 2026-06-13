import { describe, it, expect } from "vitest";
import { backtestOne } from "../engine.js";

const ONE_DAY = 86400;
const ONE_WEEK = ONE_DAY * 7;

function makeDaily(closes, startTime = 1577836800) {
  return closes.map((c, i) => ({
    time: startTime + i * ONE_DAY,
    closeTime: startTime + (i + 1) * ONE_DAY - 1,
    open: c,
    high: c * 1.005,
    low: c * 0.995,
    close: c,
  }));
}

function makeWeekly(closes, startTime = 1577836800) {
  return closes.map((c, i) => ({
    time: startTime + i * ONE_WEEK,
    closeTime: startTime + (i + 1) * ONE_WEEK - 1,
    open: c,
    high: c * 1.005,
    low: c * 0.995,
    close: c,
  }));
}

describe("backtestOne", () => {
  it("returns empty trades on insufficient data", () => {
    const res = backtestOne({
      weekly: makeWeekly([100, 101]),
      daily: makeDaily([100, 101, 102]),
    });
    expect(res.trades).toEqual([]);
    expect(res.finalEquity).toBe(100000);
  });

  function trendFixture() {
    const weekly = makeWeekly(
      Array.from({ length: 150 }, (_, i) => 100 + i * 2 + Math.sin(i / 4) * 8),
    );
    const daily = makeDaily(
      Array.from({ length: 700 }, (_, i) => 100 + i * 0.3 + Math.sin(i / 12) * 12),
      weekly[0].time,
    );
    return { weekly, daily };
  }

  it("takes long trades in a clean uptrend with pullbacks", () => {
    const { weekly, daily } = trendFixture();
    const res = backtestOne({ weekly, daily, startEquity: 100000, riskPct: 1, feePct: 0 });
    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    expect(res.equityCurve.length).toBe(daily.length);
    res.trades.forEach((t) => expect(t.direction).toBe("LONG"));
  });

  it("losing trades stay near the risk budget (~ -1R)", () => {
    const { weekly, daily } = trendFixture();
    const res = backtestOne({ weekly, daily, startEquity: 100000, riskPct: 1, feePct: 0 });
    res.trades
      .filter((t) => t.pnl < 0)
      .forEach((t) => {
        expect(t.pnl).toBeGreaterThanOrEqual(-1200);
      });
  });

  it("first trade risks ~1% of starting equity", () => {
    const { weekly, daily } = trendFixture();
    const res = backtestOne({ weekly, daily, startEquity: 100000, riskPct: 1, feePct: 0 });
    expect(res.trades.length).toBeGreaterThan(0);
    const first = res.trades[0];
    const dollarRisk = first.qty * Math.abs(first.entry - first.initialStop);
    expect(dollarRisk).toBeCloseTo(1000, 0);
  });

  it("subsequent trades scale risk with grown equity (fixed-fractional)", () => {
    const { weekly, daily } = trendFixture();
    const res = backtestOne({ weekly, daily, startEquity: 100000, riskPct: 1, feePct: 0 });
    if (res.trades.length >= 2 && res.trades[0].pnl > 0) {
      const second = res.trades[1];
      const dollarRisk = second.qty * Math.abs(second.entry - second.initialStop);
      expect(dollarRisk).toBeGreaterThan(1000);
    }
  });
});
