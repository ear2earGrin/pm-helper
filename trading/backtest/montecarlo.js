/**
 * Monte Carlo analysis for backtest results.
 *
 * Two distinct tools:
 *
 * 1. `bootstrapTradeSequence` — given a real trade list, resamples the trades many
 *    times to estimate the distribution of total returns and max drawdowns. Answers:
 *    "if I keep trading this system, what's the realistic range of equity curves
 *    I should expect?" The single most useful sanity check on a backtest.
 *
 * 2. `permutationEdgeTest` — given a real trade list, randomly inverts each trade's
 *    sign (long becomes short, win becomes loss) many times. If the real expectancy
 *    is in the top 5% of the permuted distribution, there's statistical evidence
 *    you have an edge. If not, the backtest might just be luck.
 *
 * Both are independent of the engine — they take trade arrays as input.
 *
 * Note on RNG: uses a mulberry32 seeded PRNG for reproducibility. Same seed →
 * identical results across runs. Default seed = 1.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
  return sortedAsc[idx];
}

function simulatePath(trades, startEquity) {
  let equity = startEquity;
  let peak = startEquity;
  let maxDDPct = 0;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDDPct) maxDDPct = dd;
  }
  return { finalEquity: equity, returnPct: ((equity - startEquity) / startEquity) * 100, maxDDPct };
}

/**
 * Resample the trade sequence with replacement N times. Returns distribution
 * of total returns and max drawdowns.
 *
 * @param {Array}  trades       Real trades, each with at minimum { pnl: number }
 * @param {object} opts
 * @param {number} [opts.startEquity=100000]
 * @param {number} [opts.runs=2000]
 * @param {number} [opts.seed=1]
 * @returns {{ runs: number, returnsPct: object, maxDDPct: object, samples: Array }}
 */
export function bootstrapTradeSequence(trades, { startEquity = 100000, runs = 2000, seed = 1 } = {}) {
  if (!trades?.length) {
    return { runs: 0, returnsPct: empty(), maxDDPct: empty(), samples: [] };
  }
  const rand = mulberry32(seed);
  const samples = new Array(runs);
  for (let r = 0; r < runs; r++) {
    const shuffled = new Array(trades.length);
    for (let i = 0; i < trades.length; i++) {
      shuffled[i] = trades[Math.floor(rand() * trades.length)];
    }
    samples[r] = simulatePath(shuffled, startEquity);
  }
  const returns = samples.map((s) => s.returnPct).sort((a, b) => a - b);
  const dds = samples.map((s) => s.maxDDPct).sort((a, b) => a - b);
  return {
    runs,
    returnsPct: distribution(returns),
    maxDDPct: distribution(dds),
    samples,
  };
}

function empty() {
  return { mean: 0, median: 0, p05: 0, p25: 0, p75: 0, p95: 0, min: 0, max: 0 };
}

function distribution(sortedAsc) {
  if (sortedAsc.length === 0) return empty();
  const mean = sortedAsc.reduce((s, x) => s + x, 0) / sortedAsc.length;
  return {
    mean,
    median: percentile(sortedAsc, 0.5),
    p05: percentile(sortedAsc, 0.05),
    p25: percentile(sortedAsc, 0.25),
    p75: percentile(sortedAsc, 0.75),
    p95: percentile(sortedAsc, 0.95),
    min: sortedAsc[0],
    max: sortedAsc[sortedAsc.length - 1],
  };
}

/**
 * Permutation test for "is this expectancy real or could a coin-flip have produced it?"
 *
 * Method: for each permutation run, flip the sign of every trade's pnl with prob 0.5.
 * This simulates a system with no edge (random direction) but the SAME stop-distance,
 * sizing, and trade frequency as the real system. If the real expectancy is in the
 * top ~5% of the permuted distribution, that's statistical evidence of edge.
 *
 * Returns p-value, the share of permuted runs whose expectancy >= real expectancy.
 * Lower p-value = more confident the edge is real. p < 0.05 is the conventional cutoff.
 *
 * @param {Array}  trades
 * @param {object} opts
 * @param {number} [opts.runs=2000]
 * @param {number} [opts.seed=1]
 * @returns {{ runs: number, realExpectancy: number, p: number, permutedMean: number, permutedP95: number }}
 */
export function permutationEdgeTest(trades, { runs = 2000, seed = 1 } = {}) {
  if (!trades?.length) return { runs: 0, realExpectancy: 0, p: 1, permutedMean: 0, permutedP95: 0 };

  const realExp = trades.reduce((s, t) => s + t.pnl, 0) / trades.length;
  const rand = mulberry32(seed);
  const perms = new Array(runs);

  for (let r = 0; r < runs; r++) {
    let sum = 0;
    for (const t of trades) {
      const sign = rand() < 0.5 ? -1 : 1;
      sum += sign * t.pnl;
    }
    perms[r] = sum / trades.length;
  }

  perms.sort((a, b) => a - b);
  let geCount = 0;
  for (const v of perms) if (v >= realExp) geCount++;
  const p = geCount / runs;

  const mean = perms.reduce((s, x) => s + x, 0) / perms.length;
  return { runs, realExpectancy: realExp, p, permutedMean: mean, permutedP95: percentile(perms, 0.95) };
}
