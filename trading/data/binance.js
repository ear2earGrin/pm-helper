// pm-brief adaptation: on a static host (GitHub Pages) there is no server to
// rewrite /binance-spot|/binance-fut, so these read a browser-set base:
//   SPOT → window.__BINANCE_PROXY_BASE__ (data-api.binance.vision, CORS-open spot host)
//   FUT  → window.__BINANCE_FUT_BASE__   (futures/derivatives host or worker proxy)
// Both fall back to the /binance-* rewrite prefixes for proxied deployments.
const SPOT = (typeof window !== "undefined" && window.__BINANCE_PROXY_BASE__) || "/binance-spot";
const FUT = (typeof window !== "undefined" && window.__BINANCE_FUT_BASE__) || "/binance-fut";

function tfToBinanceInterval(tf) {
  const map = {
    "5m": "5m", "15m": "15m",
    "1H": "1h", "2H": "2h", "4H": "4h", "8H": "8h", "12H": "12h",
    "1D": "1d", "3D": "3d", "1W": "1w",
  };
  return map[tf] || tf;
}

export function binanceSymbol(asset, quote = "USDT") {
  return `${asset}${quote}`.toUpperCase();
}

async function fetchJson(url) {
  const res = await fetch(url, { method: "GET" });
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) {
    const snippet = text.slice(0, 180).replace(/\s+/g, " ").trim();
    throw new Error(`HTTP ${res.status} for ${url}. CT=${ct}. Body: ${snippet}`);
  }
  if (!ct.includes("application/json")) {
    const snippet = text.slice(0, 180).replace(/\s+/g, " ").trim();
    throw new Error(`Non-JSON response for ${url}. CT=${ct}. Body: ${snippet}`);
  }
  return JSON.parse(text);
}

function toCandles(raw) {
  if (!Array.isArray(raw)) throw new Error("Klines response invalid.");
  return raw
    .map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Math.floor(Number(k[6]) / 1000),
      // field 9 = taker buy base volume (aggressor market buys). Kept so the
      // CVD / volume-delta indicator can read flow without extra requests.
      takerBuyBase: Number(k[9]),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    );
}

export async function fetchKlines({ asset, quote = "USDT", timeframe, limit = 300 }) {
  const symbol = binanceSymbol(asset, quote);
  const interval = tfToBinanceInterval(timeframe);
  const url = `${SPOT}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const raw = await fetchJson(url);
  return toCandles(raw);
}

export async function fetchKlinesRange({ asset, quote = "USDT", timeframe, startTime, endTime = Date.now() }) {
  const symbol = binanceSymbol(asset, quote);
  const interval = tfToBinanceInterval(timeframe);
  const all = [];
  let cursor = startTime;

  // Binance caps klines at 1000 per request; page forward until endTime
  for (let guard = 0; guard < 50; guard++) {
    const url = `${SPOT}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${cursor}&limit=1000`;
    const raw = await fetchJson(url);
    const batch = toCandles(raw);
    if (batch.length === 0) break;

    all.push(...batch);
    const lastCloseMs = (batch[batch.length - 1].closeTime || batch[batch.length - 1].time) * 1000;
    if (batch.length < 1000 || lastCloseMs >= endTime) break;
    cursor = lastCloseMs + 1;
  }

  const seen = new Set();
  return all.filter((c) => {
    if (seen.has(c.time)) return false;
    seen.add(c.time);
    return true;
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Live derivatives positioning context for a single asset's USDT-M perp.
 *
 * Orthogonal to price: funding tells you who's crowded and paying, OI tells you
 * whether a move is new conviction or unwinding, L/S ratio is crowd skew. This is
 * the structural-edge data the analysis flagged for futures traders.
 *
 * NOTE on backtest: funding history is available far back (fundingRate endpoint),
 * but Binance's public OI history (openInterestHist) only covers ~30 days. So OI
 * here is a LIVE-only context signal. Do not pretend you can backtest it from this
 * source — see docs/STRATEGY-SPEC.md.
 */
export async function fetchDerivsContext(asset) {
  const symbol = binanceSymbol(asset, "USDT");
  const out = {
    asset,
    fundingRate: null,
    openInterest: null,
    oiChange24hPct: null,
    longShortRatio: null,
    updatedAt: new Date().toISOString(),
  };

  try {
    const f = await fetchJson(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
    out.fundingRate = num(f?.[0]?.fundingRate);
  } catch { /* best-effort */ }

  try {
    const oi = await fetchJson(`${FUT}/fapi/v1/openInterest?symbol=${symbol}`);
    out.openInterest = num(oi?.openInterest);
  } catch { /* best-effort */ }

  try {
    const hist = await fetchJson(`${FUT}/futures/data/openInterestHist?symbol=${symbol}&period=1d&limit=2`);
    let a = num(hist?.[0]?.sumOpenInterest);
    let b = num(hist?.[1]?.sumOpenInterest);
    if (hist?.[0]?.timestamp && hist?.[1]?.timestamp && Number(hist[0].timestamp) < Number(hist[1].timestamp)) {
      [a, b] = [b, a];
    }
    if (a !== null && b !== null && b > 0) out.oiChange24hPct = ((a - b) / b) * 100;
  } catch { /* best-effort */ }

  try {
    const ls = await fetchJson(`${FUT}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=4h&limit=1`);
    out.longShortRatio = num(ls?.[0]?.longShortRatio);
  } catch { /* best-effort */ }

  return out;
}

/**
 * Historical funding rate for an asset's perp, paginated. 8h intervals (Binance
 * default). Returned as [{ time: unixSecs, fundingRate: number }]. This IS
 * backtestable — use it to validate a funding-based stand-down filter via
 * walk-forward before promoting it to a hard gate.
 */
export async function fetchFundingHistory({ asset, startTime, endTime = Date.now() }) {
  const symbol = binanceSymbol(asset, "USDT");
  const all = [];
  let cursor = startTime;
  for (let guard = 0; guard < 60; guard++) {
    const url = `${FUT}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&limit=1000`;
    const raw = await fetchJson(url);
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const r of raw) {
      const t = Math.floor(Number(r.fundingTime) / 1000);
      const fr = num(r.fundingRate);
      if (Number.isFinite(t) && fr !== null) all.push({ time: t, fundingRate: fr });
    }
    const lastMs = Number(raw[raw.length - 1].fundingTime);
    if (raw.length < 1000 || lastMs >= endTime) break;
    cursor = lastMs + 1;
  }
  return all;
}

export function dropUnclosedCandle(candles) {
  if (candles.length === 0) return candles;
  const now = Math.floor(Date.now() / 1000);
  const last = candles[candles.length - 1];
  if (last.closeTime && last.closeTime > now) return candles.slice(0, -1);
  return candles;
}
