// ============================================================
//  Supabase Edge Function: `site-score`
//  Rates websites 1–10 for redesign-pitch potential (1 = terrible
//  site = great lead; 8+ = decent site = unlikely to pay).
//
//  Heuristics checked per site (server-side fetch, 8s timeout):
//    no site / social-only / broken → 1–2
//    no HTTPS, no mobile viewport, missing title/meta description,
//    outdated HTML (font/frames/flash), stale copyright year,
//    ancient jQuery, near-empty page → subtractions from 10
//
//  Endpoints (Authorization: Bearer <user or bot JWT>):
//    POST { urls: string[] }            → { results: [{url,score,label,reasons}] }  (max 25)
//    GET  ?action=psi&url=<site>        → mobile Lighthouse scores via Google
//         PageSpeed Insights (needs GOOGLE_MAPS_KEY secret; slow, ~10-40s)
//
//  Repo copy is sanitized: the deployed version may inline a fallback key.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GOOGLE_KEY = Deno.env.get("GOOGLE_MAPS_KEY") ?? "";

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

const SOCIAL_RE = /facebook\.com|instagram\.com|business\.site|linktr\.ee|\bfb\.com|wixsite\.com\/|tiktok\.com|goo\.gl\/maps/i;

async function scoreOne(raw: string): Promise<Record<string, unknown>> {
  if (!raw || !raw.trim()) {
    return { url: raw, score: 1, label: "No website", reasons: ["No website at all — prime candidate"] };
  }
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  if (SOCIAL_RE.test(url)) {
    return { url: raw, score: 2, label: "Social only", reasons: ["Only a social/profile page, no real website"] };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteScore/1.0; +https://pm-brief.com)" },
    });
    clearTimeout(timer);
    if (!res.ok) return { url: raw, score: 1, label: "Broken", reasons: [`Site returns HTTP ${res.status}`] };

    const finalUrl = res.url || url;
    const html = (await res.text()).slice(0, 300_000);
    const lower = html.toLowerCase();
    let score = 10;
    const reasons: string[] = [];

    if (finalUrl.startsWith("http://")) { score -= 2; reasons.push("No HTTPS"); }
    if (!lower.includes("viewport")) { score -= 3; reasons.push("Not mobile-friendly (no viewport meta)"); }
    const titleM = lower.match(/<title[^>]*>([^<]*)</);
    if (!titleM || titleM[1].trim().length < 4) { score -= 1; reasons.push("Missing/empty <title> (SEO)"); }
    if (!lower.includes('name="description"') && !lower.includes("name='description'")) {
      score -= 1; reasons.push("No meta description (SEO)");
    }
    if (/(<font\b|<marquee|<frameset|bgcolor=|\.swf\b)/.test(lower)) {
      score -= 2; reasons.push("Outdated HTML (font tags / frames / flash)");
    }
    const yearM = lower.match(/(?:©|&copy;|copyright)\D{0,12}(20\d\d)/);
    const staleBefore = new Date().getFullYear() - 2;
    if (yearM && parseInt(yearM[1], 10) <= staleBefore) {
      score -= 1; reasons.push(`Stale copyright year (${yearM[1]})`);
    }
    if (/jquery[.-]1\.\d/.test(lower)) { score -= 1; reasons.push("Ancient jQuery version"); }
    if (!lower.includes("og:") && !lower.includes('rel="icon"') && !lower.includes("favicon")) {
      score -= 1; reasons.push("No favicon / social meta polish");
    }
    if (html.length < 3000) { score -= 1; reasons.push("Near-empty page"); }

    score = Math.max(1, Math.min(10, score));
    const label = score <= 3 ? "Weak" : score <= 6 ? "Dated" : "Decent";
    return { url: raw, score, label, reasons: reasons.length ? reasons : ["Looks reasonably modern"] };
  } catch (_) {
    return { url: raw, score: 1, label: "Unreachable", reasons: ["Could not load the site (timeout/SSL/DNS)"] };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Signed-in partners + the redesign bot only.
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user } } = await supa.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
  } catch (_) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  let body: Record<string, any> = {};
  if (req.method === "POST") { try { body = await req.json(); } catch (_) { /* ignore */ } }
  const action = (url.searchParams.get("action") ?? body.action ?? "score") as string;

  // action=psi : mobile Lighthouse via Google PageSpeed Insights (slow!)
  if (action === "psi") {
    const target = (url.searchParams.get("url") ?? body.url) as string | undefined;
    if (!target) return json({ error: "missing url" }, 400);
    if (!GOOGLE_KEY) return json({ error: "not_configured", message: "GOOGLE_MAPS_KEY missing" });
    const u = /^https?:\/\//i.test(target) ? target : "https://" + target;
    const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(u)}&strategy=mobile&category=performance&category=seo&category=best-practices&key=${GOOGLE_KEY}`;
    const r = await fetch(psiUrl);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: "psi_error", detail: d?.error?.message ?? null }, 502);
    const cats = d?.lighthouseResult?.categories ?? {};
    const pct = (c: any) => (c && typeof c.score === "number") ? Math.round(c.score * 100) : null;
    return json({
      performance: pct(cats.performance),
      seo: pct(cats.seo),
      best_practices: pct(cats["best-practices"]),
    });
  }

  // default: batch heuristic scoring
  const urls = Array.isArray(body.urls) ? body.urls.slice(0, 25) : null;
  if (!urls || !urls.length) return json({ error: "missing urls[]" }, 400);
  const results = await Promise.all(urls.map((u: string) => scoreOne(String(u ?? ""))));
  return json({ results });
});
