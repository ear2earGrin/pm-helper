#!/usr/bin/env python3
"""Stamp each trading asset's content hash into the pages that request it.

Twice now the page has looked broken for a reason the markup could not explain,
both times because a browser reused a cached file under an unchanged URL:

  * the watchlist shipped new CSS rules under `trading.css?v=2`, so the rows
    rendered unstyled;
  * then `trading.css` carried a version but `watchlist.bundle.js` carried none,
    so a browser took the new stylesheet with the old script — and CSS that
    positions the note inside a wrapper the old script never rendered anchored
    it to the whole row instead.

The second case is the nastier one: neither file is individually wrong, they are
just from different builds. Versioning only the stylesheet made it *more* likely,
because it guaranteed the CSS updated while the JS did not.

So every asset that ships together gets stamped together, from its own content
hash. The URL changes exactly when the file does, and a half-updated pair cannot
happen. Run after building — build_trading_pages.sh does it for you.
"""

import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Files whose URL must change whenever their contents do. Anything the trading
# pages load from this repo and that a build can rewrite belongs here.
ASSETS = [
    "trading/trading.css",
    "trading/options.bundle.js",
    "trading/watchlist.bundle.js",
]

TARGETS = sorted((ROOT / "trading").glob("*.html")) + [ROOT / "scripts" / "wrap_trading_shell.py"]


def main():
    digests = {}
    for rel in ASSETS:
        path = ROOT / rel
        if not path.is_file():
            sys.exit(f"not found: {rel} — build first")
        digests[pathlib.Path(rel).name] = hashlib.md5(path.read_bytes()).hexdigest()[:8]

    changed = []
    for target in TARGETS:
        if not target.is_file():
            continue
        text = original = target.read_text(encoding="utf-8")
        for name, digest in digests.items():
            # Matches the reference with or without an existing ?v=, so this both
            # adds the query the first time and updates it afterwards.
            pattern = re.compile(
                r'((?:src|href)=")((?:\./)?' + re.escape(name) + r')(?:\?v=[A-Za-z0-9._-]+)?(")'
            )
            text = pattern.sub(rf"\g<1>\g<2>?v={digest}\g<3>", text)
        if text != original:
            target.write_text(text, encoding="utf-8")
            changed.append(str(target.relative_to(ROOT)))

    for name, digest in digests.items():
        print(f"  {name} -> v={digest}")
    print("updated:", ", ".join(changed) if changed else "already current")


if __name__ == "__main__":
    main()
