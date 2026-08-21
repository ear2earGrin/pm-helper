// ============================================================
//  Supabase Edge Function: `funding`
//  CORS proxy for Kraken's PUBLIC historical funding rates.
//
//  The browser can't call futures.kraken.com directly (no CORS
//  headers), so the trade log calls this instead. No API key is
//  involved — the upstream endpoint is public market data; this
//  function only forwards it and trims the payload to the window
//  the caller asked for.
//
//  GET ?symbol=PF_XBTUSD[&since=<ISO date|ms epoch>]
//    → { symbol, rates: [{ timestamp, fundingRate }], count, truncated }
//
//  fundingRate is USD per contract per hour (PF_ contracts are one
//  unit of the base coin). Positive => longs pay shorts.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const SYMBOL_RE = /^[A-Z0-9_]{3,24}$/;
const MAX_ROWS = 20000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return json({ error: "bad_symbol" }, 400);

  const sinceRaw = url.searchParams.get("since");
  let since = 0;
  if (sinceRaw) {
    const asNum = Number(sinceRaw);
    since = Number.isFinite(asNum) && asNum > 0 ? asNum : Date.parse(sinceRaw);
    if (!Number.isFinite(since)) since = 0;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(
      `https://futures.kraken.com/derivatives/api/v4/historicalfundingrates?symbol=${encodeURIComponent(symbol)}`,
      { signal: ctrl.signal, headers: { "User-Agent": "pm-brief-trades/1.0" } },
    );
    clearTimeout(timer);

    const text = await res.text();
    if (!res.ok) {
      return json({ error: "kraken_error", status: res.status, detail: text.slice(0, 300) }, 502);
    }
    let data: { rates?: Array<{ timestamp?: string; fundingRate?: number | string }> };
    try {
      data = JSON.parse(text);
    } catch {
      return json({ error: "bad_upstream_json", detail: text.slice(0, 200) }, 502);
    }

    const all = Array.isArray(data.rates) ? data.rates : [];
    const rates: Array<{ timestamp: string; fundingRate: number }> = [];
    for (const r of all) {
      const ts = Date.parse(String(r?.timestamp ?? ""));
      const rate = Number(r?.fundingRate);
      if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
      if (since && ts < since) continue;
      rates.push({ timestamp: new Date(ts).toISOString(), fundingRate: rate });
    }
    const truncated = rates.length > MAX_ROWS;

    return json({
      symbol,
      count: Math.min(rates.length, MAX_ROWS),
      truncated,
      // newest entries are the ones that matter if we ever have to cut
      rates: truncated ? rates.slice(-MAX_ROWS) : rates,
    });
  } catch (e) {
    return json({ error: "fetch_failed", detail: String((e as Error)?.message || e) }, 502);
  }
});
