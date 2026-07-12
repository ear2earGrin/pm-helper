# Email setup — turning on `send-pitch`

The `send-pitch` Edge Function is already deployed but **inert**: with no Resend
key it sends nothing and returns `{ ok:false, error:"not_configured" }`. Follow
these steps once to enable real sending. Nothing here touches the rest of the app.

## 1. Create a Resend account + API key
1. Sign up at <https://resend.com> (free tier is plenty to start).
2. **API Keys → Create API Key** → copy it (starts with `re_…`).

## 2. Verify a sending domain (required for deliverability)
Cold outreach from an unverified domain lands in spam. In Resend:
1. **Domains → Add Domain** → enter a domain you control (e.g. `pm-brief.com`
   or a dedicated `mail.pm-brief.com`).
2. Resend shows a set of **DNS records** — typically:
   - an **MX** record (for the mail subdomain),
   - a **TXT SPF** record (`v=spf1 include:...`),
   - one or more **DKIM** `CNAME`/`TXT` records,
   - (recommended) a **DMARC** `TXT` record like
     `v=DMARC1; p=none; rua=mailto:you@pm-brief.com`.
3. Add those exact records at your DNS provider (for `pm-brief.com` that's
   wherever the domain is managed). Click **Verify** — it can take a few minutes
   to a few hours to propagate.

> The exact records are generated per-domain by Resend — copy them from that
> screen; they can't be pre-written here.

## 3. Set the function secrets
In the Supabase dashboard → **Project Settings → Edge Functions → Secrets**
(project `wtzrxscdlqdgdiefsmru`), add:

| Secret | Value |
|---|---|
| `RESEND_API_KEY` | your `re_…` key |
| `RESEND_FROM` | `Your Name <hello@your-verified-domain>` |

(No redeploy needed — the function reads them at runtime.)

## 4. Confirm it's live
```bash
curl -s "https://wtzrxscdlqdgdiefsmru.supabase.co/functions/v1/send-pitch?action=status" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <a signed-in user token>"
# → {"configured":true,"has_key":true,"has_from":true}
```

Then a real send:
```bash
curl -s -X POST "https://wtzrxscdlqdgdiefsmru.supabase.co/functions/v1/send-pitch" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to":"you@example.com","subject":"Test","html":"<p>Hello from send-pitch</p>"}'
# → {"ok":true,"id":"..."}
```

Once `configured` is true, the redesign routine will send pitches automatically
and mark those jobs `sent` on the dashboard.
