import { describe, it, expect } from "vitest";
import { computeMetrics } from "../metrics.js";

const ONE_DAY = 86400;

describe("computeMetrics", () => {
  it("handles empty trades", () => {
    const m = computeMetrics({ trades: [], equityCurve: [], startEquity: 100000 });
    expect(m.numTrades).toBe(0);
    expect(m.winRate).toBe(0);
  });

  it("computes win rate and expectancy from trades", () => {
    const trades = [
      { pnl: 200, rMultiple: 2, barsHeld: 5 },
      { pnl: -100, rMultiple: -1, barsHeld: 3 },
      { pnl: 150, rMultiple: 1.5, barsHeld: 10 },
      { pnl: -100, rMultiple: -1, barsHeld: 2 },
    ];
    const m = computeMetrics({ trades, equityCurve: [{ time: 0, equity: 100150 }], startEquity: 100000 });
    expect(m.numTrades).toBe(4);
    expect(m.winRate).toBe(0.5);
    expect(m.expectancy).toBe((200 - 100 + 150 - 100) / 4);
    expect(m.expectancyR).toBe((2 - 1 + 1.5 - 1) / 4);
    expect(m.profitFactor).toBeCloseTo(350 / 200, 6);
  });

  it("computes max drawdown from equity curve", () => {
    const equityCurve = [
      { time: 0, equity: 100000 },
      { time: ONE_DAY, equity: 110000 },
      { time: ONE_DAY * 2, equity: 95000 },
      { time: ONE_DAY * 3, equity: 88000 },
      { time: ONE_DAY * 4, equity: 92000 },
    ];
    const m = computeMetrics({ trades: [{ pnl: -8000, rMultiple: -1, barsHeld: 1 }], equityCurve, startEquity: 100000 });
    expect(m.maxDD).toBe(22000);
    expect(m.maxDDPct).toBeCloseTo(20, 6);
  });

  it("computes CAGR over multi-year curve", () => {
    const start = 1577836800;
    const oneYear = 365.25 * ONE_DAY;
    const equityCurve = [
      { time: start, equity: 100000 },
      { time: start + oneYear * 2, equity: 144000 },
    ];
    const m = computeMetrics({ trades: [{ pnl: 44000, rMultiple: 5, barsHeld: 1 }], equityCurve, startEquity: 100000 });
    expect(m.cagr).toBeCloseTo(20, 0);
  });
});
