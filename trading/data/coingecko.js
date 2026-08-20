// Market data for the watchlist.
//
// The rest of the desk reads Binance directly, but Binance publishes no
// circulating supply and therefore no market capitalisation. CoinGecko's public
// endpoints return price, 24h change, 24h volume and market cap in a single
// call, send permissive CORS headers and need no key — so the watchlist reads
// from there rather than stitching two sources together.
//
// The free tier is strict (a handful of calls per minute, counted per IP), and
// a burst of typing plus an add used to trip it immediately. Three things keep
// us under it:
//
//   1. Every request goes through a queue that spaces calls MIN_GAP_MS apart,
//      so a fast sequence of actions becomes a paced sequence of calls.
//   2. Market rows are cached for CACHE_TTL_MS, in memory and in localStorage.
//      Adding a coin reuses cached rows and only asks for the ids it is missing,
//      and a reload inside the TTL costs nothing at all.
//   3. Searches are cached per query, so re-typing or backspacing is free.
//
// When the limit is hit anyway, the error carries retryAfterMs so the view can
// count down and retry by itself instead of stranding the user.

const BASE = "https://api.coingecko.com/api/v3";
const MIN_GAP_MS = 2500;
const CACHE_TTL_MS = 90_000;
const CACHE_KEY = "yf-trading-watchlist-cache";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimitError extends Error {
  /** retryAfterMs is null when the server did not tell us — the caller backs off. */
  constructor(retryAfterMs) {
    super("CoinGecko rate limit reached.");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ── Request pacing ──────────────────────────────────────────────────────
// One shared queue: callers get their own promise, but the calls themselves
// run one at a time with a gap between them.
let queue = Promise.resolve();
let lastCallAt = 0;

function schedule(fn) {
  const result = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return fn();
  });
  // Keep the chain alive when a call rejects, otherwise every later call fails.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function getJson(url) {
  return schedule(async () => {
    let res;
    try {
      res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
    } catch (e) {
      throw new Error(`Could not reach CoinGecko. ${e.message}`);
    }
    if (res.status === 429) {
      // Retry-After is usually unreadable here: on a cross-origin response the
      // browser hides any header the server does not name in
      // Access-Control-Expose-Headers, and CoinGecko does not name this one. We
      // read it in case that changes, and fall back to a caller-chosen delay.
      const header = Number(res.headers.get("retry-after"));
      throw new RateLimitError(Number.isFinite(header) && header > 0 ? header * 1000 : null);
    }
    if (!res.ok) throw new Error(`CoinGecko returned HTTP ${res.status}.`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("CoinGecko returned a response that was not JSON.");
    }
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Market cache ────────────────────────────────────────────────────────
/** id -> { row, at }. Seeded from localStorage so a reload starts warm. */
const marketCache = new Map();

function loadCache() {
  let raw;
  try {
    raw = localStorage.getItem(CACHE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry && entry.row && Number.isFinite(entry.at)) marketCache.set(id, entry);
    }
  } catch {
    /* corrupt cache is not worth reporting — it just refetches */
  }
}

function persistCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(marketCache)));
  } catch {
    /* quota or private mode — the in-memory cache still works */
  }
}

loadCache();

function toRow(r) {
  return {
    id: r.id,
    name: r.name || r.id,
    symbol: String(r.symbol || "").toUpperCase(),
    price: num(r.current_price),
    change24h: num(r.price_change_percentage_24h),
    volume24h: num(r.total_volume),
    marketCap: num(r.market_cap),
    rank: num(r.market_cap_rank),
  };
}

/** Cached rows for these ids, each tagged with how old it is. */
export function cachedMarkets(ids) {
  const now = Date.now();
  const out = {};
  for (const id of ids || []) {
    const hit = marketCache.get(id);
    if (hit) out[id] = { ...hit.row, ageMs: now - hit.at, stale: now - hit.at > CACHE_TTL_MS };
  }
  return out;
}

/**
 * Live stats keyed by CoinGecko id.
 *
 * Only ids whose cached row has expired are requested, so adding one coin to a
 * warm list costs one small call. Pass force to refetch everything (the REFRESH
 * button). Rows already cached are always included in the result, so a failure
 * degrades to stale numbers rather than blanks.
 */
export async function fetchMarkets(ids, { force = false } = {}) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return {};

  const now = Date.now();
  const missing = force
    ? list
    : list.filter((id) => {
        const hit = marketCache.get(id);
        return !hit || now - hit.at > CACHE_TTL_MS;
      });

  if (missing.length) {
    const url =
      `${BASE}/coins/markets?vs_currency=usd` +
      `&ids=${encodeURIComponent(missing.join(","))}` +
      `&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
    const rows = await getJson(url);
    if (!Array.isArray(rows)) throw new Error("Unexpected market data from CoinGecko.");
    const at = Date.now();
    for (const r of rows) {
      if (r && r.id) marketCache.set(r.id, { row: toRow(r), at });
    }
    persistCache();
  }

  return cachedMarkets(list);
}

// ── Search cache ────────────────────────────────────────────────────────
const searchCache = new Map();

/** Search coins by name or symbol. Repeat queries never hit the network. */
export async function searchCoins(query) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  if (searchCache.has(q)) return searchCache.get(q);

  const data = await getJson(`${BASE}/search?query=${encodeURIComponent(q)}`);
  const coins = Array.isArray(data?.coins) ? data.coins : [];
  const out = coins.slice(0, 8).map((c) => ({
    id: c.id,
    name: c.name,
    symbol: String(c.symbol || "").toUpperCase(),
    rank: num(c.market_cap_rank),
  }));
  searchCache.set(q, out);
  return out;
}
