import { describe, it, expect } from "vitest";
import { legPayoff, payoffAt, netCost, tailSlopes, analyze } from "../payoff.js";

const longCall = (k, p, qty = 1) => ({ type: "call", side: "long", strike: k, premium: p, qty });
const longPut = (k, p, qty = 1) => ({ type: "put", side: "long", strike: k, premium: p, qty });

describe("single leg payoff", () => {
  it("long call loses the premium below the strike and breaks even at strike+premium", () => {
    const leg = longCall(100, 5);
    expect(legPayoff(leg, 90)).toBe(-5);
    expect(legPayoff(leg, 105)).toBe(0);
    expect(legPayoff(leg, 120)).toBe(15);
  });

  it("short put collects premium, then pays out below the strike", () => {
    const leg = { type: "put", side: "short", strike: 100, premium: 4, qty: 1 };
    expect(legPayoff(leg, 110)).toBe(4); // expires worthless, keep premium
    expect(legPayoff(leg, 96)).toBeCloseTo(0, 6); // breakeven (avoid -0 vs +0)
    expect(legPayoff(leg, 90)).toBe(-6);
  });
});

describe("long straddle (K=100, 4+4)", () => {
  const legs = [longCall(100, 4), longPut(100, 4)];
  it("max loss at the strike equals total premium", () => {
    expect(payoffAt(legs, 100)).toBe(-8);
    expect(netCost(legs)).toBe(8);
  });
  it("breaks even at strike +/- total premium", () => {
    const { breakevens } = analyze(legs, { spot: 100 });
    expect(breakevens.length).toBe(2);
    expect(breakevens[0]).toBeCloseTo(92, 1);
    expect(breakevens[1]).toBeCloseTo(108, 1);
  });
});

describe("strip vs strap asymmetry", () => {
  it("strip (1 call + 2 puts) breaks even at 94 down / 112 up", () => {
    const legs = [longCall(100, 4, 1), longPut(100, 4, 2)];
    expect(netCost(legs)).toBe(12);
    expect(payoffAt(legs, 100)).toBe(-12);
    const { breakevens } = analyze(legs, { spot: 100 });
    expect(breakevens[0]).toBeCloseTo(94, 1);
    expect(breakevens[1]).toBeCloseTo(112, 1);
  });
  it("strap (2 calls + 1 put) breaks even at 88 down / 106 up", () => {
    const legs = [longCall(100, 4, 2), longPut(100, 4, 1)];
    expect(netCost(legs)).toBe(12);
    const { breakevens } = analyze(legs, { spot: 100 });
    expect(breakevens[0]).toBeCloseTo(88, 1);
    expect(breakevens[1]).toBeCloseTo(106, 1);
  });
});

describe("unbounded tails", () => {
  it("long call has unlimited max profit, capped loss", () => {
    const a = analyze([longCall(100, 5)], { spot: 100 });
    expect(a.maxProfit).toBe(Infinity);
    expect(a.maxLoss).toBe(-5);
  });
  it("short call has unlimited max loss, capped profit", () => {
    const a = analyze([{ type: "call", side: "short", strike: 100, premium: 5, qty: 1 }], { spot: 100 });
    expect(a.maxLoss).toBe(-Infinity);
    expect(a.maxProfit).toBe(5);
  });
  it("tail slopes reflect net call/put exposure", () => {
    expect(tailSlopes([longCall(100, 5)]).right).toBe(1);
    expect(tailSlopes([longPut(100, 5)]).left).toBe(-1);
  });
});

describe("bull call spread is fully bounded", () => {
  it("caps both profit and loss", () => {
    const legs = [longCall(100, 5), { type: "call", side: "short", strike: 110, premium: 2, qty: 1 }];
    const a = analyze(legs, { spot: 100 });
    expect(a.netCost).toBe(3); // 5 paid - 2 received
    expect(a.maxLoss).toBeCloseTo(-3, 6); // below 100
    expect(a.maxProfit).toBeCloseTo(7, 6); // (110-100) - 3
    expect(Number.isFinite(a.maxProfit)).toBe(true);
  });
});
