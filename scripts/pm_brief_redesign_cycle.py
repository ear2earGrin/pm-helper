#!/usr/bin/env python3
"""pm_brief_redesign_cycle.py — deterministic, cron-safe redesign cycle.

Runs the WHOLE redesign cycle as a bounded script so it can be a plain system
cron entry instead of a fragile LLM agent loop. The only LLM use is ONE bounded
HTTP call to generate the redesign HTML; every step has a hard timeout, so the
job cannot hang (the failure Hermes hit: a 2.7h stuck model stream).

Pipeline:
  1. locate the repo this script lives in (fixes the cwd bug), chdir there
  2. scripts/hermes_pick.py            -> pick/prospect ONE lead (JSON on stdout)
  3. if action != "build": exit 0      (nothing to do — a clean no-op)
  4. fetch the company's real website  (bounded; falls back to root domain)
  5. ONE bounded LLM call -> index.html (OpenAI by default; or PMBRIEF_LLM_CMD;
     else a clean built-in template — so the cycle ALWAYS produces a page)
  6. scripts/hermes_finish.py          -> commit/push + move job to 'review'
  7. print a concise summary; exit 0 on success, nonzero only on real failure

Env:
  GITHUB_TOKEN, SUPABASE_BOT_PASSWORD   (required by the sub-scripts)
  SUPABASE_ANON                         (optional; else read from the repo)
  OPENAI_API_KEY                        (optional; enables real LLM generation)
  PMBRIEF_LLM_MODEL   (default "gpt-4o")
  PMBRIEF_LLM_CMD     (optional: a shell command that reads the prompt on stdin
                       and prints the HTML on stdout — use your own model CLI)

Cron (system crontab, the robust path — NOT an LLM agent):
  0 9,12,15,18,21 * * *  bash -lc 'cd /tmp && rm -rf pm-helper && \
    git clone https://$GITHUB_TOKEN@github.com/ear2earGrin/pm-helper.git pm-helper && \
    python3 pm-helper/scripts/pm_brief_redesign_cycle.py >> ~/pm-brief-cron.log 2>&1'
"""
import html
import json
import os
import re
import subprocess
import sys
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (compatible; pm-brief-redesign/1.0; +https://pm-brief.com)"
LLM_TIMEOUT = int(os.environ.get("PMBRIEF_LLM_TIMEOUT", "240"))


def log(msg):
    print(f"[cycle] {msg}", flush=True)


def run(cmd, timeout, inp=None):
    """Run a subprocess with a hard timeout; return (rc, stdout, stderr)."""
    p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True,
                       input=inp, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


# ── site content extraction (stdlib only) ───────────────────────────────────
class _Extract(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text, self.imgs, self.title = [], [], ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg"):
            self._skip += 1
        if tag == "title":
            self._in_title = True
        if tag == "img":
            for k, v in attrs:
                if k == "src" and v:
                    self.imgs.append(v)

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg") and self._skip:
            self._skip -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            t = data.strip()
            if t:
                self.text.append(t)


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        final = r.geturl()
        raw = r.read(600_000).decode("utf-8", "replace")
        return final, raw


def site_content(url):
    """Return {title, description, text, images[], final_url} or None."""
    if not url:
        return None
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    for candidate in (url, f"{urlparse(url).scheme}://{urlparse(url).netloc}/"):
        try:
            final, raw = fetch(candidate)
        except Exception:
            continue
        p = _Extract()
        try:
            p.feed(raw)
        except Exception:
            pass
        desc = ""
        m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', raw, re.I)
        if m:
            desc = html.unescape(m.group(1))
        imgs = []
        for s in p.imgs:
            if s.startswith("data:"):
                continue
            absu = urljoin(final, s)
            if absu not in imgs:
                imgs.append(absu)
            if len(imgs) >= 8:
                break
        text = " ".join(p.text)
        text = re.sub(r"\s+", " ", text)[:3500]
        if text or p.title:
            return {"title": html.unescape(p.title.strip()), "description": desc,
                    "text": text, "images": imgs, "final_url": final}
    return None


# ── the ONE bounded LLM call ────────────────────────────────────────────────
def build_prompt(job, content):
    lines = [
        "Build a COMPLETE, modern, self-contained redesign of a small business's website "
        "as a single index.html file. Requirements:",
        "- One file: inline CSS (and inline JS only if needed). No external build, no frameworks.",
        "- Responsive, clean, professional; a hero, services/about, and a contact section with a "
        "Google-Maps embed and click-to-call. Use the business's REAL details below.",
        "- Match the site's original language (e.g. Greek stays Greek). Keep any real content/tone.",
        "- Output ONLY the raw HTML document (start with <!DOCTYPE html>). No markdown fences, no commentary.",
        "",
        f"Business: {job.get('company','')}",
        f"Address: {job.get('address','') or '(unknown)'}",
        f"Phone: {job.get('phone','') or '(unknown)'}",
        f"Maps URL: {job.get('maps_url','') or '(none)'}",
        f"Current site: {job.get('website_url','') or '(none)'}",
    ]
    if content:
        lines += [
            "", "--- content scraped from their current site (use it, improve the presentation) ---",
            f"Title: {content['title']}", f"Description: {content['description']}",
            f"Images (you may reference by URL): {', '.join(content['images'][:6])}",
            f"Text: {content['text']}",
        ]
    return "\n".join(lines)


def llm_html(prompt):
    """Return generated HTML, or None to trigger the template fallback."""
    cmd = os.environ.get("PMBRIEF_LLM_CMD")
    if cmd:
        try:
            rc, out, err = run(["bash", "-lc", cmd], timeout=LLM_TIMEOUT, inp=prompt)
            if rc == 0 and out.strip():
                return out
            log(f"PMBRIEF_LLM_CMD rc={rc}: {err.strip()[:200]}")
        except Exception as e:
            log(f"PMBRIEF_LLM_CMD failed: {e}")
        return None

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        log("no OPENAI_API_KEY / PMBRIEF_LLM_CMD — using built-in template")
        return None
    model = os.environ.get("PMBRIEF_LLM_MODEL", "gpt-4o")
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a senior web designer. You output only raw HTML documents."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.5,
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
            data = json.loads(r.read().decode())
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        log(f"OpenAI call failed: {e}")
        return None


def clean_html(s):
    if not s:
        return None
    s = s.strip()
    s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
    s = re.sub(r"\s*```$", "", s).strip()
    low = s.lower()
    if "<html" in low or "<!doctype html" in low:
        return s
    return None


def template_html(job):
    c = html.escape(job.get("company") or "Your Business")
    addr = html.escape(job.get("address") or "")
    phone = job.get("phone") or ""
    tel = re.sub(r"[^0-9+]", "", phone)
    maps_q = urllib.parse.quote(job.get("address") or job.get("company") or "")
    maps = job.get("maps_url") or (f"https://www.google.com/maps/search/?api=1&query={maps_q}" if maps_q else "#")
    embed = f"https://www.google.com/maps?q={maps_q}&output=embed" if maps_q else ""
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{c}</title>
<style>
:root{{--bg:#f6f9fb;--ink:#12202b;--muted:#5b7180;--line:#e2ebf0;--acc:#0fb5a6;--acc2:#0d94a5;--navy:#123a4d}}
*{{box-sizing:border-box;margin:0;padding:0}}body{{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.65}}
a{{color:inherit;text-decoration:none}}.wrap{{max-width:1080px;margin:0 auto;padding:0 22px}}
.btn{{display:inline-flex;gap:8px;align-items:center;padding:13px 24px;border-radius:10px;font-weight:600;background:var(--acc);color:#00252b}}
header{{background:var(--navy);color:#eaf4f8;padding:14px 0}}.nav{{display:flex;justify-content:space-between;align-items:center}}
.hero{{background:linear-gradient(180deg,var(--navy),#0c3050);color:#eaf4f8;padding:80px 0}}
.hero h1{{font-size:clamp(34px,5vw,52px);line-height:1.08;margin-bottom:16px}}.hero p{{color:#b7cede;font-size:19px;max-width:52ch;margin-bottom:26px}}
section{{padding:64px 0}}.sec h2{{font-size:clamp(26px,4vw,36px);color:var(--navy);margin-bottom:26px}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}}@media(max-width:820px){{.grid{{grid-template-columns:1fr}}}}
.card{{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px}}.card h3{{color:var(--navy);margin-bottom:6px}}.card p{{color:var(--muted);font-size:15px}}
.contact{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}@media(max-width:820px){{.contact{{grid-template-columns:1fr}}}}
.info .line{{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}}.info .line:last-child{{border:0}}
iframe{{width:100%;min-height:320px;border:0;border-radius:14px}}
footer{{background:var(--navy);color:#9fbccd;padding:34px 0;font-size:14px}}
</style></head><body>
<header><div class="wrap nav"><strong>{c}</strong>{f'<a class="btn" href="tel:{tel}">Call us</a>' if tel else ''}</div></header>
<section class="hero"><div class="wrap"><h1>{c}</h1>
<p>Quality service you can rely on. {('Visit us at ' + addr) if addr else ''}</p>
<a class="btn" href="#contact">Get in touch →</a></div></section>
<section class="sec"><div class="wrap"><h2>What we offer</h2><div class="grid">
<div class="card"><h3>Professional service</h3><p>Experienced, friendly and dependable.</p></div>
<div class="card"><h3>Quality first</h3><p>Care and attention in everything we do.</p></div>
<div class="card"><h3>Local &amp; trusted</h3><p>Proud to serve our community.</p></div>
</div></div></section>
<section class="sec" id="contact"><div class="wrap"><h2>Contact us</h2><div class="contact">
<div class="info">
{f'<div class="line">📍 {addr}</div>' if addr else ''}
{f'<div class="line">📞 <a href="tel:{tel}">{html.escape(phone)}</a></div>' if phone else ''}
<div class="line"><a class="btn" href="{html.escape(maps)}" target="_blank" rel="noopener">Directions</a></div>
</div>
{f'<iframe loading="lazy" src="{html.escape(embed)}" title="map"></iframe>' if embed else ''}
</div></div></section>
<footer><div class="wrap">© {c}{(' · ' + addr) if addr else ''}</div></footer>
</body></html>"""


def main():
    os.chdir(REPO)
    log(f"repo: {REPO}")

    # 2) pick
    rc, out, err = run(["python3", "scripts/hermes_pick.py"], timeout=180)
    if rc != 0:
        log(f"hermes_pick failed rc={rc}: {err.strip()[:300]}")
        return 1
    picked = None
    for line in out.strip().splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                picked = json.loads(line)
            except Exception:
                pass
    if not picked:
        log(f"could not parse pick output: {out.strip()[:300]}")
        return 1
    if picked.get("action") != "build":
        log(f"nothing to build ({picked.get('action')}: {picked.get('reason','')}). Done.")
        return 0

    job = picked["job"]
    slug = job["slug"]
    log(f"building: {job.get('company')} [{slug}]  site={job.get('website_url')}")

    # 4) fetch the real site (best-effort)
    content = None
    try:
        content = site_content(job.get("website_url"))
        log(f"site content: {'ok' if content else 'none'}")
    except Exception as e:
        log(f"site fetch error: {e}")

    # 5) ONE bounded LLM call, else template
    page = clean_html(llm_html(build_prompt(job, content)))
    used = "llm"
    if not page:
        page, used = template_html(job), "template"
    log(f"redesign source: {used} ({len(page)} bytes)")

    outdir = os.path.join(REPO, "redesigns", slug)
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)

    # 6) finish (commit/push + move job to review)
    email = job.get("email") or ""
    summary = f"Redesign built ({used}) from {content['final_url'] if content else 'company data'}."
    args = ["python3", "scripts/hermes_finish.py", job["id"], slug]
    if email:
        args.append(email)
    args.append(summary)
    rc, out, err = run(args, timeout=180)
    if rc != 0:
        log(f"hermes_finish failed rc={rc}: {err.strip()[:300]}")
        return 1
    log(f"done: https://pm-brief.com/redesigns/{slug}/  ({used})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.TimeoutExpired as e:
        log(f"TIMEOUT: {e}")
        sys.exit(1)
    except Exception as e:
        log(f"FATAL: {e}")
        sys.exit(1)
