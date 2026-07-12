# Redesign Routine — the contract

This is the instruction set for the **second Claude session** (a Claude Code
Routine) that builds website redesigns and feeds the pm-brief dashboard. The
dashboard at `pm-brief.com/dashboard.html` is a passive reader of Supabase — the
routine never talks to it directly; it writes to the shared database, and the
board updates live.

> Paste the **"Routine prompt"** at the bottom into the routine's instructions.
> Everything above it explains the moving parts.

---

## The shared board (source of truth)

- **Supabase project ref:** `wtzrxscdlqdgdiefsmru`
- **Tables:**
  - `pmh_jobs` — one row per company
  - `pmh_job_events` — timeline of updates per company
- **Key columns on `pmh_jobs`:**

  | column | meaning |
  |---|---|
  | `id` | uuid, primary key |
  | `company`, `address`, `phone`, `email` | contact info |
  | `maps_url` | Google Maps link |
  | `website_url` | the company's **current** site (input) |
  | `redesign_url` | link to the **redesign you built** (output) |
  | `status` | `lead → redesigning → sent → replied → finished` (or `passed`) |
  | `owner` | which partner owns it (`mdonkov` / `lkashkin`) — leave as-is |
  | `place_id` | Google Places id (dedupe key) |
  | `notes` | latest free-text note |

- **`pmh_job_events`:** `job_id`, `author`, `kind`
  (`note|status|email|redesign|system`), `body`. Always set
  **`author = 'claude-redesign'`** so the timeline shows who did it.

## Status pipeline (what the routine drives)

```
lead ──▶ redesigning ──▶ review ──▶ sent ──▶ replied ──▶ finished
        (routine)       (routine │  (HUMAN clicks Send      └─(no fit)─▶ passed
                         stops   │   on the dashboard)
                         HERE)   ▼
```

- Pick up work at **`status = 'lead'`**.
- Flip to **`redesigning`** while building.
- When the redesign is hosted and `redesign_url` is set, flip to **`review`**
  and stop. **The routine NEVER sends email and NEVER sets `sent`** — a human
  reviews the redesign on the dashboard and clicks ✉️ Review & Send.
- Never set `replied` / `finished` — those are human/inbox signals.

## Daily prospecting (find 1 new company per run)

Rotate deterministically through the categories (e.g. index by day-of-year):

- **Categories:** Dentists, Accountants, Lawyers, Hair salons, Auto repair
  shops, Restaurants, Veterinarians, Gyms, Real estate agencies, Bakeries.
- **Target city — current goal: Thessaloniki, Greece** (`region=GR`).
  This is the only city to prospect for now. Planned expansion (do NOT use
  yet, humans will move them up when ready): Athens (GR), then Sofia,
  Plovdiv, Varna, Burgas (BG, `region=BG`).

1. Search via the `places` Edge Function (bot JWT):
   `GET https://wtzrxscdlqdgdiefsmru.supabase.co/functions/v1/places?q=<category>+in+<city>&region=<city's region code>&max=20`
   (paginate with `&pageToken=<next_page_token>` for up to 60 results if the
   first page has no qualifying candidate).
2. **Rate every candidate** with the `site-score` Edge Function:
   `POST …/functions/v1/site-score` with
   `{ "items": [ {"website_url": "...", "company": "...", "city": "..."} ] }`
   (bot JWT, max 25/call). It returns `{score 1-10, label, reasons, resolved_url}`
   per business — **1 = terrible site = prime lead**; social-only ≈ 2.
   **Important:** Google often omits a business's website from its listing.
   Passing `company`+`city` lets the function web-search for the real site
   first; if it finds one it returns `resolved_url` and scores THAT (flagged
   "found via search"). Because you (the routine) have your own WebSearch/
   WebFetch tools, also independently confirm before treating any lead as
   "no website" — a business with a real (but unlisted) site is scored on that
   site, not auto-rated 1/10. Store the resolved site in `pmh_jobs.website_url`.
   Optionally deep-check one finalist with mobile Lighthouse:
   `GET …/site-score?action=psi&url=<site>` (performance/SEO 0–100, slow).
3. Pick the **lowest-scoring** business with `score ≤ 6` that isn't already on
   the board (`place_id`). Never pitch a site scoring 7+ — it's already decent
   and unlikely to convert.
4. Insert it as a `lead` (owner null, `place_id`, `site_score`, `score_notes`
   set) and log a `system` event like `Prospected: Dentists in Plovdiv (3/10)`.
5. If nothing qualifies, log that and move on — never force a bad lead.

**Also applies at BUILD time:** if a `lead` has no `site_score`, score it
before building. If it scores **≥ 7**, don't redesign it — set
`status='passed'` with a note like `Site already decent (8/10) — unlikely to
convert` and log it. A human can revert from the dashboard if they disagree.

---

## Access — two supported methods

**Method A — Supabase MCP (preferred, if this routine has it connected).**
Read and write `pmh_jobs` / `pmh_job_events` directly with `execute_sql`.
DDL is already done; you only ever `select` / `insert` / `update` rows.

**Method B — REST (for Hermes or a routine without the MCP).**
Sign in as the bot user, then use the REST API with the returned token.

- Bot login: `claude-redesign@pm-helper.app`, password in the env var
  `SUPABASE_BOT_PASSWORD` (never hardcode it).
- Get a token:
  ```bash
  curl -s "https://wtzrxscdlqdgdiefsmru.supabase.co/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"claude-redesign@pm-helper.app\",\"password\":\"$SUPABASE_BOT_PASSWORD\"}"
  ```
- Then read/write, e.g. list leads:
  ```bash
  curl -s "https://wtzrxscdlqdgdiefsmru.supabase.co/rest/v1/pmh_jobs?status=eq.lead&select=*" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN"
  ```
- Update a job:
  ```bash
  curl -s -X PATCH "https://wtzrxscdlqdgdiefsmru.supabase.co/rest/v1/pmh_jobs?id=eq.$JOB_ID" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"redesigning","redesign_url":"https://pm-brief.com/redesigns/<slug>/"}'
  ```

---

## Hosting the redesign

1. Build a **self-contained** `index.html` (inline CSS/JS; images inlined as
   `data:` URIs or dropped in the same folder — no build step).
2. Commit it to the pm-brief repo at:
   ```
   redesigns/<company-slug>/index.html
   ```
   `<company-slug>` = lowercase company, spaces → `-` (e.g. `sunrise-bakery`).
3. Push to `main`. It goes live at:
   ```
   https://pm-brief.com/redesigns/<company-slug>/
   ```
4. Write that URL into `pmh_jobs.redesign_url` for the company.

See `redesigns/README.md` for the folder rules.

## Assets & fallbacks

- **Photos — order of preference:** (1) images scraped from the company's
  **own website** (cleanest rights-wise — it's their content, used to pitch
  them); (2) their Google Places photo via the `places` function
  (`?action=photo&name=<photo_name>`); (3) **Higgsfield** (`generate_image`)
  for generic hero/atmosphere art only — never to fake photos of their actual
  business.
- **Emails:** Google Places does **not** return emails. While building, fetch
  the company's website and look for a contact email (mailto links, contact
  page, imprint). If found, write it into `pmh_jobs.email` — the human's Send
  button prefills from it. If not found, log it and hand off to **Hermes**
  (the VM agent), which scrapes harder and writes back the same way.

## Email sending — the `send-pitch` function

> **⛔ Not for the routine.** `send-pitch` exists for the dashboard's
> ✉️ Review & Send button — a human decision. The routine must never call it;
> its job ends at `status = 'review'`.

A `send-pitch` Edge Function is deployed and handles sending + logging:

```
POST https://wtzrxscdlqdgdiefsmru.supabase.co/functions/v1/send-pitch
  Authorization: Bearer <user or bot JWT>,  apikey: <anon key>
  { "job_id": "<uuid>", "to": "hello@company.com",
    "subject": "…", "html": "…", "mark_sent": true }
```

On success it sends via Resend, logs an `email` event, and flips the job to
`sent`. **It is safe to call even before it's configured** — with no Resend key
it just returns `{ ok:false, error:"not_configured" }` and sends nothing; the
dashboard then falls back to "Open in mail app" + "Mark as sent".

- Turn it on by setting `RESEND_API_KEY` and `RESEND_FROM` secrets on the
  function — see `docs/EMAIL-SETUP.md`.
- Cold B2B email in the EU/BG needs a clear sender identity and an opt-out line —
  the dashboard's default template includes both; keep them.

---

## Guardrails

- **Only** touch `pmh_jobs` and `pmh_job_events`. The same Supabase project holds
  unrelated game tables — never read or modify anything else.
- **Dedupe:** before adding a company, check `place_id` (or company+address)
  isn't already on the board.
- **Don't overwrite** `owner`, or a `status` further down the pipeline than your
  own step (never move `finished` back to `redesigning`).
- **Idempotent:** if `redesign_url` is already set for a lead, assume it's done —
  skip rather than rebuild.
- Log every meaningful action to `pmh_job_events` with `author = 'claude-redesign'`.

---

## Routine prompt (paste this into the routine)

```
You are the daily Redesign Routine for pm-brief. Follow docs/REDESIGN-ROUTINE.md
in the ear2earGrin/pm-helper repo exactly. Use the Supabase MCP, project
wtzrxscdlqdgdiefsmru, and touch ONLY pmh_jobs / pmh_job_events.

Each run:
1. PROSPECT: add 1 new qualifying lead per the "Daily prospecting" section:
   rotate categories in the CURRENT TARGET CITY named there (do not use the
   "planned expansion" cities), score all candidates with site-score, pick the
   lowest score ≤ 6, dedupe by place_id, store site_score/score_notes.
2. BUILD: for up to 2 jobs with status='lead' and redesign_url null
   (score first if unscored; if ≥ 7, set status='passed' with a note instead):
   a. Set status='redesigning', log a 'status' event (author 'claude-redesign').
   b. Build a modern, self-contained redesign using the company's real info.
      Photos: prefer images from their own website; else their Places photo;
      Higgsfield only for generic hero art.
   c. Commit to redesigns/<company-slug>/index.html on main and push.
   d. Set redesign_url = https://pm-brief.com/redesigns/<company-slug>/.
   e. Try to find their contact email on their website; if found, set
      pmh_jobs.email.
   f. Set status='review' and log a 'redesign' event describing what you did.
3. NEVER send email, never call send-pitch, never set status='sent' — a human
   reviews on the dashboard and clicks Send.
4. If email or photos can't be found, log it and defer to Hermes.
If something is broken (Places rejects, push fails), log what you can to
pmh_job_events and stop gracefully — don't improvise around guardrails:
only pmh_jobs / pmh_job_events, dedupe by place_id, be idempotent, never
overwrite owner or a later status.
```
