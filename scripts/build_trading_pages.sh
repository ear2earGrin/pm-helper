#!/usr/bin/env bash
# Bundle the standalone trading pages that are not part of the upstream
# crypto-entry-checker build: Options payoffs and the Watchlist.
#
# trading/ui/*.js and trading/{options,data}/*.js are ES modules with relative
# imports. esbuild flattens each entry into one classic script so the pages load
# exactly like the site's other scripts (js/wizard.js, js/tools.js) with no
# module graph to resolve at runtime.
#
# Source of truth is the ES modules — edit those, then re-run this.
# Requires npx (esbuild is fetched on demand).
set -euo pipefail

cd "$(dirname "$0")/.."

build() {
  local entry="$1" out="$2"
  npx --yes esbuild "$entry" \
    --bundle \
    --format=iife \
    --target=es2019 \
    --minify \
    --outfile="$out"
  echo "built $out ($(wc -c < "$out") bytes)"
}

build trading/ui/options-entry.js   trading/options.bundle.js
build trading/ui/watchlist-entry.js trading/watchlist.bundle.js

# Stamp every asset's content hash into the pages, so no browser can pair a new
# stylesheet with a cached script (or the reverse) from a different build.
python3 scripts/stamp_asset_versions.py
python3 scripts/wrap_trading_shell.py >/dev/null && echo "re-wrapped trading/index.html"
