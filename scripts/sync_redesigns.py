#!/usr/bin/env python3
"""Sync local redesign files into pm-brief dashboard rows.

This bridges Git/static files and Supabase dashboard state:
  redesigns/<slug>/index.html -> pmh_jobs.redesign_url + status=review

Usage:
  python3 scripts/sync_redesigns.py --dry-run
  python3 scripts/sync_redesigns.py
  python3 scripts/sync_redesigns.py --slug aeterna-legal-group
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
from typing import Any, Dict, List
from redesign_utils import (
    BASE_URL,
    match_jobs,
    request,
    scan_redesigns,
    sign_in,
    slugify,
    write_manifest,
    get_jobs,
)


def patch_job(token: str, job_id: str, payload: Dict[str, Any]) -> None:
    request("PATCH", f"/rest/v1/pmh_jobs?id=eq.{urllib.parse.quote(job_id)}", token=token, body=payload)


def log_event(token: str, job_id: str, body: str) -> None:
    request("POST", "/rest/v1/pmh_job_events", token=token, body={
        "job_id": job_id,
        "author": "hermes",
        "kind": "redesign",
        "body": body,
    })


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="show changes without updating Supabase")
    ap.add_argument("--slug", action="append", help="only sync this slug; can repeat")
    ap.add_argument("--include-generic", action="store_true", help="also sync pages classified as generic")
    ap.add_argument("--json", action="store_true", help="print machine-readable result")
    args = ap.parse_args()

    wanted = set(args.slug or [])
    rows = [r for r in scan_redesigns() if not wanted or r.slug in wanted]
    if not args.include_generic:
        rows = [r for r in rows if r.quality != "generic"]

    token = sign_in()
    jobs = get_jobs(token)
    jobs_by_slug = match_jobs(rows, jobs)
    result: List[Dict[str, Any]] = []

    for r in rows:
        job = jobs_by_slug.get(r.slug)
        if not job:
            result.append({
                "slug": r.slug,
                "url": r.url,
                "quality": r.quality,
                "action": "unmatched",
                "reason": "no Supabase job matched by redesign_url slug or company slug",
                "company_guess": r.company_guess,
            })
            continue

        payload: Dict[str, Any] = {}
        if job.get("redesign_url") != r.url:
            payload["redesign_url"] = r.url
        if job.get("status") in (None, "lead", "redesigning"):
            payload["status"] = "review"

        if not payload:
            action = "already_synced"
        elif args.dry_run:
            action = "would_update"
        else:
            patch_job(token, job["id"], payload)
            log_event(token, job["id"], f"Linked local {r.quality} redesign: {r.url}")
            action = "updated"

        result.append({
            "slug": r.slug,
            "company": job.get("company"),
            "job_id": job.get("id"),
            "url": r.url,
            "quality": r.quality,
            "old_status": job.get("status"),
            "old_redesign_url": job.get("redesign_url"),
            "payload": payload,
            "action": action,
        })

    # Write manifest using fresh local/job matching. For real sync, refresh jobs first.
    if not args.dry_run:
        jobs = get_jobs(token)
        jobs_by_slug = match_jobs(scan_redesigns(), jobs)
    write_manifest(scan_redesigns(), jobs_by_slug)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        counts: Dict[str, int] = {}
        for x in result:
            counts[x["action"]] = counts.get(x["action"], 0) + 1
        print("Sync result:", ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) or "none")
        for x in result:
            print(f"{x['action']:15} {x['slug']:42} {x.get('company') or x.get('company_guess') or ''} -> {x['url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
