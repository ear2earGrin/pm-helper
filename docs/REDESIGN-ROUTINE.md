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
lead ──▶ redesigning ──▶ sent ──▶ replied ──▶ finished
                                      └─(no fit)─▶ passed
```

- Pick up work at **`status = 'lead'`**.
- Flip to **`redesigning`** while building.
- Flip to **`sent`** once the outreach email goes out (only if email sending is
  configured — see below). If you don't send, stop at `redesigning` and leave a
  note; a human sends it.
- Never set `replied` / `finished` — those are human/inbox signals.

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

- **Design images / hero art needed?** Use the **Higgsfield MCP**
  (`generate_image`) and inline/commit the result.
- **Can't find the company's email, or need real photos of the business?**
  Google Places does **not** return emails. Hand that to **Hermes** (the VM
  agent): it scrapes the site / Maps for the contact email and photos, then
  writes them back the same way (email + photo URL → `pmh_jobs`; photo files →
  `redesigns/<slug>/`).

## Email sending — the `send-pitch` function

A `send-pitch` Edge Function is deployed and handles sending + logging:

```
POST https://wtzrxscdlqdgdiefsmru.supabase.co/functions/v1/send-pitch
  Authorization: Bearer <user or bot JWT>,  apikey: <anon key>
  { "job_id": "<uuid>", "to": "hello@company.com",
    "subject": "…", "html": "…", "mark_sent": true }
```

On success it sends via Resend, logs an `email` event, and flips the job to
`sent`. **It is safe to call even before it's configured** — with no Resend key
it just returns `{ ok:false, error:"not_configured" }` and sends nothing.

- **Check first:** `GET …/send-pitch?action=status` → `{ configured: true|false }`.
  If `configured` is false, **do not** treat the lead as sent — stop at
  `redesigning`, note that a human should send, and move on.
- Turn it on by setting `RESEND_API_KEY` and `RESEND_FROM` secrets on the
  function — see `docs/EMAIL-SETUP.md`.
- Cold B2B email in the EU/BG needs a clear sender identity and an opt-out line —
  keep both in the template.

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
You are the Redesign Routine for pm-brief. Follow docs/REDESIGN-ROUTINE.md in
the ear2earGrin/pm-helper repo exactly.

Each run:
1. Read pmh_jobs where status = 'lead' and redesign_url is null
   (Supabase project wtzrxscdlqdgdiefsmru, via the Supabase MCP).
2. For each lead (cap at 5 per run):
   a. Set status = 'redesigning' and log a 'status' event (author 'claude-redesign').
   b. Look at website_url; build a modern, self-contained redesign index.html.
      Use the Higgsfield MCP for hero/imagery if useful.
   c. Commit it to redesigns/<company-slug>/index.html on main and push.
   d. Set redesign_url = https://pm-brief.com/redesigns/<company-slug>/ and log a
      'redesign' event describing what you changed.
   e. If (and only if) an email sender is configured, send the pitch, set
      status = 'sent', and log an 'email' event. Otherwise leave status at
      'redesigning' and note that a human should send it.
3. If you can't find a company's email or need real photos, note it and defer to
   Hermes.
Obey the guardrails in the doc: only pmh_jobs / pmh_job_events, dedupe, be
idempotent, never overwrite owner or a later status.
```
