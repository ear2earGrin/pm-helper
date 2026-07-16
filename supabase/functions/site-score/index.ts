// ============================================================
//  Supabase Edge Function: `site-score`
//  Rates websites 1–10 for redesign-pitch potential (1 = terrible
//  site = great lead; 8+ = decent site = unlikely to pay).
//
//  When a business has NO website on its Google listing, the scorer
//  tries to FIND one via a DuckDuckGo web search (name + city) before
//  concluding "no website" — because many businesses have a site they
//  just never linked on Google Maps. A found site is scored normally
//  and flagged "found via search (verify)".
//
//  Endpoints (Authorization: Bearer <user or bot JWT>):
//    POST { items: [{website_url?, company?, city?}] }  → ordered results   (max 25)
//    POST { urls: string[] }                            → ordered results (no resolver)
//    GET  ?action=psi&url=<site>                         → mobile Lighthouse via PSI
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

// Social / directory / aggregator hosts that are never "their own website".
const SOCIAL_RE = /facebook\.com|instagram\.com|business\.site|linktr\.ee|\bfb\.com|wixsite\.com\/|tiktok\.com|goo\.gl\/maps/i;
const SKIP_HOST_RE = /facebook\.|instagram\.|linkedin\.|youtube\.|twitter\.|x\.com|tiktok\.|pinterest\.|google\.|goo\.gl|gstatic|maps\.app|yelp\.|tripadvisor\.|foursquare|booking\.|wikipedia\.|apple\.com|play\.google|doctoranytime|vrisko\.gr|xo\.gr|11888\.gr|be24\.gr|yellowpages|europages/i;

// Try to find a business's real website via DuckDuckGo's HTML endpoint (keyless).
async function findWebsite(name: string, city: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(`${name} ${city}`.trim());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteScore/1.0; +https://pm-brief.com)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    const re = /uddg=([^&"']+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      let u: string;
      try { u = decodeURIComponent(m[1]); } catch (_) { continue; }
      if (!/^https?:\/\//i.test(u)) continue;
      if (SKIP_HOST_RE.test(u)) continue;
      return u;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Score a known, non-empty URL 1–10.
async function scoreUrl(raw: string): Promise<Record<string, unknown>> {
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

// Score one item: resolve a hidden website first if none was listed.
async function scoreItem(item: { website_url?: string; company?: string; city?: string }): Promise<Record<string, unknown>> {
  let url = (item.website_url || "").trim();
  let resolved: string | null = null;
  if (!url && item.company) {
    resolved = await findWebsite(item.company, item.city || "");
    if (resolved) url = resolved;
  }
  if (!url) {
    return { url: "", score: 1, label: "No website", reasons: ["No website on Google, and none found via search — prime candidate"], resolved_url: null };
  }
  let base = await scoreUrl(url);
  // A 404/unreachable on a deep link is often just a broken sub-page while the
  // homepage is fine — retry the root domain before declaring the site weak.
  if (base.label === "Broken" || base.label === "Unreachable") {
    try {
      const u = new URL(/^https?:\/\//i.test(url) ? url : "https://" + url);
      if (u.pathname && u.pathname !== "/") {
        const root = await scoreUrl(u.origin);
        if (typeof root.score === "number" && (root.score as number) > (base.score as number)) {
          root.resolved_url = u.origin;
          root.reasons = [`⚠ Listing URL 404’d — scored the homepage (${u.origin}) instead`, ...(root.reasons as string[])];
          base = root;
        }
      }
    } catch (_) { /* keep original */ }
  }
  if (resolved) {
    base.resolved_url = resolved;
    base.reasons = ["⚠ Site found via web search — not on their Google listing (verify)", ...(base.reasons as string[])];
  }
  return base;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

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
    return json({ performance: pct(cats.performance), seo: pct(cats.seo), best_practices: pct(cats["best-practices"]) });
  }

  // Preferred: items[] (enables the hidden-website resolver). Legacy: urls[].
  let items: Array<{ website_url?: string; company?: string; city?: string }> | null = null;
  if (Array.isArray(body.items)) items = body.items.slice(0, 25);
  else if (Array.isArray(body.urls)) items = body.urls.slice(0, 25).map((u: string) => ({ website_url: String(u ?? "") }));
  if (!items || !items.length) return json({ error: "missing items[] or urls[]" }, 400);

  const results = await Promise.all(items.map((it) => scoreItem(it)));
  return json({ results });
});
