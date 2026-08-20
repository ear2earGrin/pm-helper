#!/usr/bin/env python3
"""Stamp trading.css's content hash into every link that requests it.

The watchlist shipped with new rules in trading.css but every page still asked
for `trading.css?v=2` — the same URL as the previous deploy — so browsers served
the cached copy and the new rules never arrived. The page looked broken in a way
the markup could not explain.

A hand-maintained version number only works if someone remembers to bump it.
Deriving it from the file's contents means the URL changes exactly when the file
does, and never otherwise.

Rewrites the query string in trading/*.html and in the shell template inside
wrap_trading_shell.py. Run it after editing trading.css — build_trading_pages.sh
does this for you.
"""

import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / "trading" / "trading.css"
TARGETS = sorted((ROOT / "trading").glob("*.html")) + [ROOT / "scripts" / "wrap_trading_shell.py"]

PATTERN = re.compile(r'(trading\.css\?v=)([A-Za-z0-9._-]+)')


def main():
    if not CSS.is_file():
        sys.exit(f"not found: {CSS}")

    digest = hashlib.md5(CSS.read_bytes()).hexdigest()[:8]
    changed = []
    for path in TARGETS:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        stamped, n = PATTERN.subn(rf"\g<1>{digest}", text)
        if n and stamped != text:
            path.write_text(stamped, encoding="utf-8")
            changed.append(f"{path.relative_to(ROOT)} ({n})")

    print(f"trading.css -> v={digest}")
    print("  updated:", ", ".join(changed) if changed else "already current")


if __name__ == "__main__":
    main()
