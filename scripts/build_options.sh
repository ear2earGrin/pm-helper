#!/usr/bin/env bash
# Bundle the standalone Options payoff page.
#
# trading/ui/*.js and trading/options/*.js are ES modules with relative imports.
# esbuild flattens them into one classic script so the page loads exactly like
# the site's other scripts (js/wizard.js, js/tools.js) with no module graph to
# resolve at runtime.
#
# Source of truth is trading/ui/options.js and trading/options/*.js — edit those,
# then re-run this. Requires npx (esbuild is fetched on demand).
set -euo pipefail

cd "$(dirname "$0")/.."

npx --yes esbuild trading/ui/options-entry.js \
  --bundle \
  --format=iife \
  --target=es2019 \
  --minify \
  --outfile=trading/options.bundle.js

echo "built trading/options.bundle.js ($(wc -c < trading/options.bundle.js) bytes)"
