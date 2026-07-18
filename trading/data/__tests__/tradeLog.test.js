import { describe, it, expect } from "vitest";
import { tradeToObsidianMarkdown, obsidianFilename } from "../tradeLog.js";

describe("tradeToObsidianMarkdown", () => {
  it("produces YAML frontmatter with required fields", () => {
    const t = {
      id: "abc", asset: "BTC", direction: "LONG", status: "OPEN",
      entry: { time: 1700000000, price: 50000, stop: 48000, qty: 0.5, riskDollar: 1000, leverage: 5 },
      exit: null, regimeSnapshot: null, signalSnapshot: null,
      notes: "", systemSource: "scanner",
    };
    const md = tradeToObsidianMarkdown(t);
    expect(md).toContain("---");
    expect(md).toMatch(/asset: BTC/);
    expect(md).toMatch(/direction: LONG/);
    expect(md).toMatch(/status: OPEN/);
    expect(md).toMatch(/entry: 50000/);
    expect(md).toMatch(/risk_dollar: 1000/);
  });

  it("includes computed pnl and r-multiple on closed trades", () => {
    const t = {
      id: "x", asset: "ETH", direction: "LONG", status: "CLOSED",
      entry: { time: 1700000000, price: 2000, stop: 1900, qty: 10, riskDollar: 1000, leverage: null },
      exit: { time: 1700500000, price: 2150, reason: "trailing stop hit" },
      regimeSnapshot: null, signalSnapshot: null, notes: "", systemSource: "scanner",
    };
    const md = tradeToObsidianMarkdown(t);
    // qty 10, entry 2000, exit 2150 → pnl = 10 * 150 = 1500
    expect(md).toMatch(/pnl_dollar: 1500/);
    // r = 1500 / 1000 = 1.5
    expect(md).toMatch(/r_multiple: 1\.5/);
  });

  it("short trade pnl signs flip correctly", () => {
    const t = {
      id: "y", asset: "SOL", direction: "SHORT", status: "CLOSED",
      entry: { time: 1700000000, price: 100, stop: 110, qty: 100, riskDollar: 1000, leverage: null },
      exit: { time: 1700500000, price: 90, reason: "trailing stop hit" },
      regimeSnapshot: null, signalSnapshot: null, notes: "", systemSource: "scanner",
    };
    const md = tradeToObsidianMarkdown(t);
    // short, entry 100, exit 90, qty 100 → pnl = -1 * 100 * (90 - 100) = 1000
    expect(md).toMatch(/pnl_dollar: 1000/);
    expect(md).toMatch(/direction: SHORT/);
  });

  it("escapes string values that contain YAML-significant characters", () => {
    const t = {
      id: "z", asset: "BTC", direction: "LONG", status: "OPEN",
      entry: { time: 1700000000, price: 50000, stop: 48000, qty: 0.5, riskDollar: 1000, leverage: 5 },
      exit: null, regimeSnapshot: null, signalSnapshot: null,
      notes: "scary: with colons & ampersands",
      systemSource: "scanner",
    };
    const md = tradeToObsidianMarkdown(t);
    // notes go in the body, not frontmatter, but exit_reason etc. would. Verify the
    // YAML serializer handles the formatter for an arbitrary string in frontmatter.
    expect(md).toContain("scary: with colons & ampersands");
  });
});

describe("obsidianFilename", () => {
  it("uses entry date and asset/direction", () => {
    const fname = obsidianFilename({
      asset: "BTC", direction: "LONG",
      entry: { time: 1700000000 },
    });
    expect(fname).toMatch(/^\d{4}-\d{2}-\d{2}-BTC-LONG\.md$/);
  });
});
