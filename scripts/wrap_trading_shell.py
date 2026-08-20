#!/usr/bin/env python3
"""Wrap the crypto-entry-checker bundle in the pm-brief page shell.

`npm run build` in crypto-entry-checker emits a standalone page: Vite's default
CSS (which flips to a white background under prefers-color-scheme: light) and no
site chrome. Dropping that straight into /trading loses the YARD Financial
header, the footer and the site's dark theme.

This rewrites trading/index.html to put the app back inside the pm-brief shell.
React still owns #root, so the chrome survives every rebuild. Run it after
copying dist/* into trading/.

Idempotent: it reads the generated asset tags out of whatever index.html is
there — wrapped or not — so re-running after a rebuild picks up the new content
hashes.

    python3 scripts/wrap_trading_shell.py
"""

import pathlib
import re
import sys

INDEX = pathlib.Path(__file__).resolve().parent.parent / "trading" / "index.html"

SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="../favicon.svg" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Trading Desk — Crypto System v2.0 | YARD Financial</title>
  <meta name="description" content="A mechanical crypto swing-trading desk: weekly regime scanner, Donchian breakout signals, backtests with a full metrics grid, a paper-trading mirror and a trade journal." />
  <link rel="canonical" href="https://pm-brief.com/trading/" />
  <meta name="robots" content="index, follow" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="YARD Financial" />
  <meta property="og:title" content="Trading Desk — Crypto System v2.0" />
  <meta property="og:description" content="Regime scanner, Donchian breakout signals, backtests, a paper-trading mirror and a trade journal. Analysis only — it never places an order." />
  <meta property="og:url" content="https://pm-brief.com/trading/" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
__APP_ASSETS__
  <link rel="stylesheet" href="../css/style.css?v=2" />
  <link rel="stylesheet" href="../css/i18n.css" />
  <link rel="stylesheet" href="trading.css?v=29da3889" />
  <script>try{var _l=localStorage.getItem('yf-lang');if(_l==='bg'||_l==='en')document.documentElement.lang=_l;}catch(e){}</script>
  <script src="../js/i18n-site.js" defer></script>
  <style>
    /* Vite's starter CSS flips :root to a white background under
       prefers-color-scheme: light. Pin the page to the site's dark palette so
       the app never renders light inside pm-brief's chrome. */
    :root { color-scheme: dark; background-color: var(--bg-0, #05080F); color: var(--text-primary, #EDF0F7); }
    /* Column layout keeps the footer at the bottom on short tabs instead of
       leaving it stranded mid-page. */
    body.landing-body { background: var(--bg-0, #05080F); display: flex; flex-direction: column; min-height: 100vh; }
    #root { min-height: 0; flex: 1 0 auto; }
    /* The app's sticky tab bar sits under the site nav rather than over it. */
    #root > nav { top: 0; }
  </style>
</head>
<body class="landing-body">

  <nav class="nav">
    <div class="nav-inner">
      <a href="../index.html" class="brand">
        <span class="brand-icon">◈</span>
        <span class="brand-name">YARD Financial<span style="color:var(--text-secondary,#8B93A8);font-weight:400;font-size:0.9em"> / Risk Management</span></span>
      </a>
      <div class="nav-links">
        <a href="../pm.html" class="nav-link"><span data-lang="en">Project Management</span><span data-lang="bg">Управление на проекти</span></a>
        <a href="../calc/index.html" class="nav-link"><span data-lang="en">Calculators</span><span data-lang="bg">Калкулатори</span></a>
        <!-- Not part of the upstream bundle, so they sit in the site nav rather
             than the app's own tab bar: Lattice is a standalone page, Options is
             built from trading/ui/*.js by scripts/build_trading_pages.sh. -->
        <a href="watchlist.html" class="nav-link"><span data-lang="en">Watchlist</span><span data-lang="bg">Списък</span></a>
        <a href="../lattice.html" class="nav-link">Lattice</a>
        <a href="options.html" class="nav-link"><span data-lang="en">Options</span><span data-lang="bg">Опции</span></a>
      </div>
    </div>
  </nav>

  <div id="root"></div>

  <footer class="footer">
    <div class="footer-inner">
      <div class="brand brand--small">
        <span class="brand-icon">◈</span>
        <span class="brand-name">YARD Financial<span style="color:var(--text-secondary,#8B93A8);font-weight:400;font-size:0.9em"> / Risk Management</span></span>
      </div>
      <p class="footer-note"><span data-lang="en">Mechanical swing trading · Analysis only, never places an order</span><span data-lang="bg">Механична суинг търговия · Само анализ, никога не подава поръчка</span> · <a href="../disclaimer.html" style="color: var(--accent-text);"><span data-lang="en">Disclaimer</span><span data-lang="bg">Условия</span></a></p>
      <a href="https://yardlaw.eu" target="_blank" rel="noopener" class="footer-partner">
        <span data-lang="en">A project by </span><span data-lang="bg">Проект на </span><strong>YARD Law Co.</strong>
      </a>
    </div>
    <p class="footer-credit">
      <span class="footer-credit-label"><span data-lang="en">Design by</span><span data-lang="bg">Дизайн от</span></span>
      <a href="https://e2eg.agency/" target="_blank" rel="noopener" class="footer-credit-brand">E2EG</a>
    </p>
  </footer>

</body>
</html>
"""


def main():
    if not INDEX.is_file():
        sys.exit(f"not found: {INDEX} — copy the build's dist/* into trading/ first")

    html = INDEX.read_text(encoding="utf-8")

    # Vite emits these with content hashes that change on every rebuild, so pull
    # them out of the file rather than hardcoding names.
    assets = re.findall(
        r'<(?:script|link)\b[^>]*(?:src|href)="\./assets/[^"]+"[^>]*>(?:</script>)?',
        html,
    )
    if not assets:
        sys.exit("no ./assets/* tags found — is trading/index.html the Vite build output?")

    page = SHELL.replace("__APP_ASSETS__", "\n".join("  " + a for a in assets))
    INDEX.write_text(page, encoding="utf-8")
    print(f"wrapped {INDEX.relative_to(INDEX.parent.parent)} with the pm-brief shell")
    for a in assets:
        print("  kept:", a[:90])


if __name__ == "__main__":
    main()
