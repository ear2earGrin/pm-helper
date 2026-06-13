// Binance CORS proxy for the /trading section.
//
// Browsers block fetch('https://api.binance.com/...') by CORS. The trading data
// layer (trading/data/binance.js) instead calls same-origin path prefixes
// (/binance-spot, /binance-fut, /binance-dapi) which this Worker rewrites to the
// real Binance hosts and returns with permissive CORS headers. This mirrors the
// Vite dev-proxy the standalone crypto-entry-checker app used; pm-brief has no
// dev server, so the proxy must live at the edge instead.

const ROUTES = {
  // api.binance.com sits behind CloudFront and 403s requests from many datacenter/edge
  // IPs (including Cloudflare's), so proxying through it returns "Request blocked".
  // data-api.binance.vision is Binance's public market-data host: same /api/v3/klines,
  // served to those IPs without the geo/IP block. Spot is all the Scanner/Backtest use.
  '/binance-spot': 'https://data-api.binance.vision',
  '/binance-fut': 'https://fapi.binance.com',
  '/binance-dapi': 'https://dapi.binance.com',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    const url = new URL(request.url);
    const prefix = Object.keys(ROUTES).find(
      (p) => url.pathname === p || url.pathname.startsWith(p + '/'),
    );
    if (!prefix) {
      return new Response('Unknown proxy prefix', { status: 404, headers: CORS });
    }

    const upstreamUrl = ROUTES[prefix] + url.pathname.slice(prefix.length) + url.search;

    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const headers = new Headers(CORS);
    const ct = upstream.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
