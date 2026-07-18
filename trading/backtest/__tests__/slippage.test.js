import { describe, it, expect } from "vitest";
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

describe("slippage", () => {
  it("higher slippage never improves net P&L", () => {
    const { weekly, daily } = fixture();
    const clean = backtestOne({ weekly, daily, feePct: 0, slippagePct: 0 });
    const slipped = backtestOne({ weekly, daily, feePct: 0, slippagePct: 0.1 });
    expect(slipped.finalEquity).toBeLessThanOrEqual(clean.finalEquity + 1e-6);
  });

  it("produces the same number of trades regardless of slippage (only prices change)", () => {
    const { weekly, daily } = fixture();
    const a = backtestOne({ weekly, daily, feePct: 0, slippagePct: 0 });
    const b = backtestOne({ weekly, daily, feePct: 0, slippagePct: 0.2 });
    expect(a.trades.length).toBe(b.trades.length);
  });
});
