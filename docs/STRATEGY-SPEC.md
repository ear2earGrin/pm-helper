# Strategy Specification

This document is the single source of truth for the mechanical swing strategy. **Code must match this spec; if they conflict, the spec is right and the code has a bug.** A successor agent should read this first, then verify implementation parity.

Owner intent: react, don't predict. Mechanical entry, mechanical exit. The system's job is to remove judgment from the trigger pull. Discretion is reserved for whether to follow the system at all.

---

## 1. Universe

`BTC ETH SOL BNB XRP ADA AVAX LINK DOGE` — all USDT-quoted, Binance spot data for backtest/scanner regardless of where the live trade is executed.

Constants live in `src/pages/Scanner.jsx` (`UNIVERSE`). Changing the universe is a deliberate act, not a default — coins are not added "just to scan more things." Add only if you have a thesis for why the coin's price action obeys momentum.

## 2. Timeframes

- **Regime**: weekly (1W) candles.
- **Signal**: daily (1D) candles.
- **Live**: scanner is run once per day after the daily close. No intraday operation.

Both fetched from Binance spot. The live unclosed candle is **always dropped** (`dropUnclosedCandle`) — we never read information that hasn't fully formed.

## 3. Regime filter (weekly)

For each closed weekly bar, compute:

| Indicator | Param | Used for |
|---|---|---|
| SMA | 50 | Trend direction |
| MACD histogram | (12, 26, 9) | Momentum confirmation |
| RSI | 14 | Bias filter |
| ADX | 14 | Trend strength |

State machine, evaluated on every closed weekly bar:

```
trending  := ADX >= 20
bullChecks := close > SMA50  AND  MACD_hist > 0  AND  RSI > 50
bearChecks := close < SMA50  AND  MACD_hist < 0  AND  RSI < 50

state := LONG_OK   if trending AND bullChecks
       | SHORT_OK  if trending AND bearChecks
       | FLAT      otherwise
       | WARMUP    if any indicator is null
```

Implementation: `src/strategy/regime.js`, `REGIME_PARAMS`.

**Invariants:**
- A bar can only be in one of `LONG_OK / SHORT_OK / FLAT / WARMUP`.
- Mixed signals → `FLAT`, never `LONG_OK` or `SHORT_OK`.
- A bar with ADX < 20 is never `LONG_OK` or `SHORT_OK`, regardless of other indicators.

## 4. Entry signal (daily)

A long entry fires on a daily bar `i` when **all** of the following are true. Otherwise no entry.

```
1.  Regime state at bar i is LONG_OK
    (looked up against the most recently closed weekly bar; see §6 alignment)
2.  close[i] > donchian_close_upper(i-1, period=20)
3.  RSI(i, 14) < 75                                  (anti-chase / not exhausted)
4.  close[i] not "extended" above Bollinger upper band:
       sigma = (BB_upper - BB_basis) / 2
       NOT  close > BB_upper + 0.5 * sigma
       (i.e. close must sit within 2.5 sigmas of the basis)
```

Short entry is the perfect mirror with `SHORT_OK`, lower Donchian, RSI > 25, lower-BB extension.

Initial stop, on entry:

```
atr_stop = close ± 2.5 * ATR(14)                     (- for long, + for short)
struct_stop = donchian_close_lower(i, period=10)     (opposite side for short)
initial_stop = max(atr_stop, struct_stop)            (closer-to-entry of the two for long)
             = min(atr_stop, struct_stop)            (for short)
```

The **closer-to-entry stop wins** — smaller loss when invalidated.

Implementation: `src/strategy/signal.js`, `SIGNAL_PARAMS`.

**Invariants:**
- Action ∈ `LONG / SHORT / VETO / NONE / WAIT`.
- VETO fires when the breakout would have triggered but a filter (RSI, BB extension) blocked it. The trade was *almost* taken — useful diagnostic.
- An entry is never taken without a stop. Sizing math depends on it.

## 5. Exit (daily)

Two ways out, evaluated each daily bar in this order:

### 5.1 Trailing stop (priority)

```
stop_ratchet := donchian_close_lower(i-1, 10)         (long)
              | donchian_close_upper(i-1, 10)         (short)

pos.stop := max(pos.stop, stop_ratchet)               (long: ratchet up only)
          | min(pos.stop, stop_ratchet)               (short: ratchet down only)
```

The stop **only moves in the trade's favor**, never against it.

### 5.2 Stop hit (intrabar)

```
exit if:  long  AND low[i]  <= pos.stop  → fill at pos.stop
       |  short AND high[i] >= pos.stop  → fill at pos.stop
```

Conservative fill (at the stop, not the bar's close). This is closer to reality than optimistic fills and protects backtest honesty.

### 5.3 Regime flip (on close)

```
exit if:  long  AND state[i] != LONG_OK   → fill at close[i]
       |  short AND state[i] != SHORT_OK  → fill at close[i]
```

A regime flip overrides the trailing stop — we don't argue with the weekly chart.

Implementation: `src/strategy/exit.js`, plus the engine loop in `src/backtest/engine.js`.

## 6. Weekly → daily alignment

For each daily bar at time `t`, the regime state used is the one from the **most recent weekly bar whose `closeTime <= t`**. Implemented via binary search in `backtest/engine.js::findLastClosedWeeklyIdx`.

This guarantees no lookahead: a Monday's daily signal uses Friday's weekly close, never the still-forming current week.

## 7. Position sizing

```
risk_dollars = equity * (riskPct / 100)
per_unit_risk = |entry - stop|
qty = risk_dollars / per_unit_risk
notional = qty * entry
```

The dollar loss at the initial stop equals `risk_dollars`, exactly. Leverage is informational, not a sizing input — `required_leverage = notional / equity`.

Default: `riskPct = 1`, `equity = 100_000`. Live trading: $1,000 risk per trade on $100k equity.

Implementation: `src/strategy/sizing.js`.

**Invariants:**
- Stop must be on the correct side of entry (long: stop < entry; short: stop > entry). If not, `sizePosition` returns `ok: false`.
- `qty * |entry - stop| === risk_dollars` to floating-point precision.

## 8. Portfolio rules

Implementation: `src/strategy/portfolio.js`.

- **Max 5 concurrent positions.**
- **Max 1 new entry per day** across the whole portfolio. If multiple signals fire, the rule of thumb is "strongest weekly ADX," but the current `checkPortfolioAllows` just gates on count.
- **Total open risk ≤ 4%.** If new entry would push total open risk above this, skip.
- **Correlation cap**: BTC and ETH in the same direction count as one position. Three or more alt positions in the same direction count as one (informationally) and block further same-direction alt entries.
- **Re-entry cooldown**: 3 days after a stop-out on the same asset.

These rules are **the kill switch** for revenge trading and over-concentration.

## 9. Backtest engine

Implementation: `src/backtest/engine.js::backtestOne`.

- Per-bar replay, one asset.
- Regime computed once on weekly; daily regime states pre-resolved via §6 alignment.
- Signal series computed once over the full daily array (using the per-bar regime array).
- Trailing stop, intrabar stop hit, regime flip — in that order — checked each bar.
- Open position is closed at end-of-data at `close[last]` with reason `"end of data"` so metrics aren't biased by unfinished trades.
- Fees: round-trip `feePct` applied as `(entry + exit) * qty * feePct/100`. Default 0.08%.

## 10. Metrics

Implementation: `src/backtest/metrics.js`.

- `winRate`, `avgWin`, `avgLoss`
- `expectancy` (USDT), `expectancyR` (R-multiples) — for trend systems, `expectancyR > 0.3` is meaningful, `> 0.5` is good
- `profitFactor` = sum(wins) / |sum(losses)|. > 1.5 acceptable, > 2 strong
- `totalReturn`, `totalReturnPct`, `cagr`
- `maxDD`, `maxDDPct`, `maxDDDays`
- `avgBarsHeld`, `bestTrade`, `worstTrade`

## 11. Hard-coded thresholds and their rationale

Anything magic in the code that a successor model might want to "clean up" — don't, unless you understand why:

| Constant | Where | Rationale |
|---|---|---|
| `adxMin = 20` | regime | Standard Wilder threshold for "trending." Below this is chop. |
| `rsiLongMax = 75` / `rsiShortMin = 25` | signal | Anti-chase. Crypto can ride RSI > 70 for weeks, so 75 is a soft veto, not a hard one. |
| `bbExtensionSigmas = 0.5` | signal | "More than half a sigma outside the upper band" = parabolic extension. Empirical. |
| `donchianEntry = 20` / `donchianExit = 10` | signal | Classic Turtle parameters. Do not "optimize" without walk-forward validation. |
| `atrStopMult = 2.5` | signal | Wide enough to survive normal noise on a daily; tight enough to keep risk meaningful. |
| `maxConcurrent = 5` | portfolio | Empirical sweet spot — more than 5 and you can't manage attention. |
| `maxOpenRiskPct = 4` | portfolio | Total open risk cap. Implies max 5 trades * ~0.8% avg risk. |
| `reentryCooldownDays = 3` | portfolio | Long enough that revenge fades, short enough you don't miss a real re-entry. |
| `riskPct = 1` | live default | 10-loss streak ≈ 10% DD. Acceptable, not aggressive. |

## 12. Known non-goals

- **No optimization of parameters per asset.** If we tune Donchian to 23 for BTC and 17 for ETH because backtests improved, we're curve-fitting.
- **No prediction.** No "I think BTC will go up next week" inputs.
- **No machine-learning entries.** Mechanical rules over learned signals — partly for transparency, partly because we can't get enough data.
- **No execution automation.** This system tells you what to do; you click the button.
- **No funding/OI in the entry logic.** The existing CHECKER page uses funding/OI as a veto on discretionary trades — that's separate from this mechanical system.

## 13. Versioning

If any rule in §3–§8 changes, bump the strategy version in this doc (top of file) and add a row to the change log below. The change log is a moral commitment to not re-overfit silently.

## Change log

- `v1.0` (2026-06-13): Initial spec. Donchian-20 entry, Donchian-10 trail, weekly 4-condition regime, 1% fixed-fractional, portfolio rules per §8.
