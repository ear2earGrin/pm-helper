// ============================================================
//  Supabase Edge Function: `prices`
//  Live spot prices for the trade log's open positions.
//
//  Server-side so it never depends on an exchange sending CORS
//  headers, and so the rate limit is ours (one cached call for
//  every coin) rather than per-visitor.
//
//  GET ?symbols=BTC,SUI,ETH[&venue=kraken]
//    → { at, venue, prices: { BTC: 76825.1, ... }, missing, sources }
//
//  The price must match the venue the position is on: a Kraken perp
//  is marked against Kraken's OWN mark price, not Binance spot, and
//  the two differ by the perp basis (small, but it is the difference
//  between our unrealized PnL and the exchange's). So venue=kraken
//  reads Kraken's futures tickers; everything else uses Binance spot,
//  with the other source as fallback for coins one of them lacks.
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

const SYMBOL_RE = /^[A-Z0-9]{2,15}$/;
const MAX_SYMBOLS = 40;
const TTL_MS = 15_000;

// Warm isolates reuse this; a cold start just refetches.
let cache: { at: number; map: Map<string, number> } | null = null;

async function binanceAll(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const res = await fetch("https://api.binance.com/api/v3/ticker/price", {
    signal: ctrl.signal,
    headers: { "User-Agent": "pm-brief-trades/1.0" },
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`binance HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ symbol?: string; price?: string }>;
  const map = new Map<string, number>();
  for (const r of rows) {
    const p = Number(r?.price);
    if (r?.symbol && Number.isFinite(p)) map.set(r.symbol, p);
  }
  cache = { at: Date.now(), map };
  return map;
}

// Kraken perp mark prices — the number Kraken itself marks positions at.
let krakenCache: { at: number; map: Map<string, number> } | null = null;
async function krakenMarks(): Promise<Map<string, number>> {
  if (krakenCache && Date.now() - krakenCache.at < TTL_MS) return krakenCache.map;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const res = await fetch("https://futures.kraken.com/derivatives/api/v3/tickers", {
    signal: ctrl.signal,
    headers: { "User-Agent": "pm-brief-trades/1.0" },
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`kraken HTTP ${res.status}`);
  const j = await res.json() as { tickers?: Array<{ symbol?: string; markPrice?: number; last?: number }> };
  const map = new Map<string, number>();
  for (const t of j.tickers || []) {
    const p = Number(t?.markPrice ?? t?.last);
    if (t?.symbol && Number.isFinite(p)) map.set(t.symbol, p);
  }
  krakenCache = { at: Date.now(), map };
  return map;
}
function krakenPerp(sym: string) {
  return `PF_${sym === "BTC" ? "XBT" : sym}USD`;
}

// Kraken spot uses its own pair names; XBT for BTC, and it accepts SYMUSD.
function krakenPair(sym: string) {
  const base = sym === "BTC" ? "XBT" : sym;
  return `${base}USD`;
}
async function krakenPrice(sym: string): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(krakenPair(sym))}`,
      { signal: ctrl.signal, headers: { "User-Agent": "pm-brief-trades/1.0" } },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    const first = j?.result && Object.values(j.result)[0] as { c?: string[] } | undefined;
    const p = Number(first?.c?.[0]);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SYMBOL_RE.test(s))
    .slice(0, MAX_SYMBOLS);
  if (!symbols.length) return json({ error: "no_symbols" }, 400);

  const venue = (url.searchParams.get("venue") || "").toLowerCase();
  const prices: Record<string, number> = {};
  const sources: string[] = [];
  let missing: string[] = [];

  if (venue === "kraken") {
    try {
      const marks = await krakenMarks();
      sources.push("kraken-mark");
      for (const s of symbols) {
        const hit = marks.get(krakenPerp(s));
        if (hit !== undefined) prices[s] = hit;
        else missing.push(s);
      }
    } catch (_) {
      missing = [...symbols];
    }
    // anything Kraken does not list a perp for falls back to Binance spot
    if (missing.length) {
      try {
        const all = await binanceAll();
        const still: string[] = [];
        for (const s of missing) {
          const hit = all.get(`${s}USDT`) ?? all.get(`${s}USD`) ?? all.get(`${s}FDUSD`);
          if (hit !== undefined) prices[s] = hit;
          else still.push(s);
        }
        if (still.length < missing.length) sources.push("binance");
        missing = still;
      } catch (_) { /* keep missing as-is */ }
    }
    return json({ at: new Date().toISOString(), venue, prices, missing, sources });
  }

  try {
    const all = await binanceAll();
    sources.push("binance");
    for (const s of symbols) {
      const hit = all.get(`${s}USDT`) ?? all.get(`${s}USD`) ?? all.get(`${s}FDUSD`);
      if (hit !== undefined) prices[s] = hit;
      else missing.push(s);
    }
  } catch (_) {
    missing = [...symbols];
  }

  if (missing.length) {
    const found = await Promise.all(missing.map(async (s) => [s, await krakenPrice(s)] as const));
    const stillMissing: string[] = [];
    for (const [s, p] of found) {
      if (p !== null) prices[s] = p;
      else stillMissing.push(s);
    }
    if (found.some(([, p]) => p !== null)) sources.push("kraken");
    missing = stillMissing;
  }

  return json({ at: new Date().toISOString(), venue: venue || "spot", prices, missing, sources });
});
