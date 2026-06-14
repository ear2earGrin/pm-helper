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
  data/         binance.js (kline fetch) · tradeLog.js (localStorage + Obsidian md)
  options/      payoff math + presets (straddle, strangle, strip, strap, spreads, condor)
  ui/           vanilla views: scanner · backtest · tradelog · options · hash router
  trading.bundle.js   the views bundled to one classic script (built, served)
```

The engine/options modules are pure ES modules with relative `.js` imports — they run
unmodified under Vitest (Node). For the browser the UI is bundled into one classic script
with `npm run build:trading` (esbuild): GitHub Pages did not execute the multi-file
`<script type="module">` graph, and a classic bundle loads like the site's other scripts.
**Rebuild the bundle whenever you change anything under `trading/`.**

## Tests

110 tests (Vitest + fast-check), dev-only — not shipped to the static site:

```bash
npm install   # one-time: installs devDependencies
npm test      # vitest run — expect 110 passing
```

## Binance data

`data/binance.js` reads its base URL from `window.__BINANCE_PROXY_BASE__` (set in
`index.html`), currently `https://data-api.binance.vision` — Binance's public market-data
host — so the browser fetches klines directly. The Cloudflare Worker proxy in
[`../worker-binance/`](../worker-binance/) is kept as a fallback, but Binance 403s cloud/edge
IPs (including Cloudflare), so direct-from-browser is the default.
