// Pure option-payoff math. Everything is profit/loss at expiration, per 1 unit of the
// underlying (multiply by contract size in the UI if you want dollars-per-contract).
//
// A leg: { type: "call" | "put", side: "long" | "short", strike, premium, qty }
//   - long  pays the premium up front and collects intrinsic value at expiry
//   - short collects the premium up front and pays out intrinsic value at expiry

export function legIntrinsic(type, strike, spot) {
  return type === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

export function legPayoff(leg, spot) {
  const qty = leg.qty ?? 1;
  const dir = leg.side === "short" ? -1 : 1;
  return dir * qty * (legIntrinsic(leg.type, leg.strike, spot) - leg.premium);
}

export function payoffAt(legs, spot) {
  let sum = 0;
  for (const leg of legs) sum += legPayoff(leg, spot);
  return sum;
}

// Positive = net debit (you pay to open). Negative = net credit (you receive).
export function netCost(legs) {
  let cost = 0;
  for (const leg of legs) {
    const qty = leg.qty ?? 1;
    cost += (leg.side === "short" ? -1 : 1) * qty * leg.premium;
  }
  return cost;
}

export function payoffCurve(legs, smin, smax, steps = 240) {
  const pts = [];
  const span = smax - smin || 1;
  for (let i = 0; i <= steps; i++) {
    const s = smin + (span * i) / steps;
    pts.push({ s, pnl: payoffAt(legs, s) });
  }
  return pts;
}

// dPnL/dS far above every strike (right) and far below every strike (left).
// Above all strikes only calls have slope; below all strikes only puts do.
export function tailSlopes(legs) {
  let right = 0;
  let left = 0;
  for (const leg of legs) {
    const qty = leg.qty ?? 1;
    const dir = leg.side === "short" ? -1 : 1;
    if (leg.type === "call") right += dir * qty;
    else left += -dir * qty;
  }
  return { right, left };
}

// Zero crossings on [smin, smax], linearly interpolated. The payoff is piecewise
// linear, so a fine scan finds every breakeven exactly enough for display.
export function breakevens(legs, smin, smax, steps = 2000) {
  const span = smax - smin || 1;
  const out = [];
  let prevS = smin;
  let prevP = payoffAt(legs, smin);
  for (let i = 1; i <= steps; i++) {
    const s = smin + (span * i) / steps;
    const p = payoffAt(legs, s);
    if ((prevP < 0 && p >= 0) || (prevP > 0 && p <= 0)) {
      out.push(p === prevP ? s : prevS + (0 - prevP) * (s - prevS) / (p - prevP));
    }
    prevS = s;
    prevP = p;
  }
  return out.filter((v, i) => i === 0 || Math.abs(v - out[i - 1]) > span * 1e-4);
}

// Piecewise-linear payoff: finite extrema sit at a kink (a strike) or at S=0;
// the tails decide whether profit/loss is unbounded.
export function analyze(legs, opts = {}) {
  const strikes = legs.map((l) => l.strike).filter((x) => Number.isFinite(x));
  const refHigh = Math.max(opts.spot || 0, ...strikes, 0);
  const smax = (refHigh || opts.spot || 100) * 3 + 10;

  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (const s of [0, ...strikes]) {
    const p = payoffAt(legs, s);
    if (p > maxProfit) maxProfit = p;
    if (p < maxLoss) maxLoss = p;
  }

  const { right } = tailSlopes(legs);
  if (right > 0) maxProfit = Infinity; // long net calls -> unlimited upside
  if (right < 0) maxLoss = -Infinity; // short net calls -> unlimited loss upside

  return {
    netCost: netCost(legs),
    maxProfit,
    maxLoss,
    breakevens: breakevens(legs, 0, smax),
  };
}
