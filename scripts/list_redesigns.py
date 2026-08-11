#!/usr/bin/env python3
"""List local pm-brief redesign files and write redesigns/manifest.json.

Usage:
  python3 scripts/list_redesigns.py [--json]
"""
from __future__ import annotations

import argparse
import json
from redesign_utils import scan_redesigns, write_manifest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="print full manifest JSON")
    args = ap.parse_args()

    rows = scan_redesigns()
    manifest = write_manifest(rows)
    if args.json:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0

    print(f"Found {len(rows)} redesign(s). Manifest: redesigns/manifest.json")
    for r in rows:
        marks = []
        if r.quality == "bespoke":
            marks.append("⭐ bespoke")
        elif r.quality == "generic":
            marks.append("generic")
        else:
            marks.append(r.quality)
        if r.audit.get("failures"):
            marks.append("FAIL:" + ",".join(r.audit["failures"]))
        if r.audit.get("warnings"):
            marks.append("WARN:" + ",".join(r.audit["warnings"]))
        company = r.company_guess or r.slug
        print(f"{r.slug:42} {r.bytes:7} bytes  {'; '.join(marks)}  {company}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
