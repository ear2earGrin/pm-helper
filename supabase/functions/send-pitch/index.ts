// ============================================================
//  Supabase Edge Function: `send-pitch`
//  Sends an outreach email via Resend and logs it to the board.
//
//  SAFE BY DEFAULT: if RESEND_API_KEY is not set, it does nothing but
//  return { ok:false, error:"not_configured" } — it never sends and never
//  throws. Wire it up by setting these function secrets:
//      RESEND_API_KEY = re_...          (from resend.com)
//      RESEND_FROM    = "Name <hello@yourdomain.com>"   (a verified domain)
//
//  Request (POST JSON), Authorization: Bearer <user or bot JWT>:
//    { job_id?, to, subject, html?, text?, from?, mark_sent? }
//    ?action=status  → { configured, has_key, has_from }  (no send)
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Only a signed-in partner or the redesign bot may call this.
  let author = "system";
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user } } = await supa.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
    author = (user.user_metadata?.username as string) || (user.email ?? "").split("@")[0] || "system";
  } catch (_) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  let body: Record<string, any> = {};
  if (req.method === "POST") { try { body = await req.json(); } catch (_) { /* ignore */ } }
  const action = (url.searchParams.get("action") ?? body.action ?? "send") as string;

  const configured = !!RESEND_API_KEY && !!(body.from || RESEND_FROM);
  if (action === "status") {
    return json({ configured, has_key: !!RESEND_API_KEY, has_from: !!RESEND_FROM });
  }

  // Not wired up yet → do nothing, safely.
  if (!RESEND_API_KEY) {
    return json({
      ok: false,
      error: "not_configured",
      message: "Set RESEND_API_KEY and RESEND_FROM on the send-pitch function to enable sending.",
    });
  }

  const to = body.to as string | undefined;
  const subject = body.subject as string | undefined;
  const html = body.html as string | undefined;
  const text = body.text as string | undefined;
  const from = (body.from as string) || RESEND_FROM;
  if (!to || !subject || (!html && !text)) {
    return json({ ok: false, error: "missing_fields", message: "Require to, subject, and html or text." }, 400);
  }
  if (!from) return json({ ok: false, error: "no_from", message: "Set RESEND_FROM or pass 'from'." }, 400);

  // Send via Resend
  const rr = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html: html || undefined, text: text || undefined }),
  });
  const rd = await rr.json().catch(() => ({}));
  if (!rr.ok) return json({ ok: false, error: "resend_error", detail: rd }, 502);

  // Log it to the board (service role bypasses RLS for this trusted server code)
  const jobId = body.job_id as string | undefined;
  if (jobId) {
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await admin.from("pmh_job_events").insert({
        job_id: jobId, author, kind: "email", body: `Sent pitch to ${to} — “${subject}”`,
      });
      if (body.mark_sent !== false) {
        await admin.from("pmh_jobs").update({ status: "sent", email: to }).eq("id", jobId);
      }
    } catch (_) { /* email already sent; logging is best-effort */ }
  }

  return json({ ok: true, id: rd.id ?? null });
});
