import { describe, it, expect } from "vitest";
import { bootstrapTradeSequence, permutationEdgeTest } from "../montecarlo.js";

describe("bootstrapTradeSequence", () => {
  it("returns empty distributions on empty trade list", () => {
    const res = bootstrapTradeSequence([]);
    expect(res.runs).toBe(0);
    expect(res.returnsPct.mean).toBe(0);
  });

  it("produces a sane distribution from a positive-expectancy trade list", () => {
    const trades = [];
    for (let i = 0; i < 50; i++) trades.push({ pnl: i % 3 === 0 ? 1500 : -800 });
    const res = bootstrapTradeSequence(trades, { startEquity: 100000, runs: 1000, seed: 42 });
    expect(res.runs).toBe(1000);
    expect(res.returnsPct.p05).toBeLessThan(res.returnsPct.p95);
    expect(res.returnsPct.median).toBeCloseTo(res.returnsPct.mean, -1);
  });

  it("max drawdown distribution is non-negative", () => {
    const trades = [];
    for (let i = 0; i < 30; i++) trades.push({ pnl: i % 2 === 0 ? 800 : -600 });
    const res = bootstrapTradeSequence(trades, { runs: 500, seed: 7 });
    expect(res.maxDDPct.min).toBeGreaterThanOrEqual(0);
    expect(res.maxDDPct.p95).toBeGreaterThanOrEqual(res.maxDDPct.p05);
  });

  it("is reproducible given the same seed", () => {
    const trades = [];
    for (let i = 0; i < 20; i++) trades.push({ pnl: i % 4 === 0 ? 1200 : -400 });
    const a = bootstrapTradeSequence(trades, { runs: 500, seed: 123 });
    const b = bootstrapTradeSequence(trades, { runs: 500, seed: 123 });
    expect(a.returnsPct.median).toBe(b.returnsPct.median);
    expect(a.maxDDPct.p95).toBe(b.maxDDPct.p95);
  });
});

describe("permutationEdgeTest", () => {
  it("p-value approaches 0 for clearly-edged trade lists", () => {
    const trades = [];
    for (let i = 0; i < 60; i++) trades.push({ pnl: i % 3 === 0 ? 2000 : -500 });
    // Expectancy is positive (avg ~ +166). Random sign flips should rarely beat this.
    const res = permutationEdgeTest(trades, { runs: 2000, seed: 1 });
    expect(res.p).toBeLessThan(0.1);
  });

  it("p-value is high for a no-edge (symmetric) trade list", () => {
    const trades = [];
    for (let i = 0; i < 60; i++) trades.push({ pnl: (i % 2 === 0 ? 1 : -1) * 1000 });
    const res = permutationEdgeTest(trades, { runs: 2000, seed: 1 });
    expect(res.p).toBeGreaterThan(0.3);
  });

  it("returns 0 trades gracefully", () => {
    const res = permutationEdgeTest([]);
    expect(res.runs).toBe(0);
    expect(res.p).toBe(1);
  });

  it("is reproducible given the same seed", () => {
    const trades = [];
    for (let i = 0; i < 40; i++) trades.push({ pnl: i % 3 === 0 ? 1500 : -600 });
    const a = permutationEdgeTest(trades, { runs: 1000, seed: 99 });
    const b = permutationEdgeTest(trades, { runs: 1000, seed: 99 });
    expect(a.p).toBe(b.p);
  });
});
