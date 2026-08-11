#!/usr/bin/env python3
"""Audit one or all local pm-brief redesign pages.

Usage:
  python3 scripts/audit_redesign.py <slug>
  python3 scripts/audit_redesign.py --all

Exit code is non-zero when any audited page has hard failures.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from redesign_utils import REDESIGNS_DIR, analyze_html, scan_redesigns


def print_result(slug: str, audit: dict, json_mode: bool = False) -> None:
    if json_mode:
        print(json.dumps({"slug": slug, **audit}, ensure_ascii=False, indent=2))
        return
    status = "PASS" if not audit.get("failures") else "FAIL"
    star = "⭐ " if audit.get("quality") == "bespoke" else ""
    print(f"{status} {star}{slug} [{audit.get('quality')}] {audit.get('bytes')} bytes")
    if audit.get("company_guess"):
        print(f"  company: {audit['company_guess']}")
    for key in ("failures", "warnings"):
        vals = audit.get(key) or []
        if vals:
            print(f"  {key}: {', '.join(vals)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", nargs="?", help="redesign slug")
    ap.add_argument("--all", action="store_true", help="audit all redesigns")
    ap.add_argument("--json", action="store_true", help="print JSON")
    args = ap.parse_args()

    if not args.all and not args.slug:
        ap.error("pass <slug> or --all")

    failures = 0
    if args.all:
        rows = scan_redesigns()
        data = []
        for r in rows:
            if r.audit.get("failures"):
                failures += 1
            if args.json:
                data.append({"slug": r.slug, **r.audit})
            else:
                print_result(r.slug, r.audit)
        if args.json:
            print(json.dumps(data, ensure_ascii=False, indent=2))
        return 1 if failures else 0

    path = REDESIGNS_DIR / args.slug / "index.html"
    if not path.exists():
        print(f"Missing {path}")
        return 2
    audit = analyze_html(path)
    print_result(args.slug, audit, args.json)
    return 1 if audit.get("failures") else 0


if __name__ == "__main__":
    raise SystemExit(main())
