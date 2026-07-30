#!/usr/bin/env python3
"""hermes_finish.py — publish a built redesign and move the job to 'review'.

Run AFTER you've written redesigns/<slug>/index.html. Does everything in one
execution: git add/commit/push to main, then set redesign_url + status=review
(+ email if given) on the job and log a 'redesign' event.

Usage:
  python scripts/hermes_finish.py <job_id> <slug> [contact_email] [summary...]

Env:
  GITHUB_TOKEN          (for push)
  SUPABASE_ANON / SUPABASE_BOT_PASSWORD  (as in hermes_pick.py)
"""
import json, os, re, subprocess, sys, urllib.request

BASE = "https://wtzrxscdlqdgdiefsmru.supabase.co"
BOT_EMAIL = "claude-redesign@pm-helper.app"
REPO = "github.com/ear2earGrin/pm-helper.git"

def die(msg):
    print(json.dumps({"ok": False, "error": msg})); sys.exit(1)

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
    die("SUPABASE_ANON not found")

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
    pw = os.environ.get("SUPABASE_BOT_PASSWORD") or die("SUPABASE_BOT_PASSWORD not set")
    d = req("POST", f"{BASE}/auth/v1/token?grant_type=password",
            body={"email": BOT_EMAIL, "password": pw})
    return d["access_token"] if d and "access_token" in d else die("auth failed")

def sh(*args, timeout=120):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        detail = (p.stderr.strip() or p.stdout.strip() or f"exit {p.returncode}")
        die(f"cmd failed: {' '.join(args)} :: {detail}")
    return p.stdout.strip()

def main():
    if len(sys.argv) < 3:
        die("usage: hermes_finish.py <job_id> <slug> [email] [summary...]")
    job_id, slug = sys.argv[1], sys.argv[2]
    email = sys.argv[3] if len(sys.argv) > 3 and "@" in sys.argv[3] else None
    summary = " ".join(sys.argv[(4 if email else 3):]) or "Built a modern self-contained redesign."
    token_gh = os.environ.get("GITHUB_TOKEN") or die("GITHUB_TOKEN not set")

    path = f"redesigns/{slug}/index.html"
    if not os.path.exists(path):
        die(f"missing {path} — write the redesign first")

    # git push. Idempotent: if this redesign was already committed/pushed but a
    # previous run timed out before the Supabase update, skip the empty commit
    # and still finish the database/event update below.
    sh("git", "add", f"redesigns/{slug}")
    staged = subprocess.run(["git", "diff", "--cached", "--quiet", "--", f"redesigns/{slug}"],
                            capture_output=True, text=True)
    if staged.returncode == 0:
        print(json.dumps({"ok": True, "note": "no staged redesign changes; continuing to Supabase update"}), flush=True)
    else:
        sh("git", "-c", "user.name=hermes", "-c", "user.email=hermes@pm-brief.local",
           "commit", "-m", f"Add redesign: {slug}")
        sh("git", "push", f"https://{token_gh}@{REPO}", "HEAD:main", timeout=180)

    # supabase update
    token = sign_in()
    patch = {"redesign_url": f"https://pm-brief.com/redesigns/{slug}/", "status": "review"}
    if email:
        patch["email"] = email
    req("PATCH", f"{BASE}/rest/v1/pmh_jobs?id=eq.{job_id}", token, body=patch)
    req("POST", f"{BASE}/rest/v1/pmh_job_events", token,
        body={"job_id": job_id, "author": "hermes", "kind": "redesign", "body": summary})

    print(json.dumps({"ok": True, "redesign_url": patch["redesign_url"], "status": "review"}))

if __name__ == "__main__":
    main()
