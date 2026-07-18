import { describe, it, expect } from "vitest";
import { buildDailyFundingMap, accrueFunding, dayKey } from "../funding.js";
import { backtestOne } from "../engine.js";

const ONE_DAY = 86400, ONE_WEEK = ONE_DAY * 7;

function makeDaily(closes, startTime = 1577836800) {
  return closes.map((c, i) => ({
    time: startTime + i * ONE_DAY, closeTime: startTime + (i + 1) * ONE_DAY - 1,
    open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000, takerBuyBase: 550,
  }));
}
function makeWeekly(closes, startTime = 1577836800) {
  return closes.map((c, i) => ({
    time: startTime + i * ONE_WEEK, closeTime: startTime + (i + 1) * ONE_WEEK - 1,
    open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000, takerBuyBase: 550,
  }));
}
function fixture() {
  const weekly = makeWeekly(Array.from({ length: 150 }, (_, i) => 100 + i * 2 + Math.sin(i / 4) * 8));
  const daily = makeDaily(
    Array.from({ length: 700 }, (_, i) => 100 + i * 0.3 + Math.sin(i / 12) * 12),
    weekly[0].time,
  );
  return { weekly, daily };
}

describe("buildDailyFundingMap", () => {
  it("sums multiple settlements on the same UTC day", () => {
    const t0 = 1700000000 - (1700000000 % 86400); // midnight
    const map = buildDailyFundingMap([
      { time: t0, fundingRate: 0.0001 },
      { time: t0 + 8 * 3600, fundingRate: 0.0002 },
      { time: t0 + 16 * 3600, fundingRate: 0.0003 },
      { time: t0 + 86400, fundingRate: 0.0005 }, // next day
    ]);
    expect(map.get(dayKey(t0))).toBeCloseTo(0.0006, 10);
    expect(map.get(dayKey(t0 + 86400))).toBeCloseTo(0.0005, 10);
  });

  it("handles null/empty input", () => {
    expect(buildDailyFundingMap(null).size).toBe(0);
    expect(buildDailyFundingMap([]).size).toBe(0);
  });
});

describe("accrueFunding sign convention", () => {
  it("long pays positive funding, short receives it", () => {
    const long = accrueFunding({ direction: "LONG", qty: 10, markPrice: 100, rateSum: 0.001 });
    const short = accrueFunding({ direction: "SHORT", qty: 10, markPrice: 100, rateSum: 0.001 });
    expect(long).toBeCloseTo(1, 10);   // cost
    expect(short).toBeCloseTo(-1, 10); // credit
  });

  it("long receives negative funding", () => {
    const long = accrueFunding({ direction: "LONG", qty: 10, markPrice: 100, rateSum: -0.001 });
    expect(long).toBeCloseTo(-1, 10);
  });
});

describe("engine with funding", () => {
  it("positive funding reduces final equity for a long-only run", () => {
    const { weekly, daily } = fixture();
    // constant positive funding every day of the fixture
    const funding = daily.map((b) => ({ time: b.time, fundingRate: 0.0003 }));
    const withOut = backtestOne({ weekly, daily, feePct: 0, slippagePct: 0 });
    const withF = backtestOne({ weekly, daily, feePct: 0, slippagePct: 0, funding });
    expect(withF.finalEquity).toBeLessThan(withOut.finalEquity);
    // every trade in this uptrend fixture is a LONG holding through positive funding
    withF.trades.forEach((t) => expect(t.fundingCost).toBeGreaterThan(0));
  });

  it("funding does not change trade count or entries, only P&L", () => {
    const { weekly, daily } = fixture();
    const funding = daily.map((b) => ({ time: b.time, fundingRate: 0.0003 }));
    const a = backtestOne({ weekly, daily, feePct: 0 });
    const b = backtestOne({ weekly, daily, feePct: 0, funding });
    expect(a.trades.length).toBe(b.trades.length);
    a.trades.forEach((t, i) => expect(t.entryTime).toBe(b.trades[i].entryTime));
  });
});
