# Agent handoff — read this first

You are an AI coding assistant continuing work on this repo. This file exists because the model that built the initial system (Claude Fable 5, sunset shortly after 2026-06-13) wrote down what it knew so you don't have to rediscover it. Please respect the design choices unless you understand *why* you're overriding them.

If you remember nothing else from this document, remember this:

> **The point of the system is to remove judgment from the trigger pull, not to maximize backtested return.** Most "improvements" you'll think of (per-asset parameter tuning, adding more entry types, adding ML-based filters) make backtests look prettier and make the system fail in production. Don't.

---

## 0. The owner

- Lives in crypto futures, has been trading for years.
- ~$100k account, 1% risk per trade.
- Has paid TradingView, Market Cipher, Meta Signals access — but the mechanical system in this repo *deliberately ignores* all of them. Those are discretionary tools that live elsewhere.
- Has an Obsidian vault and a Memory Wiki — eventual integration target for trade journaling (see §6).
- Stated problem: never followed a system "to the dot." This system is the cure for that. Don't make it more complicated to follow.

## 1. Repo at a glance

```
src/
  indicators/        Pure functions: SMA, EMA, RMA (Wilder), MACD, RSI, ATR, ADX,
                     Donchian, Bollinger. All match TradingView Pine conventions.
                     Heavily unit-tested. Treat as load-bearing — do not modify
                     without a failing test that proves the bug.
  strategy/          Rule logic, also pure functions:
                     regime.js, signal.js, exit.js, sizing.js, portfolio.js, runOne.js
  backtest/          engine.js (single-asset replay), metrics.js
  data/              binance.js — kline fetch + pagination
  pages/             Scanner.jsx (live verdict), Backtest.jsx, App.jsx (old discretionary
                     CHECKER — leave it alone, it's still valuable as the discretionary
                     pre-trade gate)
docs/
  STRATEGY-SPEC.md   The rules. Single source of truth. Code must match.
  AGENT-HANDOFF.md   This file.
  ROUTINE.md         Daily/weekly checklist for the owner.
```

## 2. Things the previous agent (Fable) chose deliberately

If you find any of these "weird," they aren't — they're the product of reasoning the owner and Fable did together. Don't undo without raising it.

1. **Donchian-only entry.** No pullback variant. Adding entry types doubles parameter space and makes the system harder to follow. The owner explicitly said "I want to follow something to the dot." Two entry types ≠ to the dot.

2. **No targets, no R-based exits.** Trend systems make their money on the right tail. Targets cut the right tail off. The only exits are trailing stop and regime flip, period.

3. **Weekly regime, daily signal.** Higher-timeframe regime filter is the single biggest edge in mechanical trend systems. Don't replace it with a daily regime "because crypto moves fast" — the owner already trades discretionary on lower TFs. This system's job is to capture the longer moves they otherwise miss.

4. **Indicators are pure functions, not classes.** Easy to test, easy to compose. Resist the urge to wrap them in classes "for OOP cleanliness."

5. **`computeSignal` accepts either a single regime state or a per-bar regime array.** The scanner uses the single-state form; the backtest uses the array form for O(n) signal computation. This polymorphism is load-bearing for backtest performance over multi-year ranges.

6. **Fixed-fractional sizing keyed off *current* equity, not starting equity.** Backtest first trade risks 1% of $100k, second trade risks 1% of new equity, and so on. This is intentional — it's how you'd actually trade.

7. **Live unclosed candle is dropped.** `dropUnclosedCandle` in `data/binance.js`. Never read forming data. If you "fix" this to include the current bar, the entire backtest is silently invalid.

8. **No per-asset parameter tuning.** Same rules apply to every coin. Different parameters per asset is curve-fitting in disguise.

9. **Vitest, no Jest, no test runner abstraction.** Tests are fast (<2s for full suite) and run in CI-friendly ways. Don't switch.

10. **No TypeScript.** The owner's existing repo is JSX. Don't migrate. The test coverage and the spec document are the type system.

## 3. Things you might want to do — and what to do instead

| Tempting | Do this instead |
|---|---|
| Add an LSTM/ML entry signal | Don't. Crypto has ~10 years of data and most of that is regime-shifted. Mechanical rules + walk-forward beats ML on this dataset. |
| "Optimize" Donchian periods per asset | Walk-forward sweep across the *whole universe* with a SINGLE parameter set. If results degrade, the rule is the problem, not the parameter. |
| Add a sentiment input from news/Twitter | The owner's Hermes system is the place for that — it should feed in as a *manual veto* surfaced in the Scanner, NEVER as an automatic input to entry. |
| Add intraday timeframes (1H, 4H signals) | Different system entirely. Build a separate route. Don't fold into this one. |
| Increase risk per trade to "make more money" | Read the max drawdown column. Double the risk, double the drawdown. The owner has explicitly chosen 1%. |
| Tighten the trailing stop "to lock in profits sooner" | Cuts the right tail. Read §2 above. |
| Add a target / partial-profits feature | Same answer. |

## 4. Things the previous agent didn't get to

In approximate priority order — knock these off if asked:

1. **Multi-asset portfolio backtest.** Single-asset only today. The portfolio rules in `portfolio.js` are written but the backtest engine doesn't apply them. A correctly-aligned multi-asset engine that respects portfolio.js is the next big quant piece. **Started by Fable below** (see `backtest/portfolio.js` if present).

2. **Trade log + Obsidian export.** When the owner takes a real trade, one click should emit a Markdown note with YAML frontmatter into a designated vault folder. Schema TBD — discuss with owner first.

3. **Live position tracker.** A page that holds the trades the owner actually took (manually entered), refreshes daily, recomputes the trailing stop, tells them "BTC: hold, stop at X" or "exit ETH today, regime flipped."

4. **TradingView Pine Script port.** For phone alerts on the same rules. Lower priority — the web app is the source of truth.

5. **Universe expansion + delisting handling.** Right now `UNIVERSE` is a hard-coded array of 9. Eventually: liquidity-filtered top-N, with delisting detection so we don't trade ghost coins.

## 5. Code conventions

- **Pure functions over classes.** Indicators and strategy rules are functions of inputs only.
- **All-null vs undefined.** Indicators return `null` for warmup positions, never `undefined`. Mixing breaks consumers.
- **Tests live in `__tests__` directories next to the code.** Run with `npm test`.
- **Build with `npm run build`.** It must pass before any commit. CI doesn't exist yet but treat it as if it did.
- **No comments explaining what the code does** — code should be readable. Comments explain WHY (constraints, gotchas, invariants).
- **Commits are descriptive paragraphs**, not one-liners. Future-you needs to understand why a change was made without rereading the diff.

## 6. The Obsidian integration plan (informational)

The owner has a working Obsidian vault and a Memory Wiki tool that indexes it. Eventual integration:

- Trade log writes a `.md` file per trade to `vault/trading/trades/YYYY-MM-DD-ASSET-LONG.md` with YAML frontmatter (date, asset, direction, entry, stop, size, regime snapshot at entry, indicator values).
- Scanner can optionally read a per-asset context note from `vault/trading/context/ASSET.md` and display it next to the verdict. This is the manual veto surface — anything the owner or Hermes writes here, the scanner shows.
- **Critical**: the scanner displays context but never auto-incorporates it into the signal. Mechanical and discretionary layers stay separated by a literal screen boundary.

## 7. Open questions / decisions deferred

- **Live exchange**: backtest uses Binance spot data. Owner trades futures, possibly Binance/Bybit/Hyperliquid. Funding rate realism for futures backtest is not modeled. Ask before adding.
- **Universe expansion**: 9 hardcoded. Worth growing? Possibly. Walk-forward over a larger universe should be done before going to 20+.
- **Multi-timeframe entry refinement**: could a 4H trigger inside a 1D Donchian breakout improve fills? Untested. Don't add without an experiment plan and walk-forward.
- **Stablecoin/cash equity tracking** during long FLAT periods. Currently equity sits idle. Worth modeling money-market yield? Probably noise.

## 8. The honest truth about this system

Backtests will not be magical. A well-built trend system on crypto with the rules in `STRATEGY-SPEC.md` will probably show:

- 30–45% win rate
- 0.3–0.7 R expectancy per trade
- 1.4–2.2 profit factor
- 20–35% max drawdown at some point
- Multi-month stretches of zero PnL

The owner needs to be able to *sit through* the bad stretches without overriding the system. That's where the system actually earns its keep — not in the bull stretches, but in not blowing up in the chop. If a successor model is asked to "improve the backtest results" without preserving this property, they will produce a system that doesn't work in production. Don't.

Sign off with a commit message that says what you did and why. Don't end the work mid-state. Tests must be green.
