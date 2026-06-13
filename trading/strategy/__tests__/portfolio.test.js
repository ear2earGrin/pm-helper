import { describe, it, expect } from "vitest";
import { checkPortfolioAllows, PORTFOLIO_PARAMS } from "../portfolio.js";

const candidate = { asset: "SOL", direction: "LONG", riskPct: 1 };

describe("checkPortfolioAllows", () => {
  it("allows when nothing is open", () => {
    const r = checkPortfolioAllows({
      candidate,
      openPositions: [],
      recentlyStopped: [],
      todayEntries: 0,
    });
    expect(r.allowed).toBe(true);
  });

  it("blocks at concurrent cap", () => {
    const openPositions = Array.from({ length: PORTFOLIO_PARAMS.maxConcurrent }, (_, i) => ({
      asset: `ALT${i}`, direction: "LONG", riskPct: 0.5,
    }));
    const r = checkPortfolioAllows({ candidate, openPositions, recentlyStopped: [], todayEntries: 0 });
    expect(r.allowed).toBe(false);
  });

  it("blocks a second entry in the same day", () => {
    const r = checkPortfolioAllows({ candidate, openPositions: [], recentlyStopped: [], todayEntries: 1 });
    expect(r.allowed).toBe(false);
  });

  it("blocks when re-entry cooldown is active", () => {
    const r = checkPortfolioAllows({
      candidate,
      openPositions: [],
      recentlyStopped: [{ asset: "SOL", daysSince: 1 }],
      todayEntries: 0,
    });
    expect(r.allowed).toBe(false);
  });

  it("treats BTC and ETH as one correlated unit in the same direction", () => {
    const r = checkPortfolioAllows({
      candidate: { asset: "ETH", direction: "LONG", riskPct: 1 },
      openPositions: [{ asset: "BTC", direction: "LONG", riskPct: 1 }],
      recentlyStopped: [],
      todayEntries: 0,
    });
    expect(r.allowed).toBe(false);
  });

  it("blocks if open risk would exceed sector cap", () => {
    const r = checkPortfolioAllows({
      candidate: { asset: "SOL", direction: "LONG", riskPct: 1 },
      openPositions: [
        { asset: "AVAX", direction: "LONG", riskPct: 1 },
        { asset: "LINK", direction: "SHORT", riskPct: 1 },
        { asset: "BTC", direction: "LONG", riskPct: 1 },
        { asset: "DOGE", direction: "SHORT", riskPct: 1 },
      ],
      recentlyStopped: [],
      todayEntries: 0,
    });
    expect(r.allowed).toBe(false);
  });
});
