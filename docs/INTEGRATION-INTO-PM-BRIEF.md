# Integrating into pm-brief.com

This document is for the Claude/AI session running inside the pm-brief repo. It tells you exactly what to port from `crypto-entry-checker`, how, and what to watch out for.

If you are a person: skim §1 and §2, hand the prompt at the bottom to the other Claude session, and go make tea.

---

## 1. What you're porting

The crypto-entry-checker is a mechanical swing-trading system for crypto. It already runs as a standalone Vite app at `/scanner`, `/backtest`, `/log` (plus the existing `/` checker). The owner wants the same functionality as a subpage inside pm-brief.com.

**There is nothing experimental about the code you're porting.** 100 tests pass. The strategy spec is documented. The architecture is deliberate. Do not "improve" things on the way over — port faithfully, then add native pm-brief styling if appropriate.

## 2. The portability profile of each layer

| Layer | Files | Portability |
|---|---|---|
| **Indicators** | `src/indicators/*.js` (sma, ema, rma, macd, rsi, atr, adx, donchian, bollinger) | Pure JS, framework-agnostic. Copies as-is. |
| **Strategy logic** | `src/strategy/*.js` (regime, signal, exit, sizing, portfolio, runOne) | Pure JS. Copies as-is. |
| **Backtest engines + metrics** | `src/backtest/*.js` (engine, portfolio, walkforward, montecarlo, metrics) | Pure JS. Copies as-is. |
| **Data layer** | `src/data/binance.js` (kline fetcher) | Works in any browser but **depends on a CORS proxy** (see §4). |
| **Data layer** | `src/data/tradeLog.js` (localStorage + Obsidian Markdown) | Pure browser JS. Copies as-is. |
| **Pages (UI)** | `src/pages/Scanner.jsx`, `Backtest.jsx`, `TradeLog.jsx` | React 19, react-router-dom, lightweight-charts. Port depends on pm-brief's framework — see §3. |
| **Tests** | `src/**/__tests__/*.test.js` | Vitest + fast-check. Bring them along; they're your safety net during the port. |
| **Docs** | `docs/STRATEGY-SPEC.md`, `docs/AGENT-HANDOFF.md`, `docs/ROUTINE.md`, this file | Drop into pm-brief's docs directory. |

## 3. Framework adaptation matrix

### If pm-brief is React + Vite (same stack)

1. Copy the entire `src/indicators/`, `src/strategy/`, `src/backtest/`, `src/data/`, `src/pages/` directories into pm-brief's `src/`.
2. Add the routes to pm-brief's router (whatever framework it uses for routing).
3. Add `lightweight-charts@^4.2.0` and `fast-check@^3.23.2` (dev) to pm-brief's package.json.
4. Add Vite proxy entries for `/binance-spot`, `/binance-fut`, `/binance-dapi` — copy from `crypto-entry-checker/vite.config.js`.
5. Run the test suite. Should be 100 green.
6. Mount the pages under a parent route like `/trading/scanner`, `/trading/backtest`, `/trading/log`. Update import paths if you rename routes.

### If pm-brief is Next.js (App Router)

1. Same module copies as above into `src/lib/trading/` or similar.
2. Convert each page file:
   ```
   src/pages/Scanner.jsx  →  app/trading/scanner/page.jsx
   src/pages/Backtest.jsx →  app/trading/backtest/page.jsx
   src/pages/TradeLog.jsx →  app/trading/log/page.jsx
   ```
3. Add `'use client'` at the top of each page (they all use `useState`/`useEffect`/`localStorage`).
4. **lightweight-charts** must be dynamically imported on the client to avoid SSR errors:
   ```js
   import dynamic from 'next/dynamic';
   // Or wrap the chart-mounting useEffect in a check for `typeof window !== "undefined"`.
   ```
5. **Binance CORS proxy**: replace the Vite proxy with Next.js rewrites in `next.config.js`:
   ```js
   async rewrites() {
     return [
       { source: '/binance-spot/:path*', destination: 'https://api.binance.com/:path*' },
       { source: '/binance-fut/:path*',  destination: 'https://fapi.binance.com/:path*' },
     ];
   }
   ```
6. Add `lightweight-charts` and `fast-check` to pm-brief's deps as above.
7. Add navigation entries to pm-brief's nav for the three trading routes.

### If pm-brief is Next.js (Pages Router) — similar to App Router

Same steps but pages live under `pages/trading/*.jsx`. No `'use client'` needed. Use `next/dynamic` to lazy-load chart components with `ssr: false`.

### If pm-brief is something else (Svelte / Vue / Remix / etc.)

- Indicators, strategy, backtest, data/binance, data/tradeLog: all portable. Copy and import.
- Pages: must be rewritten in the target framework. The data shapes are simple — each page is essentially "fetch klines, run a pure function, render a table." A junior dev (or you) can rewrite each in 30–60 minutes.
- Tests: keep Vitest as a JS-only test runner even if the framework uses a different test tool for components. The strategy/indicator tests don't touch the UI.

## 4. The Binance CORS proxy — the gotcha

`fetch('https://api.binance.com/...')` directly from the browser is **blocked by CORS** in all major browsers. Every Scanner/Backtest call routes through a server-side proxy with `/binance-spot/...` and `/binance-fut/...` URL prefixes that the dev server (or hosting platform) rewrites to the real Binance hosts.

You **must** set up equivalents on pm-brief or the trading pages will silently fail with CORS errors in the browser console. See the framework-specific snippets in §3.

In production on Vercel/Netlify/Cloudflare: use platform rewrites (Vercel's `vercel.json` `rewrites`, Netlify's `_redirects`, Cloudflare's Pages Functions).

## 5. State and persistence

- The Trade Log uses `localStorage` keys `tradeLog.v1`, `scanner.config.v1`, `backtest.config.v1`. These will be **separate** from any localStorage on the standalone crypto-entry-checker deploy. If you want to migrate existing trades, the owner can export JSON from the standalone app and import into the integrated version.
- No backend. No auth. No DB. The Trade Log lives in the user's browser.

## 6. Authentication and gating

If pm-brief has its own auth, decide whether trading pages should be gated behind it. The pure-function modules don't care. The UI pages don't reference any auth — wrap them in pm-brief's auth HOC/middleware if needed.

## 7. Branding / theme

The crypto-entry-checker uses a dark "Shellforge" terminal aesthetic (green-on-black, monospace, `#2cff9c` accent). All styling is inline JSX objects in each page file. If pm-brief has a different theme:

- Option A: leave the trading pages with their existing aesthetic — they're a "section" that visually differs. Fine for an app-within-an-app.
- Option B: restyle by extracting the inline `styles` object in each page and replacing with pm-brief's CSS/Tailwind/styled-components. Mechanical work, ~1 hour per page.

## 8. Verification checklist after porting

Tick every box before declaring done:

- [ ] `npm test` (or pm-brief's test command) shows 100 passing tests under the trading namespace
- [ ] `/trading/scanner` loads, RUN SCAN populates the table with real Binance data (network tab confirms /binance-spot/* calls succeed with 200)
- [ ] `/trading/backtest` loads, running BTC from 2020 produces an equity curve and metrics
- [ ] `/trading/log` loads, NEW TRADE → fill form → SAVE persists; reload page, trade still there
- [ ] Trade Markdown export downloads a `.md` file with valid YAML frontmatter
- [ ] `docs/STRATEGY-SPEC.md`, `docs/AGENT-HANDOFF.md`, `docs/ROUTINE.md` are in pm-brief's repo, findable via the README
- [ ] No console errors on any of the three pages

## 9. Do not change while porting

These are deliberate, documented in `docs/AGENT-HANDOFF.md` §2-3. Resist the temptation:

- The trailing-stop-only-ratchets-in-trade's-favor logic
- The Donchian-only entry (no pullback variant)
- The 1-entry-per-day portfolio rule
- The dropping of the live unclosed candle
- The per-bar regime alignment in the backtest engine

If you "improve" any of these during the port, the system silently becomes a different system.

## 10. After the port: what's next

Once the integration is verified working, the prioritized to-do list from `docs/AGENT-HANDOFF.md` §4 still applies:

1. UI for walk-forward / Monte Carlo / portfolio backtest (the engines are done, only UIs are missing)
2. Live position tracker (recompute trailing stop daily for open trades)
3. TradingView Pine Script port for phone alerts

Don't add these during the port. Get to "verified working in pm-brief" first.

---

## Prompt for the pm-brief Claude session

Copy-paste this when you start the session in pm-brief:

```
I have a working crypto trading system at https://github.com/ear2earGrin/crypto-entry-checker
on branch claude/trading-system-indicators-Lrj5i. I want to integrate it as a
subsection of THIS app (pm-brief).

Read these files first, in this order, before touching anything:

1. docs/INTEGRATION-INTO-PM-BRIEF.md  (the porting guide; tells you what to copy,
   what to watch for, and framework-specific adaptations)
2. README.md                          (architecture overview)
3. docs/AGENT-HANDOFF.md              (what to NOT change while porting and why)
4. docs/STRATEGY-SPEC.md              (the rules of the trading system)

Then:

- Detect the framework pm-brief uses and choose the appropriate path in §3 of the
  integration guide.
- Set up the Binance CORS proxy per §4. THIS IS THE #1 THING THAT WILL BREAK.
- Port the modules listed in §2 in this order:
    indicators → strategy → backtest → data → pages
- Run the test suite after each layer. All 100 should pass when you're done.
- Verify against the checklist in §8 before declaring complete.
- Do NOT modify any of the rules listed in §9.

The pages should mount under a parent route like /trading/* so they feel like a
section of pm-brief rather than a separate app. Use pm-brief's existing nav
component to surface them.

Report back what stack pm-brief is on and any per-stack adaptations you had to
make beyond what the guide already covers.
```
