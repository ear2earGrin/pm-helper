# PM Helper — AI-Powered PM² Project Management Assistant

**Sprint 0** · Vanilla HTML/CSS/JS · Claude API

---

## What is PM Helper?

PM Helper is a browser-based tool that transforms a 3-minute guided wizard into three professional, PM²-compliant project artefacts:

- **Project Charter** — Full Initiating phase charter with scope, roles (PM² RASCI), constraints, assumptions, and success criteria
- **Stakeholder Matrix (PSM)** — All stakeholders mapped to PM² layers with Interest/Influence ratings and engagement strategies
- **Risk Log** — Risks structured in PM² Cause → Risk → Effect format with likelihood/impact ratings

Built on the PM² Methodology Guide v3.1 standard.

---

## Quick Start

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/pm-helper.git
cd pm-helper
```

### 2. Serve locally
Any static file server works. Easiest options:

```bash
# Python
python3 -m http.server 8080

# Node (if you have npx)
npx serve .

# VS Code Live Server extension — just open index.html and click "Go Live"
```

Then open `http://localhost:8080` in your browser.

### 3. Add your API key
On first launch of the app, you'll be prompted for your **Anthropic API key**.

- Get yours at: https://console.anthropic.com
- The key is stored in `localStorage` in your browser only
- It's sent directly to `api.anthropic.com` — never to any third-party server

> ⚠️ **Security note:** This is a Sprint 0 proof-of-concept. For production, API calls should be proxied through a backend so the key is never exposed client-side.

---

## Project Structure

```
pm-helper/
├── index.html          ← Hub / launcher (cards: PM Management · Trading Desk · Lattice)
├── login.html          ← Redesign Studio — team login (Supabase Auth)
├── dashboard.html      ← Redesign Studio — shared outreach dashboard
├── pm.html             ← PM Management landing (how it works · artefacts)
├── app.html            ← Wizard app (main PM experience)
├── tools.html          ← PM² planning tools
├── lattice.html        ← Lattice — binomial options pricer (CRR), ported from yardlaw.eu
├── trading/            ← Trading Desk (ported from crypto-entry-checker)
│   ├── index.html      ← Section shell (nav + sub-nav + hash router)
│   ├── indicators/ strategy/ backtest/ data/   ← pure engine (ESM: browser + Vitest)
│   ├── ui/             ← vanilla views: scanner · backtest · tradelog · router
│   └── vendor/         ← lightweight-charts (vendored, Apache-2.0)
├── worker/             ← Cloudflare Worker: Anthropic API proxy
├── worker-binance/     ← Cloudflare Worker: Binance CORS proxy
├── css/
│   └── style.css       ← All styles (design system + components)
├── js/                 ← wizard.js · tools.js · i18n.js
├── docs/               ← STRATEGY-SPEC · AGENT-HANDOFF · ROUTINE · INTEGRATION
└── README.md
```

---

## Trading section (`/trading`)

A mechanical swing-trading system ported from [crypto-entry-checker](https://github.com/ear2earGrin/crypto-entry-checker), integrated as a native pm-brief section (vanilla, no build) and surfaced in the nav. Three tools:

- **Scanner** — once-a-day mechanical verdict per asset (weekly regime → daily Donchian breakout)
- **Backtest** — single-asset historical replay with equity curve + 12-metric grid
- **Trade Log** — localStorage-persisted journal with Obsidian-flavored Markdown export
- **Options Payoffs** — multi-leg option strategy payoff diagrams (straddle, strangle, strip, strap, spreads, condor)

The rules are documented — **read these before changing anything under `trading/`:**

- **[docs/STRATEGY-SPEC.md](docs/STRATEGY-SPEC.md)** — the strategy rules (single source of truth)
- **[docs/AGENT-HANDOFF.md](docs/AGENT-HANDOFF.md)** — design rationale + what not to change, and why
- **[docs/ROUTINE.md](docs/ROUTINE.md)** — the owner's daily/weekly checklist
- **[docs/INTEGRATION-INTO-PM-BRIEF.md](docs/INTEGRATION-INTO-PM-BRIEF.md)** — how this port was done

The engine is pure ES modules (no build step). Tests (Vitest + fast-check, dev-only — not shipped):

```bash
npm install
npm test        # 110 tests, all passing
```

> ⚠️ **Binance needs a CORS proxy — the #1 thing that breaks.** `trading/data/binance.js` calls same-origin `/binance-spot/*`; deploy `worker-binance/` (`cd worker-binance && npx wrangler deploy`) and the section targets it via `window.__BINANCE_PROXY_BASE__` in `trading/index.html`. Without it, Scanner/Backtest fail with CORS errors in the console. See [`trading/README.md`](trading/README.md).

---

## Redesign Studio (`/login.html` → `/dashboard.html`)

A private, two-person dashboard for running website-redesign outreach: track the
companies you're pitching, from first lead to closed deal.

- **Login** (`login.html`) — real Supabase Auth (email/password). Two team
  accounts exist: **`mdonkov`** and **`lkashkin`**. Sign in with just the
  username; it maps to `<username>@pm-helper.app` behind the scenes. (Passwords
  are set in Supabase Auth and intentionally **not** stored in this repo.)
- **Dashboard** (`dashboard.html`) — one card per company with: address +
  **Google Maps** link (auto-generated from the address if you don't paste one),
  company **email** (click-to-mail), phone, current website, the **redesign
  link**, an editable **status** (`Lead → Redesigning → Sent → Replied →
  Finished`, plus `Passed`), an owner, and a per-job **status-report timeline**.
  Tabs: All · Active · Redesigning · Sent · **Finished** · Passed, with live
  stat tiles.
- **Shared + live** — data lives in Supabase (`pmh_jobs`, `pmh_job_events`) with
  Row-Level Security so only the two signed-in partners can read/write. Realtime
  is enabled, so a change one partner makes appears on the other's screen live.

### Redesign hand-off (the "second Claude session")

The board is the integration contract. A separate Claude session that produces
the redesigns reads/writes the **same** `pmh_jobs` table (Supabase project
`wtzrxscdlqdgdiefsmru`):

| Field          | Set by the redesign session |
|----------------|-----------------------------|
| `redesign_url` | link to the finished redesign it built |
| `status`       | flip to `redesigning` while building, `sent` once the pitch email goes out |
| `email`        | the company address the pitch was sent to |
| `pmh_job_events` | append a row (`author: 'claude-redesign'`) to log what it did |

Client dependency: `@supabase/supabase-js@2` is loaded from the jsDelivr CDN as
an ES module (no build step) — matching the site's vanilla approach.

## Model Configuration

In `js/wizard.js`, find the `CONFIG` object at the top:

```js
const CONFIG = {
  MODEL: 'claude-haiku-4-5-20251001',   // Fast & cheap for Sprint 0
  MAX_TOKENS: 4096,
  ...
};
```

**Swap to `claude-sonnet-4-6`** for significantly richer, more nuanced artefacts at the cost of a slightly longer generation time and higher API cost per request.

---

## The 8-Question Wizard

The wizard collects:

| # | Field | Purpose |
|---|-------|---------|
| 1 | Project name | Used across all artefacts |
| 2 | Objective | Charter objective + scope |
| 3 | Project Owner | PM² governance roles |
| 4 | Users / Beneficiaries | Stakeholder register |
| 5 | Target completion | Timeline |
| 6 | Budget / Resources | Charter + constraints |
| 7 | Key risks | Risk log seeding |
| 8 | Success criteria | Charter success criteria |

---

## PM² Methodology

This tool implements artefacts from the **PM² Methodology Guide v3.1** (European Commission).

Key PM² concepts used:
- **Initiating phase** artefacts: Project Charter
- **Stakeholder matrix (PSM)**: Interest/Influence matrix, PM² layer classification
- **Risk log**: Cause → Risk → Effect (C→R→E) format, likelihood/impact/rating
- **RASCI roles**: Project Owner, Business Manager, Project Manager, User Representatives, Solution Provider

---

## Sprint 0 Roadmap

This is Sprint 0 — proof of concept. Planned sprints:

| Sprint | Focus |
|--------|-------|
| **0 (now)** | Wizard → 3 artefacts · Claude API · No persistence |
| **Sprint 1** | User auth · Persistent workspace · PM² phase coach |
| **Sprint 2** | Export PDF/DOCX (Pro gate) · Stripe billing · Risk log module |
| **Sprint 3** | MoSCoW builder · WBS/PBS generator · PERT estimator |

---

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JavaScript — no build tools, no framework
- **AI:** Anthropic Claude API (claude-haiku for speed)
- **Fonts:** Instrument Serif (display) · DM Sans (body) · Space Mono (mono)
- **Hosting:** Any static host (GitHub Pages, Netlify, Cloudflare Pages)

---

## Deploy to GitHub Pages

1. Push to GitHub
2. Go to repo **Settings → Pages**
3. Source: `main` branch, `/ (root)` folder
4. Your app will be live at `https://USERNAME.github.io/pm-helper/`

---

## License

MIT — build freely, contribute back.
