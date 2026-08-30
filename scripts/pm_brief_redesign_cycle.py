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
  5. If no generator (OPENAI_API_KEY / PMBRIEF_LLM_CMD): kitchen closes.
     No prospecting, no fallback template, no Review.
  6. ONE bounded LLM call -> index.html. If generation fails, kitchen closes
     (do NOT fall back to the generic template).
  7. Quality gate (scripts/redesign_utils.analyze_html). Failures or generic
     copy -> do not finish, do not mark Review.
  8. scripts/hermes_finish.py          -> commit/push + move job to 'review'
  7. print a concise summary; exit 0 on success, nonzero only on real failure

Env:
  GITHUB_TOKEN, SUPABASE_BOT_PASSWORD   (required by the sub-scripts)
  SUPABASE_ANON                         (optional; else read from the repo)
  OPENAI_API_KEY                        (optional; enables real LLM generation)
  PMBRIEF_LLM_MODEL   (default "gpt-4o")
  PMBRIEF_LLM_CMD     (optional: a shell command that reads the prompt on stdin
                       and prints the HTML on stdout — use your own model CLI)
  PMBRIEF_MAX_PAGES   (default 6 — homepage + useful subpages to crawl)
  PMBRIEF_MAX_IMAGES  (default 12 — real content photos passed to the model)

Cron (system crontab, the robust path — NOT an LLM agent):
  0 9,12,15,18,21 * * *  bash -lc 'set -a; . ~/.hermes/.env; set +a; cd /tmp && rm -rf pm-helper && \
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
from pathlib import Path
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
MAX_PAGES = int(os.environ.get("PMBRIEF_MAX_PAGES", "6"))
MAX_IMAGES = int(os.environ.get("PMBRIEF_MAX_IMAGES", "12"))

# Same-domain subpages worth crawling (EN + Greek). Homepage rarely has it all.
GOOD_PATH = re.compile(
    r"about|service|treatment|procedure|gallery|photo|team|staff|doctor|contact|"
    r"review|testimonial|price|hour|clinic|practice|"
    # Greek (script)
    r"υπηρεσ|θεραπ|ιατρ|οδοντ|γαλερ|φωτο|ομαδ|προσωπ|επικοιν|τιμ|σχετικ|ωραρ|"
    # Greek (Latin transliteration — common in .gr URLs)
    r"ypiresi|therap|iatri|odont|galer|photo|omad|proswp|epikoin|tim|sxetik|orari", re.I)
# Prefer real content photos; reject chrome/tracking/icons.
IMG_GOOD = re.compile(
    r"upload|wp-content|media|gallery|photo|image|hero|banner|slide|team|staff|"
    r"doctor|clinic|office|practice|dental|service|interior|building", re.I)
IMG_BAD = re.compile(
    r"logo|icon|sprite|favicon|placeholder|pixel|spacer|blank|loading|lazy-?load|"
    r"1x1|badge|flag|payment|whatsapp|facebook|instagram|twitter|avatar-default|"
    r"cookie|captcha|\.svg(\?|$)|\.gif(\?|$)", re.I)


class _Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text, self.imgs, self.links, self.title = [], [], [], ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "noscript", "svg"):
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag in ("img", "source"):
            for key in ("src", "data-src", "data-lazy-src", "data-original", "data-image"):
                if a.get(key):
                    self.imgs.append(a[key])
            for key in ("srcset", "data-srcset"):
                if a.get(key):
                    # take the largest candidate (last entry)
                    parts = [c.strip().split()[0] for c in a[key].split(",") if c.strip()]
                    if parts:
                        self.imgs.append(parts[-1])
        # inline background-image on any tag
        style = a.get("style")
        if style and "background" in style:
            for m in re.findall(r"url\(([^)]+)\)", style):
                self.imgs.append(m.strip("'\" "))

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg") and self._skip:
            self._skip -= 1
        elif tag == "title":
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
        return r.geturl(), r.read(900_000).decode("utf-8", "replace")


def _raw_images(raw, base):
    """og:image + css background-image URLs straight from the raw HTML."""
    urls = []
    for m in re.findall(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', raw, re.I):
        urls.append(("og", urljoin(base, html.unescape(m))))
    for m in re.findall(r"background-image\s*:\s*url\(([^)]+)\)", raw, re.I):
        urls.append(("bg", urljoin(base, m.strip("'\" "))))
    return urls


def curate_images(candidates):
    """candidates: list of (source_tag, url). Return best content-photo URLs."""
    scored = {}
    for src, u in candidates:
        if not u or u.startswith("data:"):
            continue
        u = u.split("#")[0]
        if IMG_BAD.search(u):
            continue
        if not re.search(r"\.(jpe?g|png|webp|avif)(\?|$)", u, re.I) and src != "og":
            continue
        score = 0
        if src == "og":
            score += 6
        if IMG_GOOD.search(u):
            score += 3
        if re.search(r"\b(20\d\d|\d{3,4}x\d{3,4})\b", u):
            score += 1
        scored[u] = max(scored.get(u, -99), score)
    ranked = sorted(scored, key=lambda k: (-scored[k], len(k)))
    return ranked[:MAX_IMAGES]


def dedup_text(parts):
    seen, out = set(), []
    for chunk in parts:
        for seg in re.split(r"(?<=[.!?·;:])\s+|\s{2,}|\s\|\s", chunk):
            seg = seg.strip()
            key = seg.lower()
            if len(seg) < 3 or key in seen:
                continue
            seen.add(key)
            out.append(seg)
    return " ".join(out)[:6000]


def crawl_site(url):
    """Bounded same-domain crawl. Returns aggregated content dict or None."""
    if not url:
        return None
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    origin = urlparse(url).netloc
    start_candidates = [url, f"{urlparse(url).scheme}://{origin}/"]
    to_visit, seen, seen_final = list(dict.fromkeys(start_candidates)), set(), set()
    pages, texts, imgs, title, desc = [], [], [], "", ""

    while to_visit and len(pages) < MAX_PAGES:
        u = to_visit.pop(0)
        if u in seen:
            continue
        seen.add(u)
        try:
            final, raw = fetch(u)
        except Exception:
            continue
        if final in seen_final:   # the two start candidates often resolve to the same page
            continue
        seen_final.add(final)
        pages.append(final)
        p = _Page()
        try:
            p.feed(raw)
        except Exception:
            pass
        if not title and p.title.strip():
            title = html.unescape(p.title.strip())
        if not desc:
            m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', raw, re.I)
            if m:
                desc = html.unescape(m.group(1))
        texts.append(re.sub(r"\s+", " ", " ".join(p.text)))
        imgs += [("img", urljoin(final, s)) for s in p.imgs] + _raw_images(raw, final)
        # queue useful same-domain subpages
        for href in p.links:
            lu = urljoin(final, href).split("#")[0]
            pu = urlparse(lu)
            if pu.netloc == origin and lu not in seen and lu not in to_visit \
                    and GOOD_PATH.search(pu.path) and not re.search(r"\.(pdf|jpg|png|zip)$", pu.path, re.I):
                to_visit.append(lu)

    if not pages:
        return None
    return {"title": title, "description": desc, "text": dedup_text(texts),
            "images": curate_images(imgs), "pages": pages, "final_url": pages[0]}


# ── the ONE bounded LLM call ────────────────────────────────────────────────
def load_taste():
    path = Path(REPO) / "docs" / "TASTE.md"
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def download_images(urls, outdir, limit=6):
    """Save a few real photos next to index.html. Skip tiny/failed downloads."""
    saved = []
    os.makedirs(outdir, exist_ok=True)
    for i, url in enumerate(urls[:limit], 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": url})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read(2_500_000)
                ctype = (r.headers.get("Content-Type") or "").lower()
            if len(data) < 8000:
                continue
            ext = "jpg"
            if "png" in ctype or url.lower().split("?")[0].endswith(".png"):
                ext = "png"
            elif "webp" in ctype or url.lower().split("?")[0].endswith(".webp"):
                ext = "webp"
            name = f"photo-{i:02d}.{ext}"
            dest = os.path.join(outdir, name)
            with open(dest, "wb") as f:
                f.write(data)
            saved.append(name)
            log(f"saved {name} ({len(data)} bytes)")
        except Exception as e:
            log(f"photo skip: {e}")
    return saved


def build_prompt(job, content):
    taste = load_taste()
    lines = [
        "Redesign this small business's website as ONE complete, modern, self-contained "
        "index.html. This is a pitch preview — it must look like a real, premium site.",
        "",
        "STRUCTURE — at least 6 visually distinct, full-width sections, in this spirit:",
        "  1. sticky top nav (business name + anchor links + a call button)",
        "  2. hero using a REAL photo from the image URLs below (CSS background or <img>)",
        "  3. short intro / trust band",
        "  4. services or treatments — from the scraped content, as cards",
        "  5. why-choose-us OR about/team (include team/about only if found below)",
        "  6. a photo gallery strip using the supplied images",
        "  7. contact: address, click-to-call phone, opening hours (only if found), "
        "and a Google-Maps <iframe> embed",
        "  + a sticky mobile call/CTA bar.",
        "",
        "TASTE (follow exactly):",
        taste or "- Art-directed, not templated. No navy/teal SaaS look.",
        "",
        "RULES:",
        "- DESIGN DIRECTION: do NOT use a generic light-background + teal/navy SaaS template look. "
        "Pick ONE distinctive, premium direction that fits the business category (e.g. warm cream + deep "
        "green, charcoal + gold, editorial serif, soft clay + ink) and commit to it consistently across "
        "palette, typography, spacing, buttons and motion. It must look art-directed, not templated.",
        "- One HTML file with inline CSS. No frameworks. Google Fonts via <link> is allowed.",
        "- Images MUST be the local files listed below, as relative src (e.g. src=\"photo-01.jpg\"). "
        "Do not hotlink. Do not emit data: URIs. Use at least 3 local photos if 3+ were supplied, "
        "or all of them if fewer.",
        "- DO NOT invent services, doctors, staff names, reviews, ratings, awards, prices, or "
        "years of experience. Use ONLY what's in the scraped content + the details below. If "
        "something is missing, write polished but conservative copy from the business category.",
        "- Preserve the original language (Greek stays Greek). Give a real <title> and "
        "<meta name=description>. Responsive and accessible.",
        "- These previews are hosted on pm-brief.com but are not ours to rank. Always include "
        "<meta name=\"robots\" content=\"noindex, nofollow\"> in the <head>.",
        "- Output ONLY the raw HTML document, starting with <!DOCTYPE html>. No markdown, no commentary.",
        "",
        f"Business: {job.get('company','')}",
        f"Address: {job.get('address','') or '(unknown)'}",
        f"Phone: {job.get('phone','') or '(unknown)'}",
        f"Maps URL: {job.get('maps_url','') or '(none)'}",
        f"Current site: {job.get('website_url','') or '(none)'}",
    ]
    if content:
        imgs = content.get("local_photos") or []
        remote = content.get("images") or []
        lines += [
            "",
            f"--- scraped from their site ({len(content.get('pages', []))} page(s): "
            f"{', '.join(content.get('pages', [])[:6])}) — use it, present it better ---",
            f"Title: {content['title']}",
            f"Description: {content['description']}",
            f"Local photo files ({len(imgs)} — MUST use these as relative src): "
            + ("\n  ".join([""] + imgs) if imgs else "(none downloaded)"),
            f"Source photo URLs we already saved from ({len(remote)}): do not hotlink these.",
            f"Text: {content['text']}",
        ]
    else:
        lines += ["", "(No source website was reachable — build a clean, conservative page "
                  "from the business name, category, address and phone only. Do not invent specifics.)"]
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
        log("no OPENAI_API_KEY / PMBRIEF_LLM_CMD — kitchen closed")
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
        return force_noindex(s)
    return None


def force_noindex(s):
    """Guarantee the noindex tag the prompt asks for.

    These previews live on pm-brief.com but belong to the lead, not to us —
    indexing dozens of near-identical pitch pages buries the toolkit under
    thin duplicate content. The model is told to add the tag; this makes sure
    it is there even when it doesn't.
    """
    if re.search(r"<meta[^>]+name=[\"']?robots", s, re.I):
        return re.sub(
            r"(<meta[^>]+name=[\"']?robots[\"']?[^>]*content=[\"'])[^\"']*([\"'])",
            r"\1noindex, nofollow\2", s, count=1, flags=re.I)
    tag = '<meta name="robots" content="noindex, nofollow"/>'
    # <head> if there is one; otherwise straight after <html>, where the parser
    # hoists it into the implicit head anyway.
    m = re.search(r"<head[^>]*>", s, re.I) or re.search(r"<html[^>]*>", s, re.I)
    if m:
        return s[:m.end()] + "\n" + tag + s[m.end():]
    return tag + "\n" + s


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
<meta name="robots" content="noindex, nofollow"/>
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


def generator_available():
    return bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("PMBRIEF_LLM_CMD"))


def main():
    os.chdir(REPO)
    log(f"repo: {REPO}")

    if not generator_available():
        log("KITCHEN CLOSED: no OPENAI_API_KEY / PMBRIEF_LLM_CMD. "
            "Not prospecting, not building a fallback, not marking Review.")
        return 0

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
    if not slug:
        log(f"invalid empty slug for job {job.get('id')}: {job.get('company')}")
        return 1
    log(f"building: {job.get('company')} [{slug}]  site={job.get('website_url')}")

    # 4) crawl the real site (homepage + up to MAX_PAGES useful subpages)
    content = None
    try:
        content = crawl_site(job.get("website_url"))
        if content:
            log(f"crawled {len(content['pages'])} page(s), {len(content['images'])} photo(s), "
                f"{len(content['text'])} chars of text")
        else:
            log("no source site reachable — building from company data only")
    except Exception as e:
        log(f"crawl error: {e}")

    outdir = os.path.join(REPO, "redesigns", slug)
    os.makedirs(outdir, exist_ok=True)
    local_photos = []
    if content and content.get("images"):
        local_photos = download_images(content["images"], outdir, limit=min(6, MAX_IMAGES))
        content["local_photos"] = local_photos
        log(f"downloaded {len(local_photos)} local photo(s)")

    # 5) ONE bounded LLM call. No template dinner if the chef is absent/fails.
    page = clean_html(llm_html(build_prompt(job, content)))
    if not page:
        log("KITCHEN CLOSED: generator produced no HTML. "
            "Not writing the fallback template, not marking Review. "
            "Job stays redesigning so the next pick can reset it to lead.")
        return 0
    used = "llm"
    log(f"redesign source: {used} ({len(page)} bytes)")

    html_path = os.path.join(outdir, "index.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(page)

    if local_photos:
        photos_used = [n for n in local_photos if n in page]
        need = min(3, len(local_photos))
        if len(photos_used) < need:
            log(f"QUALITY GATE FAIL: local photos supplied={local_photos} used={photos_used}. "
                "Not marking Review.")
            return 0

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from redesign_utils import analyze_html
    audit = analyze_html(Path(html_path))
    if audit.get("failures") or audit.get("quality") == "generic":
        log(f"QUALITY GATE FAIL {audit.get('quality')}: {audit.get('failures')}. "
            "Not calling hermes_finish, not marking Review.")
        return 0

    # 6) finish (commit/push + move job to review)
    email = job.get("email") or ""
    if content:
        summary = (f"Redesign built ({used}) from {len(content['pages'])} page(s) of "
                   f"{content['final_url']} — {len(content['images'])} real photos available.")
    else:
        summary = f"Redesign built ({used}) from company data only (no source site reachable)."
    if used == "llm":
        summary = "⭐ " + summary
    args = ["python3", "scripts/hermes_finish.py", job["id"], slug]
    if email:
        args.append(email)
    args.append(summary)
    rc, out, err = run(args, timeout=180)
    if rc != 0:
        detail = (err.strip() or out.strip() or "(no output)")
        log(f"hermes_finish failed rc={rc}: {detail[:1200]}")
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
