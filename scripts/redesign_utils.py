#!/usr/bin/env python3
"""Shared helpers for pm-brief local redesign tooling."""
from __future__ import annotations

import html as html_lib
import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

BASE_URL = "https://wtzrxscdlqdgdiefsmru.supabase.co"
BOT_EMAIL = "claude-redesign@pm-helper.app"
PUBLIC_REDIGNS_BASE = "https://pm-brief.com/redesigns"
REPO_ROOT = Path(__file__).resolve().parents[1]
REDESIGNS_DIR = REPO_ROOT / "redesigns"
MANIFEST_PATH = REDESIGNS_DIR / "manifest.json"

GENERIC_PHRASES = [
    "Quality service you can rely on",
    "Professional service",
    "Modern solutions",
    "Trusted partner",
    "Your trusted partner",
    "Excellence in every detail",
    "Transform your online presence",
    "A better first impression",
]
META_PHRASES = [
    "source listing",
    "template built",
    "this redesign",
    "before and after",
    "before/after",
]
RISKY_CLAIMS = [
    "5-star",
    "five-star",
    "award-winning",
    "award winning",
    "years of experience",
    "emergency service",
    "testimonial",
    "testimonials",
]

@dataclass
class RedesignFile:
    slug: str
    path: Path
    rel_path: str
    url: str
    title: str = ""
    h1: str = ""
    company_guess: str = ""
    bytes: int = 0
    quality: str = "unknown"
    audit: Dict[str, Any] = field(default_factory=dict)


def slugify(value: str) -> str:
    value = html_lib.unescape(value or "")
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "job"


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(value or "")).strip()


def extract_first(pattern: str, text: str, flags: int = re.I | re.S) -> str:
    m = re.search(pattern, text, flags)
    return normalize_text(re.sub(r"<[^>]+>", " ", m.group(1))) if m else ""


def analyze_html(path: Path) -> Dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lower = text.lower()
    title = extract_first(r"<title[^>]*>(.*?)</title>", text)
    h1 = extract_first(r"<h1[^>]*>(.*?)</h1>", text)
    og = extract_first(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)', text)
    schema_name = extract_first(r'"name"\s*:\s*"([^"]+)"', text)
    company_guess = h1 or og or schema_name or title
    company_guess = re.sub(r"\s+[—|-]\s+.*$", "", company_guess).strip()

    failures: List[str] = []
    warnings: List[str] = []
    if path.stat().st_size < 7000:
        warnings.append("small_html")
    if any(p.lower() in lower for p in [x.lower() for x in GENERIC_PHRASES]):
        failures.append("generic_fallback_copy")
    if any(p in lower for p in META_PHRASES):
        failures.append("visible_meta_redesign_copy")
    if any(p in lower for p in RISKY_CLAIMS):
        warnings.append("possibly_unverified_claims")
    if re.search(r"tel:[^\"'>]*\*", text, re.I):
        failures.append("masked_tel_link")
    if "fonts.googleapis" in lower:
        warnings.append("external_google_fonts")
    if not (title or h1 or schema_name):
        warnings.append("no_title_or_h1")

    quality = "needs_review" if failures else "bespoke"
    if failures and ("generic_fallback_copy" in failures or path.stat().st_size < 4500):
        quality = "generic"

    return {
        "title": title,
        "h1": h1,
        "company_guess": company_guess,
        "bytes": path.stat().st_size,
        "quality": quality,
        "failures": failures,
        "warnings": warnings,
    }


def scan_redesigns() -> List[RedesignFile]:
    rows: List[RedesignFile] = []
    if not REDESIGNS_DIR.exists():
        return rows
    for index in sorted(REDESIGNS_DIR.glob("*/index.html")):
        slug = index.parent.name
        audit = analyze_html(index)
        rows.append(RedesignFile(
            slug=slug,
            path=index,
            rel_path=str(index.relative_to(REPO_ROOT)),
            url=f"{PUBLIC_REDIGNS_BASE}/{slug}/",
            title=audit.get("title", ""),
            h1=audit.get("h1", ""),
            company_guess=audit.get("company_guess", ""),
            bytes=audit.get("bytes", 0),
            quality=audit.get("quality", "unknown"),
            audit=audit,
        ))
    return rows


def write_manifest(rows: Iterable[RedesignFile], jobs_by_slug: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    jobs_by_slug = jobs_by_slug or {}
    entries = []
    for r in rows:
        job = jobs_by_slug.get(r.slug) or {}
        entries.append({
            "slug": r.slug,
            "company": job.get("company") or r.company_guess or r.slug.replace("-", " ").title(),
            "path": r.rel_path,
            "url": r.url,
            "quality": r.quality,
            "source": "local-static-html",
            "dashboard_synced": bool(job.get("redesign_url")),
            "job_id": job.get("id"),
            "status": job.get("status"),
            "audit": r.audit,
        })
    data = {"generated_by": "scripts/list_redesigns.py", "count": len(entries), "redesigns": entries}
    MANIFEST_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return data


def anon_key() -> str:
    k = os.environ.get("SUPABASE_ANON") or os.environ.get("SUPABASE_ANON_KEY")
    if k and len(k) > 100:
        return k.strip()
    js = REPO_ROOT / "js" / "pmh-supabase.js"
    if js.exists():
        m = re.search(r"SUPABASE_ANON\s*=\s*'([^']+)'", js.read_text(encoding="utf-8", errors="replace"))
        if m:
            return m.group(1)
    raise RuntimeError("SUPABASE_ANON not found")


def request(method: str, endpoint: str, token: Optional[str] = None, body: Any = None, prefer: Optional[str] = None) -> Any:
    url = endpoint if endpoint.startswith("http") else f"{BASE_URL}{endpoint}"
    headers = {"apikey": anon_key(), "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} {method} {url}: {detail}")


def sign_in() -> str:
    pw = os.environ.get("SUPABASE_BOT_PASSWORD")
    if not pw:
        raise RuntimeError("SUPABASE_BOT_PASSWORD not set")
    data = request("POST", "/auth/v1/token?grant_type=password", body={"email": BOT_EMAIL, "password": pw})
    token = data.get("access_token") if isinstance(data, dict) else None
    if not token:
        raise RuntimeError("Supabase auth failed")
    return token


def get_jobs(token: str) -> List[Dict[str, Any]]:
    select = urllib.parse.quote("id,company,status,redesign_url,website_url,address,phone,notes,updated_at", safe=",")
    return request("GET", f"/rest/v1/pmh_jobs?select={select}&order=updated_at.desc", token=token) or []


def slug_from_url(url: str) -> str:
    if not url:
        return ""
    m = re.search(r"/redesigns/([^/?#]+)/?", url)
    return m.group(1) if m else ""


def match_jobs(rows: Iterable[RedesignFile], jobs: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    by_slug: Dict[str, Dict[str, Any]] = {}
    exact_url = {slug_from_url(j.get("redesign_url") or ""): j for j in jobs if slug_from_url(j.get("redesign_url") or "")}
    company_slug = {slugify(j.get("company") or ""): j for j in jobs if j.get("company")}
    for r in rows:
        if r.slug in exact_url:
            by_slug[r.slug] = exact_url[r.slug]
            continue
        candidates = [r.slug, slugify(r.company_guess), slugify(r.title), slugify(r.h1)]
        for c in candidates:
            if c and c in company_slug:
                by_slug[r.slug] = company_slug[c]
                break
    return by_slug
