import { SIGNAL_PARAMS } from "./signal.js";
import { REGIME_PARAMS } from "./regime.js";

/**
 * Frozen strategy configurations. THE single source of truth for what
 * "production" means — the Scanner and the backtest harness both import from
 * here, so what you validate is exactly what you see live. See
 * docs/STRATEGY-SPEC.md changelog for what was validated and when.
 */

// v1.1 — the original spec: 4-condition weekly regime, both directions,
// anti-chase vetoes, regime-flip exit. Kept for comparability. First real-data
// run (2026-07-18): 0.24R, PF 1.42, p=0.087 — did not clear the bars.
export const PRESET_V1 = {
  name: "v1",
  signalParams: { ...SIGNAL_PARAMS, useRsiVeto: true, useBbVeto: true, allowLong: true, allowShort: true },
  regimeParams: { ...REGIME_PARAMS, use: { sma: true, macd: true, rsi: true, adx: true } },
  exitOnRegimeFlip: true,
};

// v2.0 — PRODUCTION. Donchian 20/10, 50W-SMA-only weekly regime, long-only,
// trailing-stop-only exit, no anti-chase vetoes. Selected from the 2026-07-18
// ablation's convergent evidence (variants 2/10/12/13/15 all pointing the same
// direction) and validated same day: 205 trades, 0.65R, PF 2.4, maxDD 14%,
// permutation p=0.0015, 8/9 assets OOS-positive, cost-robust at 3x slippage.
// Selection-bias caveat applies: chosen after seeing results on this history —
// paper trading is the true out-of-sample. Frozen; do not tune further against
// the same data.
export const PRESET_V2 = {
  name: "v2",
  signalParams: { ...SIGNAL_PARAMS, useRsiVeto: false, useBbVeto: false, allowLong: true, allowShort: false },
  regimeParams: { ...REGIME_PARAMS, use: { sma: true, macd: false, rsi: false, adx: false } },
  exitOnRegimeFlip: false,
};

export const PRODUCTION_PRESET = PRESET_V2;
