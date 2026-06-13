# Trading section (ported from crypto-entry-checker)

Mechanical swing-trading engine ported into pm-brief. The **rules** are documented
in [`../docs/STRATEGY-SPEC.md`](../docs/STRATEGY-SPEC.md) (single source of truth),
with design rationale in [`../docs/AGENT-HANDOFF.md`](../docs/AGENT-HANDOFF.md) and
the daily checklist in [`../docs/ROUTINE.md`](../docs/ROUTINE.md).

## Layout

```
trading/
  indicators/   pure functions: SMA EMA RMA MACD RSI ATR ADX Donchian Bollinger
  strategy/     pure rule logic: regime · signal · exit · sizing · portfolio · runOne
  backtest/     engine · portfolio · walkforward · montecarlo · metrics
  data/         binance.js (kline fetch, via CORS proxy) · tradeLog.js (localStorage + Obsidian md)
```

All modules are pure ES modules with relative `.js` imports, so they run unmodified
both under Vitest (Node) and natively in the browser via `<script type="module">`.
No build step is required for the engine.

## Tests

100 tests (Vitest + fast-check), dev-only — not shipped to the static site:

```bash
npm install   # one-time: installs vitest + fast-check (devDependencies)
npm test      # vitest run — expect 100 passing
```

## Binance CORS proxy

`data/binance.js` calls same-origin prefixes (`/binance-spot`, `/binance-fut`,
`/binance-dapi`). Those must be rewritten to the real Binance hosts by an edge proxy
— see [`../worker-binance/`](../worker-binance/). Without it, every Scanner/Backtest
call fails with a CORS error in the browser console.
