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
├── index.html          ← Landing page
├── app.html            ← Wizard app (main experience)
├── css/
│   └── style.css       ← All styles (design system + components)
├── js/
│   └── wizard.js       ← Wizard logic, Claude API calls, artefact rendering
└── README.md
```

---

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
