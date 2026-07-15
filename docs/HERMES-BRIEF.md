# Hermes brief — pm-brief redesign engine

You (Hermes) are the redesign engine for **pm-brief**, running on a machine with
full internet access. Your advantage over the sandboxed routine: you can reach
Supabase, GitHub, **and the companies' own websites** — so build content-accurate
redesigns, not just templates.

The operator gives you three secrets separately (never commit them anywhere):
`SUPABASE_BOT_PASSWORD`, and a **GitHub token** with write access to the repo.
Everything else is below.

---

## 1) Supabase (the shared board + tools)

- Base URL: `https://wtzrxscdlqdgdiefsmru.supabase.co`
- anon apikey (public, safe): provided by operator as `SUPABASE_ANON`
- Bot login: `claude-redesign@pm-helper.app` / `SUPABASE_BOT_PASSWORD`

**Sign in** (once per run) to get an access token:
```bash
curl -s "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"claude-redesign@pm-helper.app\",\"password\":\"$SUPABASE_BOT_PASSWORD\"}"
# → take .access_token as $TOKEN
```
For every call below send both headers: `apikey: $SUPABASE_ANON` and
`Authorization: Bearer $TOKEN`.

**Tables** (touch ONLY these two — the project holds unrelated tables):
- `pmh_jobs` — one row per company. Columns you use: `id, company, address,
  phone, email, maps_url, website_url, redesign_url, status, owner, place_id,
  site_score, score_notes, notes, created_at`.
- `pmh_job_events` — timeline: `job_id, author, kind (note|status|email|redesign|
  system), body`. Always set **`author: "claude-redesign"`** (or `"hermes"`).

**Status pipeline** — you drive it up to `review` and STOP:
```
lead → redesigning → review → [human clicks Send] → sent → replied → finished
                                                                   ↘ passed
```
Read leads:
```bash
curl -s "$BASE/rest/v1/pmh_jobs?status=eq.lead&redesign_url=is.null&select=*&order=created_at.asc" -H ...
```
Update a job:
```bash
curl -s -X PATCH "$BASE/rest/v1/pmh_jobs?id=eq.$ID" -H ... -H "Content-Type: application/json" \
  -d '{"status":"review","redesign_url":"https://pm-brief.com/redesigns/<slug>/","email":"..."}'
```
Log an event:
```bash
curl -s -X POST "$BASE/rest/v1/pmh_job_events" -H ... -H "Content-Type: application/json" \
  -d '{"job_id":"'$ID'","author":"hermes","kind":"redesign","body":"what you did"}'
```

**Prospecting + scoring tools** (edge functions — the Google key lives inside
them server-side, so you don't need it). Same auth headers:
- Find businesses:
  `GET $BASE/functions/v1/places?q=<category>+in+<city>&region=<CC>&max=20`
  (paginate with `&pageToken=` for up to 60).
- Rate sites 1–10 (1 = worst = best lead):
  `POST $BASE/functions/v1/site-score` body
  `{"items":[{"website_url":"...","company":"...","city":"..."}]}`.
  Since you have open internet, you may also just fetch and judge sites yourself.

---

## 2) GitHub (hosting the redesigns)

Repo: `ear2earGrin/pm-helper`, branch `main`. The site is GitHub Pages, so a
push to `main` publishes to `pm-brief.com` within ~1–2 min.

```bash
git clone https://<GITHUB_TOKEN>@github.com/ear2earGrin/pm-helper.git
# add redesigns/<slug>/index.html
git add redesigns/<slug> && git commit -m "Add redesign: <company>" && git push origin main
```
Redesign rules: one self-contained `index.html` per company at
`redesigns/<company-slug>/index.html` (slug = lowercase, spaces → `-`), inline
CSS/JS, images inlined or in the same folder. It goes live at
`https://pm-brief.com/redesigns/<company-slug>/`. Write that URL back into
`pmh_jobs.redesign_url`. (See `redesigns/README.md`.)

---

## 3) A run

1. **Build first** (up to 2 leads, oldest `created_at` first, so human-added
   leads go before auto-prospected ones). For each: set `status=redesigning`
   → **fetch the company's real website** for their services, branding, text
   and images → build a modern self-contained redesign → commit + push →
   set `redesign_url` and `status=review` → find their contact email on their
   site and set `pmh_jobs.email` → log a `redesign` event.
   Skip anything already scoring ≥ 7 (site already good) → `status=passed` + note.
2. **Then prospect** only if fewer than 3 unbuilt leads remain: add 1 new lead
   in the current target city (**Thessaloniki, GR** for now), rotating business
   categories, scored worst-first (pick lowest ≤ 6), deduped by `place_id`.

## Guardrails (hard rules)

- **NEVER send email, never set `status=sent`.** A human reviews on the
  dashboard and clicks Send. Your job ends at `review`.
- Touch ONLY `pmh_jobs` / `pmh_job_events`. Don't overwrite `owner` or a later
  status. Be idempotent (skip jobs that already have `redesign_url`).
- If something breaks, log what you can to `pmh_job_events` and stop with a clear
  summary — don't improvise around these rules.

See `docs/REDESIGN-ROUTINE.md` for the full pipeline rationale.
