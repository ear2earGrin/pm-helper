import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sma, ema, rma } from "../sma.js";
import { rsi } from "../rsi.js";
import { macd } from "../macd.js";
import { atr, trueRange } from "../atr.js";
import { adx } from "../adx.js";
import { donchian, donchianCloses } from "../donchian.js";
import { bollinger } from "../bollinger.js";

/**
 * Property-based tests. Each property is a mathematical invariant that must hold
 * for *any* input — not just the fixtures we happen to think of.
 *
 * If a successor model "improves" an indicator and breaks a property, fast-check
 * shrinks the failing input to the minimal reproduction. These are the strongest
 * guardrails in the test suite.
 */

const closes = (min = 30, max = 200) =>
  fc.array(fc.float({ min: 1, max: 100000, noNaN: true, noDefaultInfinity: true }), { minLength: min, maxLength: max });

const candles = (min = 30, max = 200) =>
  closes(min, max).map((cs) =>
    cs.map((c) => ({
      open: c,
      high: c * 1.01,
      low: c * 0.99,
      close: c,
    })),
  );

const period = (min = 2, max = 30) => fc.integer({ min, max });

describe("SMA properties", () => {
  it("returns null exactly for the first (period-1) indices", () => {
    fc.assert(fc.property(closes(), period(), (vs, p) => {
      const out = sma(vs, p);
      expect(out.length).toBe(vs.length);
      for (let i = 0; i < Math.min(p - 1, vs.length); i++) expect(out[i]).toBeNull();
    }));
  });

  it("equals arithmetic mean of trailing window when defined", () => {
    fc.assert(fc.property(closes(20, 80), period(2, 10), (vs, p) => {
      const out = sma(vs, p);
      for (let i = p - 1; i < vs.length; i++) {
        let sum = 0;
        for (let j = i - p + 1; j <= i; j++) sum += vs[j];
        expect(out[i]).toBeCloseTo(sum / p, 6);
      }
    }));
  });
});

describe("EMA properties", () => {
  it("output bounded between min and max of inputs (post-warmup)", () => {
    fc.assert(fc.property(closes(30, 100), period(2, 15), (vs, p) => {
      const out = ema(vs, p);
      const lo = Math.min(...vs), hi = Math.max(...vs);
      for (let i = p - 1; i < out.length; i++) {
        expect(out[i]).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(out[i]).toBeLessThanOrEqual(hi + 1e-9);
      }
    }));
  });
});

describe("RMA properties", () => {
  it("is bounded by input range post-warmup", () => {
    fc.assert(fc.property(closes(30, 100), period(2, 15), (vs, p) => {
      const out = rma(vs, p);
      const lo = Math.min(...vs), hi = Math.max(...vs);
      for (let i = p - 1; i < out.length; i++) {
        expect(out[i]).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(out[i]).toBeLessThanOrEqual(hi + 1e-9);
      }
    }));
  });
});

describe("RSI properties", () => {
  it("always in [0, 100] when defined", () => {
    fc.assert(fc.property(closes(30, 100), period(2, 20), (vs, p) => {
      const out = rsi(vs, p);
      for (const v of out) {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }));
  });
});

describe("MACD properties", () => {
  it("hist exactly equals macd - signal where both are defined", () => {
    fc.assert(fc.property(closes(60, 120), (vs) => {
      const { macd: m, signal, hist } = macd(vs, 12, 26, 9);
      for (let i = 0; i < vs.length; i++) {
        if (m[i] !== null && signal[i] !== null) {
          expect(hist[i]).toBeCloseTo(m[i] - signal[i], 8);
        }
      }
    }));
  });
});

describe("ATR / TR properties", () => {
  it("True Range is always >= high - low for any bar", () => {
    fc.assert(fc.property(candles(20, 80), (cs) => {
      const tr = trueRange(cs);
      for (let i = 0; i < cs.length; i++) {
        expect(tr[i]).toBeGreaterThanOrEqual(cs[i].high - cs[i].low - 1e-9);
      }
    }));
  });

  it("ATR is non-negative when defined", () => {
    fc.assert(fc.property(candles(40, 100), period(2, 20), (cs, p) => {
      const out = atr(cs, p);
      for (const v of out) if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
    }));
  });
});

describe("ADX properties", () => {
  it("plusDI, minusDI, adx all in [0, 100] when defined", () => {
    fc.assert(fc.property(candles(60, 150), period(5, 20), (cs, p) => {
      const { plusDI, minusDI, adx: a } = adx(cs, p);
      for (const arr of [plusDI, minusDI, a]) {
        for (const v of arr) {
          if (v !== null) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(100);
          }
        }
      }
    }));
  });
});

describe("Donchian properties", () => {
  it("upper >= middle >= lower at every defined index", () => {
    fc.assert(fc.property(candles(30, 100), period(2, 20), (cs, p) => {
      const { upper, middle, lower } = donchian(cs, p);
      for (let i = p - 1; i < cs.length; i++) {
        expect(upper[i]).toBeGreaterThanOrEqual(middle[i] - 1e-9);
        expect(middle[i]).toBeGreaterThanOrEqual(lower[i] - 1e-9);
      }
    }));
  });

  it("donchianCloses upper bounded by max of all closes (no future leak)", () => {
    fc.assert(fc.property(closes(30, 100), period(2, 20), (vs, p) => {
      const { upper } = donchianCloses(vs, p);
      for (let i = p - 1; i < vs.length; i++) {
        let maxSoFar = -Infinity;
        for (let j = i - p + 1; j <= i; j++) if (vs[j] > maxSoFar) maxSoFar = vs[j];
        expect(upper[i]).toBeCloseTo(maxSoFar, 6);
      }
    }));
  });
});

describe("Bollinger properties", () => {
  it("upper >= basis >= lower at every defined index", () => {
    fc.assert(fc.property(closes(30, 100), period(2, 20), (vs, p) => {
      const { basis, upper, lower } = bollinger(vs, p, 2);
      for (let i = p - 1; i < vs.length; i++) {
        expect(upper[i]).toBeGreaterThanOrEqual(basis[i] - 1e-9);
        expect(basis[i]).toBeGreaterThanOrEqual(lower[i] - 1e-9);
      }
    }));
  });

  it("band width scales linearly with mult", () => {
    fc.assert(fc.property(closes(30, 80), period(5, 20), (vs, p) => {
      const a = bollinger(vs, p, 1);
      const b = bollinger(vs, p, 3);
      for (let i = p - 1; i < vs.length; i++) {
        const widthA = a.upper[i] - a.basis[i];
        const widthB = b.upper[i] - b.basis[i];
        if (widthA > 1e-9) expect(widthB / widthA).toBeCloseTo(3, 4);
      }
    }));
  });
});
