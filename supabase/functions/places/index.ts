// ============================================================
//  Supabase Edge Function: `places`
//  Server-side proxy for Google Places (New) — Text Search + Photos.
//
//  Why this exists: the Google Maps/Places key is BILLABLE and must never
//  be exposed in the browser or committed to the public site. This function
//  holds the key server-side and is callable only by a signed-in partner.
//
//  ── Reference copy ──────────────────────────────────────────
//  The DEPLOYED function reads its key from Deno.env.get("GOOGLE_MAPS_KEY").
//  To (re)deploy from this file, set the secret first:
//      supabase secrets set GOOGLE_MAPS_KEY=your_key   (or add it in the
//      Supabase dashboard → Project Settings → Edge Functions → Secrets)
//  The live deployment additionally carries an inlined fallback key so it
//  works out of the box; that literal is intentionally NOT in this repo.
//
//  Endpoints (GET query params or POST JSON), Authorization: Bearer <user JWT>:
//    ?q=<text>&region=<CC>&max=<1..20>        → business text search
//    ?action=photo&name=<photoName>&maxwidth  → resolve a photo to an image URL
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Only a signed-in partner (a real Supabase user) may call this — not the
  // public anon key. This protects the Google billing quota from abuse.
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user } } = await supa.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
  } catch (_) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") { try { body = await req.json(); } catch (_) { /* ignore */ } }
  const action = (url.searchParams.get("action") ?? body.action ?? "search") as string;

  // action=photo : resolve a Places photo reference to a usable image URL
  if (action === "photo") {
    const name = (url.searchParams.get("name") ?? body.name) as string | undefined;
    const maxwidth = (url.searchParams.get("maxwidth") ?? body.maxwidth ?? "800") as string;
    if (!name) return json({ error: "missing photo name" }, 400);
    const r = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxwidth}&skipHttpRedirect=true&key=${GOOGLE_KEY}`,
    );
    const d = await r.json();
    return json({ photoUri: d.photoUri ?? null });
  }

  // action=search (default) : text search for a business (paginated, 20/page,
  // up to 60 total per query via next_page_token)
  const q = (url.searchParams.get("q") ?? body.q ?? body.query) as string | undefined;
  if (!q) return json({ error: "missing query 'q'" }, 400);
  const region = (url.searchParams.get("region") ?? body.region) as string | undefined;
  const pageToken = (url.searchParams.get("pageToken") ?? body.pageToken) as string | undefined;
  const maxRaw = parseInt((url.searchParams.get("max") ?? String(body.max ?? "")), 10);
  const maxResultCount = Number.isFinite(maxRaw) ? Math.min(Math.max(maxRaw, 1), 20) : 5;

  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.photos,nextPageToken",
    },
    body: JSON.stringify({
      textQuery: q,
      maxResultCount,
      ...(region ? { regionCode: region } : {}),
      ...(pageToken ? { pageToken } : {}),
    }),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: "places_error", detail: d }, 502);

  const results = (d.places ?? []).map((p: Record<string, any>) => ({
    place_id: p.id,
    company: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? "",
    website_url: p.websiteUri ?? "",
    maps_url: p.googleMapsUri ?? "",
    photo_name: p.photos?.[0]?.name ?? null,
  }));
  return json({ results, next_page_token: d.nextPageToken ?? null });
});
