#!/usr/bin/env python3
"""hermes_pick.py — pick (or prospect) ONE lead to redesign, and mark it redesigning.

Does ALL the deterministic Supabase work in a single execution so the Hermes
agent spends almost no tool calls: auth, recover stuck jobs, choose the oldest
lead (or prospect the next dentist depth-first), set it to 'redesigning', and
print a JSON blob describing the job to build.

No secrets are stored here. Reads:
  - SUPABASE_ANON       (env; else parsed from js/pmh-supabase.js in the repo)
  - SUPABASE_BOT_PASSWORD (env)
Run from inside the cloned repo:  python scripts/hermes_pick.py
Output (stdout, last line): JSON  {"action":"build","job":{...}}  or {"action":"none",...}
"""
import json, os, re, sys, urllib.request, urllib.parse

BASE = "https://wtzrxscdlqdgdiefsmru.supabase.co"
BOT_EMAIL = "claude-redesign@pm-helper.app"
# Depth-first: exhaust each category before the next. Gyms intentionally last.
CATEGORIES = ["Dentists", "Lawyers", "Accountants", "Notaries", "Physiotherapists",
              "Dermatologist", "Veterinarian", "Optician", "Real estate agency", "Gyms"]
CITY, REGION = "Thessaloniki", "GR"

def die(msg):
    print(json.dumps({"action": "error", "error": msg})); sys.exit(1)

def anon_key():
    k = os.environ.get("SUPABASE_ANON") or os.environ.get("SUPABASE_ANON_KEY")
    if k and len(k) > 100:
        return k.strip()
    try:
        with open(os.path.join(os.path.dirname(__file__), "..", "js", "pmh-supabase.js")) as f:
            m = re.search(r"SUPABASE_ANON\s*=\s*'([^']+)'", f.read())
            if m:
                return m.group(1)
    except Exception:
        pass
    die("SUPABASE_ANON not found in env or js/pmh-supabase.js")

ANON = anon_key()

def req(method, url, token=None, body=None, extra=None):
    headers = {"apikey": ANON, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw.strip() else None

def sign_in():
    pw = os.environ.get("SUPABASE_BOT_PASSWORD")
    if not pw:
        die("SUPABASE_BOT_PASSWORD not set")
    d = req("POST", f"{BASE}/auth/v1/token?grant_type=password",
            body={"email": BOT_EMAIL, "password": pw})
    if not d or "access_token" not in d:
        die("auth failed")
    return d["access_token"]

def rest(method, path, token, body=None, prefer=None):
    extra = {"Prefer": prefer} if prefer else None
    return req(method, f"{BASE}/rest/v1/{path}", token, body, extra)

def log_event(token, job_id, kind, body):
    rest("POST", "pmh_job_events", token,
         body={"job_id": job_id, "author": "hermes", "kind": kind, "body": body})

def main():
    token = sign_in()

    # 0) recover stuck 'redesigning' with no redesign_url -> lead
    stuck = rest("PATCH", "pmh_jobs?status=eq.redesigning&redesign_url=is.null",
                 token, body={"status": "lead"}, prefer="return=representation") or []
    for j in stuck:
        log_event(token, j["id"], "system", "reset stuck redesigning -> lead")

    # 1) oldest unbuilt lead
    leads = rest("GET", "pmh_jobs?status=eq.lead&redesign_url=is.null&select=*&order=created_at.asc&limit=1", token) or []

    # 2) if none, prospect depth-first
    if not leads:
        seen = {r["place_id"] for r in (rest("GET", "pmh_jobs?select=place_id&place_id=not.is.null", token) or []) if r.get("place_id")}
        picked = None
        for cat in CATEGORIES:
            q = urllib.parse.quote(f"{cat} in {CITY}")
            found = req("GET", f"{BASE}/functions/v1/places?q={q}&region={REGION}&max=20", token)
            cands = [r for r in (found.get("results") or []) if r.get("place_id") and r["place_id"] not in seen]
            if not cands:
                continue
            scored = req("POST", f"{BASE}/functions/v1/site-score", token,
                         body={"items": [{"website_url": c.get("website_url", ""), "company": c.get("company", ""), "city": CITY} for c in cands]})
            results = scored.get("results") or []
            for i, c in enumerate(cands):
                c["_score"] = results[i].get("score") if i < len(results) else None
                c["_reasons"] = results[i].get("reasons") if i < len(results) else None
                if results[i:i+1] and results[i].get("resolved_url"):
                    c["website_url"] = results[i]["resolved_url"]
            weak = [c for c in cands if isinstance(c.get("_score"), int) and c["_score"] <= 6]
            if not weak:
                continue  # category effectively exhausted for this page
            weak.sort(key=lambda c: c["_score"])
            picked = (cat, weak[0])
            break
        if not picked:
            print(json.dumps({"action": "none", "reason": "no qualifying lead found across categories"})); return
        cat, c = picked
        row = {"company": c.get("company"), "address": c.get("address"), "phone": c.get("phone"),
               "maps_url": c.get("maps_url"), "website_url": c.get("website_url"), "place_id": c.get("place_id"),
               "status": "lead", "site_score": c.get("_score"),
               "score_notes": " · ".join(c.get("_reasons") or []),
               "notes": f"Prospect · {cat} in {CITY}"}
        ins = rest("POST", "pmh_jobs", token, body=row, prefer="return=representation")
        leads = ins if isinstance(ins, list) else [ins]
        log_event(token, leads[0]["id"], "system", f"Prospected: {cat} in {CITY} ({c.get('_score')}/10)")

    job = leads[0]
    # 3) mark it redesigning
    rest("PATCH", f"pmh_jobs?id=eq.{job['id']}", token, body={"status": "redesigning"})
    log_event(token, job["id"], "status", "Status -> Redesigning (hermes)")

    slug = re.sub(r"[^a-z0-9]+", "-", (job.get("company") or "company").lower()).strip("-")[:60]
    print(json.dumps({"action": "build", "job": {
        "id": job["id"], "company": job.get("company"), "address": job.get("address"),
        "phone": job.get("phone"), "email": job.get("email"), "maps_url": job.get("maps_url"),
        "website_url": job.get("website_url"), "site_score": job.get("site_score"), "slug": slug,
    }}))

if __name__ == "__main__":
    main()
