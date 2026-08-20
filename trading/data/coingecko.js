// Market data for the watchlist.
//
// The rest of the desk reads Binance directly, but Binance publishes no
// circulating supply and therefore no market capitalisation. CoinGecko's public
// endpoints return price, 24h change, 24h volume and market cap in a single
// call, send permissive CORS headers and need no key — so the watchlist reads
// from there rather than stitching two sources together.
//
// The free tier is rate limited (roughly 5-15 calls/minute), which is why the
// list refreshes on demand rather than on a timer.

const BASE = "https://api.coingecko.com/api/v3";

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  } catch (e) {
    throw new Error(`Could not reach CoinGecko. ${e.message}`);
  }
  if (res.status === 429) {
    throw new Error("CoinGecko rate limit hit. Wait a minute, then refresh.");
  }
  if (!res.ok) {
    throw new Error(`CoinGecko returned HTTP ${res.status}.`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("CoinGecko returned a response that was not JSON.");
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Search coins by name or symbol. Returns [{ id, name, symbol, rank }]. */
export async function searchCoins(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const data = await getJson(`${BASE}/search?query=${encodeURIComponent(q)}`);
  const coins = Array.isArray(data?.coins) ? data.coins : [];
  return coins.slice(0, 8).map((c) => ({
    id: c.id,
    name: c.name,
    symbol: String(c.symbol || "").toUpperCase(),
    rank: num(c.market_cap_rank),
  }));
}

/**
 * Live stats for the saved coins, keyed by CoinGecko id.
 * Missing fields come back as null so the view can render "—" rather than NaN.
 */
export async function fetchMarkets(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return {};
  const url =
    `${BASE}/coins/markets?vs_currency=usd` +
    `&ids=${encodeURIComponent(list.join(","))}` +
    `&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
  const rows = await getJson(url);
  if (!Array.isArray(rows)) throw new Error("Unexpected market data from CoinGecko.");

  const out = {};
  for (const r of rows) {
    if (!r || !r.id) continue;
    out[r.id] = {
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
  return out;
}
