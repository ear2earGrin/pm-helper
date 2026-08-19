// Named option-strategy presets. Each build(spot) returns a fresh set of legs with
// sensible default strikes/premiums derived from the spot price; the UI then lets the
// user edit every leg. Premiums are illustrative defaults, not a pricing model.
//   blurb — what the structure is.   when — the market view that calls for it.

const r = (x) => Math.round(x * 100) / 100;

export const DEFAULT_SPOT = 100;

export const STRATEGIES = [
  {
    id: "long-call",
    name: "Long Call",
    blurb: "Buy a call. Bullish; loss capped at the premium, upside unlimited.",
    when: "You're bullish and expect a meaningful rally before expiry, but want your downside capped at the premium paid.",
    build: (s) => [{ type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 }],
  },
  {
    id: "long-put",
    name: "Long Put",
    blurb: "Buy a put. Bearish; loss capped at the premium, profit grows as price falls.",
    when: "You're bearish and expect a drop — or you already hold the underlying and want crash protection (a hedge).",
    build: (s) => [{ type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 }],
  },
  {
    id: "short-call",
    name: "Short Call",
    blurb: "Sell a call. Collect premium; profit capped, loss unlimited if price rises.",
    when: "You're neutral-to-bearish and expect price to stay below the strike. Selling premium for income — safest when you own the underlying (a covered call) rather than naked.",
    build: (s) => [{ type: "call", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 }],
  },
  {
    id: "short-put",
    name: "Short Put",
    blurb: "Sell a put. Collect premium; profit capped, loss grows as price falls.",
    when: "You're neutral-to-bullish and would be happy to buy the underlying at the strike. You pocket the premium while you wait, and get assigned the shares if it falls.",
    build: (s) => [{ type: "put", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 }],
  },
  {
    id: "long-straddle",
    name: "Long Straddle",
    blurb: "Buy a call and a put at the same strike. Profits from a large move either way.",
    when: "You expect a big move but don't know the direction — earnings, a ruling, a token unlock — and think volatility is underpriced. You lose if the price stays flat.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
    ],
  },
  {
    id: "short-straddle",
    name: "Short Straddle",
    blurb: "Sell a call and a put at the same strike. Profits if price stays put; big tails risk.",
    when: "You expect the price to sit still and volatility to fall (e.g. right after an event). You collect premium and accept large, potentially unlimited tail risk.",
    build: (s) => [
      { type: "call", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "put", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 },
    ],
  },
  {
    id: "long-strangle",
    name: "Long Strangle",
    blurb: "Buy an OTM call and an OTM put. Cheaper than a straddle; needs a bigger move.",
    when: "Same 'big move, unknown direction' bet as a straddle, but cheaper — used when you want lower cost and expect an even larger swing to clear the wider strikes.",
    build: (s) => [
      { type: "put", side: "long", strike: r(s * 0.9), premium: r(s * 0.03), qty: 1 },
      { type: "call", side: "long", strike: r(s * 1.1), premium: r(s * 0.03), qty: 1 },
    ],
  },
  {
    id: "strip",
    name: "Strip",
    blurb: "Long 1 call + 2 puts at the same strike. A straddle tilted bearish.",
    when: "You expect a big move and lean bearish — it profits either way but pays out twice as fast on the downside.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 2 },
    ],
  },
  {
    id: "strap",
    name: "Strap",
    blurb: "Long 2 calls + 1 put at the same strike. A straddle tilted bullish.",
    when: "You expect a big move and lean bullish — it profits either way but pays out twice as fast on the upside.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 2 },
      { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
    ],
  },
  {
    id: "bull-call-spread",
    name: "Bull Call Spread",
    blurb: "Buy a call, sell a higher-strike call. Capped profit, capped loss, net debit.",
    when: "You're moderately bullish to a target price, not a runaway rally. Selling the higher call cheapens the trade and caps both cost and profit.",
    build: (s) => [
      { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "call", side: "short", strike: r(s * 1.1), premium: r(s * 0.02), qty: 1 },
    ],
  },
  {
    id: "bear-put-spread",
    name: "Bear Put Spread",
    blurb: "Buy a put, sell a lower-strike put. Capped profit, capped loss, net debit.",
    when: "You're moderately bearish to a target price. Defined risk and reward, and cheaper than a naked put because the short put offsets some cost.",
    build: (s) => [
      { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
      { type: "put", side: "short", strike: r(s * 0.9), premium: r(s * 0.02), qty: 1 },
    ],
  },
  {
    id: "long-butterfly",
    name: "Long Call Butterfly",
    blurb: "Long 1 low + 1 high call, short 2 middle calls. Profits if price pins the middle.",
    when: "You expect the price to pin near a specific level at expiry (low volatility). A cheap, small, defined-risk bet that pays best if it lands on the body strike.",
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
    when: "You expect the price to stay within a range (low volatility). A defined-risk income trade that profits from time decay as long as price stays between the short strikes.",
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
