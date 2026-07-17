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
- anon apikey (public, safe): if `SUPABASE_ANON` isn't in your env, **read it
  from the repo you cloned** — it's the `SUPABASE_ANON` constant in
  `js/pmh-supabase.js`. It's a public key by design (it's shipped in the
  website's client JS), so reading it from the repo is fine.
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

## FAST PATH — use the helper scripts (do this; it saves tool calls)

Your per-run tool budget is small, so do NOT hand-run auth/curl/git steps. Two
scripts in the repo do all the deterministic work in one execution each. A whole
run is ~5 tool calls:

```bash
# 1. clone (token from your env)
git clone https://$GITHUB_TOKEN@github.com/ear2earGrin/pm-helper.git && cd pm-helper
# 2. pick or prospect ONE lead, mark it redesigning, print the job as JSON
python3 scripts/hermes_pick.py        # → {"action":"build","job":{id,company,website_url,slug,...}}
#    (if action != "build", there's nothing to do — stop and report)
# 3. FETCH the job.website_url, then WRITE redesigns/<slug>/index.html
#    (this is your only creative step — a modern, self-contained page)
# 4. publish: commit+push, set redesign_url + status=review + email, log event
python3 scripts/hermes_finish.py <job_id> <slug> [contact_email] "one-line summary"
```

The scripts read `SUPABASE_ANON` (from env or `js/pmh-supabase.js`),
`SUPABASE_BOT_PASSWORD`, and `GITHUB_TOKEN` from your environment — you never
type or eyeball the anon key. `hermes_pick.py` already handles stuck-job
recovery, depth-first dentist-first prospecting, scoring, dedupe, and the
`redesigning` status. You only fetch the site and write the page. Everything in
"## 3) A run" below is what those scripts implement — read it for intent, but
run the scripts rather than doing it by hand.

## 3) A run

0. **Recover stuck jobs first.** A previous run may have been interrupted mid-
   build. At the start of every run, find jobs with `status = 'redesigning'` and
   `redesign_url IS NULL` and reset them to `status = 'lead'` (log a `system`
   event: "reset stuck redesigning → lead"). Never leave a job in `redesigning`
   at the end of a run.
1. **Build exactly ONE redesign per run.** This job runs ~5× per day — one
   redesign each time, never a bulk batch. Pick the **oldest** `status=lead`
   with `redesign_url` null (human-added leads first). If the lead queue is
   empty, prospect the next qualifying business (step 2) and build that one.
   For the chosen lead: set `status=redesigning` → **fetch the company's real
   website** for services, branding, text and images → build a modern self-
   contained redesign → commit + push → set `redesign_url` and `status=review`
   → find their contact email and set `pmh_jobs.email` → log a `redesign` event.
   Skip anything already scoring ≥ 7 (site already good) → `status=passed` + note.
2. **Then top up the queue** so the next run has work ready: if **0** unbuilt
   leads remain, prospect 1 new lead in the current target city
   (**Thessaloniki, GR** for now), scored worst-first (pick lowest ≤ 6), deduped
   by `place_id`. Skip prospecting if **≥ 3** unbuilt leads are already queued.

   **Category order — DEPTH-FIRST, not rotating.** Work one category to
   exhaustion before moving to the next, in this exact order:
   1. **Dentists**  2. Lawyers  3. Accountants  4. Notaries
   5. Physiotherapists  6. Dermatology / aesthetic clinics  7. Veterinarians
   8. Opticians  9. Real estate agencies  10. Gyms *(later)*

   Each run, start at the **top** category and pick the first one that still has
   a qualifying candidate: search Places for it in Thessaloniki, paginate (up to
   60), and add the worst-scoring business (score ≤ 6) whose `place_id` isn't
   already in `pmh_jobs`. A category is **exhausted** when every candidate it
   returns is already on the board or scores ≥ 7 — only then advance to the next
   category. In practice: keep prospecting **Dentists** until Thessaloniki
   dentists run dry, then Lawyers, and so on.

## Data-quality check before building (important)

A `site_score` of 1 labelled **"Broken / 404 / Unreachable"** is often a false
signal: Google listings frequently point to a **deep link or removed sub-page**
that 404s while the business's real homepage is perfectly fine. Before you build:

1. Fetch the lead's `website_url`. If it 404s or errors, **try the root domain**
   (e.g. `https://alterlife.gr` instead of `https://alterlife.gr/limani-…`), and
   search the web for "`<company> <city>`" to find their real site.
2. If a real, working site exists and it's actually decent (modern, mobile,
   HTTPS), **don't build** — set `status = passed` with a note and update
   `website_url` to the real one. Only build when the business genuinely has a
   weak, broken, or missing site.

## Guardrails (hard rules)

- **NEVER send email, never set `status=sent`.** A human reviews on the
  dashboard and clicks Send. Your job ends at `review`.
- Touch ONLY `pmh_jobs` / `pmh_job_events`. Don't overwrite `owner` or a later
  status. Be idempotent (skip jobs that already have `redesign_url`).
- If something breaks, log what you can to `pmh_job_events` and stop with a clear
  summary — don't improvise around these rules.

See `docs/REDESIGN-ROUTINE.md` for the full pipeline rationale.
