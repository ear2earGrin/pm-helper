import { computeRegime, REGIME_PARAMS } from "../strategy/regime.js";
import { computeSignal, SIGNAL_PARAMS } from "../strategy/signal.js";
import { donchianCloses } from "../indicators/donchian.js";
import { sizePosition } from "../strategy/sizing.js";
import { checkPortfolioAllows, PORTFOLIO_PARAMS } from "../strategy/portfolio.js";
import { buildDailyFundingMap, accrueFunding, dayKey } from "./funding.js";

/**
 * Multi-asset portfolio backtest.
 *
 * Bar alignment is the load-bearing detail. We construct a master timeline of
 * unique daily bar times across all assets, then on each timeline day we:
 *
 *   1. Update trailing stops on any open positions.
 *   2. Check intrabar stop hits and regime-flip exits.
 *   3. Look at new signals across all assets. If multiple fire, we apply portfolio
 *      rules in `strategy/portfolio.js` to decide which (if any) to take.
 *   4. Record equity (cash + unrealized PnL across open positions).
 *
 * IMPORTANT: This is the engine that respects portfolio.js. The single-asset
 * `backtestOne` does NOT. If you need to know what the system would have done
 * with all the assets together, you want THIS function.
 *
 * @param {object} opts
 * @param {Object<string, Array>} opts.dailyByAsset   { BTC: [...], ETH: [...] }
 * @param {Object<string, Array>} opts.weeklyByAsset  same shape
 * @param {number} [opts.startEquity=100000]
 * @param {number} [opts.riskPct=1]
 * @param {number} [opts.feePct=0.08]
 * @param {object} [opts.portfolioParams=PORTFOLIO_PARAMS]
 * @param {object} [opts.signalParams=SIGNAL_PARAMS]
 * @returns {{ trades, equityCurve, finalEquity, startEquity, perAsset }}
 */
function slip(price, side, slippagePct) {
  const s = (slippagePct || 0) / 100;
  return side === "buy" ? price * (1 + s) : price * (1 - s);
}

export function backtestPortfolio({
  dailyByAsset,
  weeklyByAsset,
  startEquity = 100000,
  riskPct = 1,
  feePct = 0.08,
  slippagePct = 0,
  fundingByAsset = null,
  portfolioParams = PORTFOLIO_PARAMS,
  signalParams = SIGNAL_PARAMS,
  regimeParams = REGIME_PARAMS,
  exitOnRegimeFlip = true,
}) {
  const assets = Object.keys(dailyByAsset);
  const fundingMaps = {};
  for (const a of assets) {
    fundingMaps[a] = buildDailyFundingMap(fundingByAsset?.[a] || null);
  }

  // Pre-compute regimes, signals, trail series per asset.
  const perAsset = {};
  for (const asset of assets) {
    const daily = dailyByAsset[asset];
    const weekly = weeklyByAsset[asset];
    if (!daily?.length || !weekly?.length) continue;

    const regime = computeRegime(weekly, regimeParams);
    const dailyRegime = new Array(daily.length).fill("WARMUP");
    for (let i = 0; i < daily.length; i++) {
      const wIdx = findLastClosedWeeklyIdx(weekly, daily[i].time);
      dailyRegime[i] = wIdx >= 0 ? regime.series[wIdx]?.state || "WARMUP" : "WARMUP";
    }

    const closes = daily.map((c) => c.close);
    const trail10 = donchianCloses(closes, signalParams.donchianExit);
    const signalSeries = computeSignal(daily, dailyRegime, signalParams).series;

    perAsset[asset] = {
      daily, dailyRegime, trail10, signalSeries,
      barIdx: new Map(daily.map((c, i) => [c.time, i])),
    };
  }

  // Master timeline: union of all daily bar times, sorted.
  const allTimes = new Set();
  for (const a of Object.keys(perAsset)) {
    for (const c of perAsset[a].daily) allTimes.add(c.time);
  }
  const timeline = [...allTimes].sort((a, b) => a - b);

  let equity = startEquity;
  let openPositions = {};            // asset -> position
  const pendingEntries = {};          // asset -> { action, stop } armed for next bar's open
  const trades = [];
  const recentlyStopped = [];         // [{ asset, time }]
  const equityCurve = [];

  // Per-day, per-asset entries counter
  let entriesToday = 0;
  let lastDay = null;

  for (const t of timeline) {
    if (t !== lastDay) {
      entriesToday = 0;
      lastDay = t;
    }

    // --- 0. Fill pending entries (armed by the PREVIOUS bar's signal) at this
    // bar's open. A signal is only known at its close, so the fill happens on the
    // next bar — never at the signal bar's own close.
    for (const asset of Object.keys(pendingEntries)) {
      if (openPositions[asset]) { delete pendingEntries[asset]; continue; }
      const ps = perAsset[asset];
      const idx = ps.barIdx.get(t);
      if (idx === undefined) continue; // asset has no bar today; keep pending
      const pe = pendingEntries[asset];
      const bar = ps.daily[idx];
      const side = pe.action === "LONG" ? "buy" : "sell";
      const entryFill = slip(bar.open, side, slippagePct);
      const sz = sizePosition({ equity, riskPct, entry: entryFill, stop: pe.stop, direction: pe.action });
      if (sz.ok && Number.isFinite(sz.qty) && sz.qty > 0) {
        openPositions[asset] = {
          asset, direction: pe.action,
          entry: entryFill, initialStop: pe.stop, stop: pe.stop,
          qty: sz.qty, riskAmount: sz.riskDollar, riskPct,
          entryTime: bar.time, entryIdx: idx,
        };
      }
      delete pendingEntries[asset];
    }

    // --- 1. Update + check exits on open positions ---
    const exitsThisBar = [];
    for (const asset of Object.keys(openPositions)) {
      const ps = perAsset[asset];
      const idx = ps.barIdx.get(t);
      if (idx === undefined) continue;
      const bar = ps.daily[idx];
      const pos = openPositions[asset];
      const regimeState = ps.dailyRegime[idx];

      if (idx > 0) {
        if (pos.direction === "LONG") {
          const lo = ps.trail10.lower[idx - 1];
          if (lo !== null) pos.stop = Math.max(pos.stop, lo);
        } else {
          const hi = ps.trail10.upper[idx - 1];
          if (hi !== null) pos.stop = Math.min(pos.stop, hi);
        }
      }

      let exited = false, exitPrice = null, exitReason = null;
      if (pos.direction === "LONG" && bar.low <= pos.stop) {
        const raw = bar.open < pos.stop ? bar.open : pos.stop;
        exitPrice = slip(raw, "sell", slippagePct);
        exitReason = "trailing stop hit";
        exited = true;
      } else if (pos.direction === "SHORT" && bar.high >= pos.stop) {
        const raw = bar.open > pos.stop ? bar.open : pos.stop;
        exitPrice = slip(raw, "buy", slippagePct);
        exitReason = "trailing stop hit";
        exited = true;
      }
      if (!exited && exitOnRegimeFlip) {
        const flipLong = pos.direction === "LONG" && regimeState !== "LONG_OK";
        const flipShort = pos.direction === "SHORT" && regimeState !== "SHORT_OK";
        if (flipLong || flipShort) {
          exitPrice = slip(bar.close, pos.direction === "LONG" ? "sell" : "buy", slippagePct);
          exitReason = `regime flipped to ${regimeState}`;
          exited = true;
        }
      }
      if (exited) {
        exitsThisBar.push({ asset, pos, exitPrice, exitReason, bar, idx });
      }
    }

    for (const e of exitsThisBar) {
      const { asset, pos, exitPrice, exitReason, bar, idx } = e;
      const dir = pos.direction === "LONG" ? 1 : -1;
      const gross = dir * pos.qty * (exitPrice - pos.entry);
      const fees = (Math.abs(pos.entry) + Math.abs(exitPrice)) * pos.qty * (feePct / 100);
      const fundingCost = pos.fundingCost || 0;
      const net = gross - fees - fundingCost;
      equity += net;
      trades.push({
        asset, direction: pos.direction,
        entryTime: pos.entryTime, entry: pos.entry, initialStop: pos.initialStop,
        exitTime: bar.time, exit: exitPrice, exitReason,
        qty: pos.qty, pnl: net, fundingCost, pnlPct: (net / startEquity) * 100,
        rMultiple: net / pos.riskAmount,
        barsHeld: idx - pos.entryIdx,
      });
      delete openPositions[asset];
      recentlyStopped.push({ asset, time: bar.time });
    }

    // --- 2. Arm new entries from THIS bar's signals (filled at next bar's open).
    // Gating is applied now, at decision time; the fill happens on the next bar.
    const candidates = [];
    for (const asset of Object.keys(perAsset)) {
      if (openPositions[asset] || pendingEntries[asset]) continue;
      const ps = perAsset[asset];
      const idx = ps.barIdx.get(t);
      if (idx === undefined) continue;
      const sig = ps.signalSeries[idx];
      if (sig && (sig.action === "LONG" || sig.action === "SHORT")) {
        candidates.push({ asset, sig, idx, bar: ps.daily[idx], ps });
      }
    }

    // Sort by signal strength heuristic: prefer larger ATR-stop distance
    // (proxy for higher-conviction breakout magnitude). Stable tiebreak by asset name.
    candidates.sort((a, b) => {
      const da = Math.abs(a.sig.close - a.sig.stop) / a.sig.close;
      const db = Math.abs(b.sig.close - b.sig.stop) / b.sig.close;
      if (db !== da) return db - da;
      return a.asset.localeCompare(b.asset);
    });

    for (const cand of candidates) {
      if (entriesToday >= portfolioParams.maxEntriesPerDay) break;

      // Concurrency/correlation gating counts both open positions AND already-armed
      // pendings, so we never over-commit between arm and fill.
      const committed = [
        ...Object.entries(openPositions).map(([asset, p]) => ({ asset, direction: p.direction, riskPct: p.riskPct })),
        ...Object.entries(pendingEntries).map(([asset, p]) => ({ asset, direction: p.action, riskPct })),
      ];
      const stoppedRecent = recentlyStopped
        .filter((r) => (t - r.time) / 86400 < portfolioParams.reentryCooldownDays + 1)
        .map((r) => ({ asset: r.asset, daysSince: (t - r.time) / 86400 }));

      const allow = checkPortfolioAllows({
        candidate: { asset: cand.asset, direction: cand.sig.action, riskPct },
        openPositions: committed,
        recentlyStopped: stoppedRecent,
        todayEntries: entriesToday,
        params: portfolioParams,
      });
      if (!allow.allowed) continue;

      pendingEntries[cand.asset] = { action: cand.sig.action, stop: cand.sig.stop };
      entriesToday++;
    }

    // --- 3. Accrue funding on held positions, then mark to market ---
    let unrealized = 0;
    for (const asset of Object.keys(openPositions)) {
      const ps = perAsset[asset];
      const idx = ps.barIdx.get(t);
      if (idx === undefined) continue;
      const close = ps.daily[idx].close;
      const pos = openPositions[asset];
      const rateSum = fundingMaps[asset]?.get(dayKey(t)) || 0;
      pos.fundingCost = (pos.fundingCost || 0) +
        accrueFunding({ direction: pos.direction, qty: pos.qty, markPrice: close, rateSum });
      const dir = pos.direction === "LONG" ? 1 : -1;
      unrealized += dir * pos.qty * (close - pos.entry) - pos.fundingCost;
    }
    equityCurve.push({ time: t, equity: equity + unrealized, openCount: Object.keys(openPositions).length });
  }

  // Snapshot live open positions (with their CURRENT trailing stops) before the
  // end-of-data force-close — the paper-trading daemon needs them as real state.
  const openAtEnd = Object.values(openPositions).map((p) => ({ ...p }));

  // Close any remaining positions at the last bar's close.
  for (const asset of Object.keys(openPositions)) {
    const ps = perAsset[asset];
    const pos = openPositions[asset];
    const last = ps.daily[ps.daily.length - 1];
    const dir = pos.direction === "LONG" ? 1 : -1;
    const exitFill = slip(last.close, pos.direction === "LONG" ? "sell" : "buy", slippagePct);
    const gross = dir * pos.qty * (exitFill - pos.entry);
    const fees = (Math.abs(pos.entry) + Math.abs(exitFill)) * pos.qty * (feePct / 100);
    const fundingCost = pos.fundingCost || 0;
    const net = gross - fees - fundingCost;
    equity += net;
    trades.push({
      asset, direction: pos.direction,
      entryTime: pos.entryTime, entry: pos.entry, initialStop: pos.initialStop,
      exitTime: last.time, exit: exitFill, exitReason: "end of data",
      qty: pos.qty, pnl: net, fundingCost, pnlPct: (net / startEquity) * 100,
      rMultiple: net / pos.riskAmount,
      barsHeld: ps.daily.length - 1 - pos.entryIdx,
    });
  }

  return { trades, equityCurve, finalEquity: equity, startEquity, perAsset: Object.keys(perAsset), openPositions: openAtEnd };
}

function findLastClosedWeeklyIdx(weekly, t) {
  let lo = 0, hi = weekly.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const close = weekly[mid].closeTime ?? weekly[mid].time;
    if (close <= t) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}
