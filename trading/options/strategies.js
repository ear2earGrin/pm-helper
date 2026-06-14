// Named option-strategy presets. Each build(spot) returns a fresh set of legs with
// sensible default strikes/premiums derived from the spot price; the UI then lets the
// user edit every leg. Premiums are illustrative defaults, not a pricing model.

const r = (x) => Math.round(x * 100) / 100;

export const DEFAULT_SPOT = 100;

export const STRATEGIES = [
  {
    id: "long-call",
    name: "Long Call",
    blurb: "Buy a call. Bullish; loss capped at the premium, upside unlimited.",
    build: (s) => [{ type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 }],
  },
  {
    id: "long-put",
    name: "Long Put",
    blurb: "Buy a put. Bearish; loss capped at the premium, profit grows as price falls.",
    build: (s) => [{ type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 }],
  },
  {
    id: "short-call",
    name: "Short Call",
    blurb: "Sell a call. Collect premium; profit capped, loss unlimited if price rises.",
    build: (s) => [{ type: "call", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 }],
  },
  {
    id: "short-put",
    name: "Short Put",
    blurb: "Sell a put. Collect premium; profit capped, loss grows as price falls.",
    build: (s) => [{ type: "put", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 }],
  },
  {
    id: "long-straddle",
    name: "Long Straddle",
    blurb: "Buy a call and a put at the same strike. Profits from a large move either way.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
    ],
  },
  {
    id: "short-straddle",
    name: "Short Straddle",
    blurb: "Sell a call and a put at the same strike. Profits if price stays put; big tails risk.",
    build: (s) => [
      { type: "call", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "put", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 },
    ],
  },
  {
    id: "long-strangle",
    name: "Long Strangle",
    blurb: "Buy an OTM call and an OTM put. Cheaper than a straddle; needs a bigger move.",
    build: (s) => [
      { type: "put", side: "long", strike: r(s * 0.9), premium: r(s * 0.03), qty: 1 },
      { type: "call", side: "long", strike: r(s * 1.1), premium: r(s * 0.03), qty: 1 },
    ],
  },
  {
    id: "strip",
    name: "Strip",
    blurb: "Long 1 call + 2 puts at the same strike. A straddle tilted bearish.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 2 },
    ],
  },
  {
    id: "strap",
    name: "Strap",
    blurb: "Long 2 calls + 1 put at the same strike. A straddle tilted bullish.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 2 },
      { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
    ],
  },
  {
    id: "bull-call-spread",
    name: "Bull Call Spread",
    blurb: "Buy a call, sell a higher-strike call. Capped profit, capped loss, net debit.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "call", side: "short", strike: r(s * 1.1), premium: r(s * 0.02), qty: 1 },
    ],
  },
  {
    id: "bear-put-spread",
    name: "Bear Put Spread",
    blurb: "Buy a put, sell a lower-strike put. Capped profit, capped loss, net debit.",
    build: (s) => [
      { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "put", side: "short", strike: r(s * 0.9), premium: r(s * 0.02), qty: 1 },
    ],
  },
  {
    id: "long-butterfly",
    name: "Long Call Butterfly",
    blurb: "Long 1 low + 1 high call, short 2 middle calls. Profits if price pins the middle.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s * 0.9), premium: r(s * 0.12), qty: 1 },
      { type: "call", side: "short", strike: r(s), premium: r(s * 0.05), qty: 2 },
      { type: "call", side: "long", strike: r(s * 1.1), premium: r(s * 0.015), qty: 1 },
    ],
  },
  {
    id: "iron-condor",
    name: "Iron Condor",
    blurb: "Sell a put spread and a call spread. Net credit; profits in a quiet range.",
    build: (s) => [
      { type: "put", side: "long", strike: r(s * 0.8), premium: r(s * 0.01), qty: 1 },
      { type: "put", side: "short", strike: r(s * 0.9), premium: r(s * 0.025), qty: 1 },
      { type: "call", side: "short", strike: r(s * 1.1), premium: r(s * 0.025), qty: 1 },
      { type: "call", side: "long", strike: r(s * 1.2), premium: r(s * 0.01), qty: 1 },
    ],
  },
];

export function strategyById(id) {
  return STRATEGIES.find((s) => s.id === id) || null;
}
