(() => {
  // trading/data/binance.js
  var SPOT = typeof window !== "undefined" && window.__BINANCE_PROXY_BASE__ || "/binance-spot";
  var FUT = typeof window !== "undefined" && window.__BINANCE_FUT_BASE__ || "/binance-fut";
  function tfToBinanceInterval(tf) {
    const map = {
      "5m": "5m",
      "15m": "15m",
      "1H": "1h",
      "2H": "2h",
      "4H": "4h",
      "8H": "8h",
      "12H": "12h",
      "1D": "1d",
      "3D": "3d",
      "1W": "1w"
    };
    return map[tf] || tf;
  }
  function binanceSymbol(asset, quote = "USDT") {
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
    return raw.map((k) => ({
      time: Math.floor(Number(k[0]) / 1e3),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Math.floor(Number(k[6]) / 1e3),
      // field 9 = taker buy base volume (aggressor market buys). Kept so the
      // CVD / volume-delta indicator can read flow without extra requests.
      takerBuyBase: Number(k[9])
    })).filter(
      (c) => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close)
    );
  }
  async function fetchKlines({ asset, quote = "USDT", timeframe, limit = 300 }) {
    const symbol = binanceSymbol(asset, quote);
    const interval = tfToBinanceInterval(timeframe);
    const url = `${SPOT}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const raw = await fetchJson(url);
    return toCandles(raw);
  }
  async function fetchKlinesRange({ asset, quote = "USDT", timeframe, startTime, endTime = Date.now() }) {
    const symbol = binanceSymbol(asset, quote);
    const interval = tfToBinanceInterval(timeframe);
    const all = [];
    let cursor = startTime;
    for (let guard = 0; guard < 50; guard++) {
      const url = `${SPOT}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${cursor}&limit=1000`;
      const raw = await fetchJson(url);
      const batch = toCandles(raw);
      if (batch.length === 0) break;
      all.push(...batch);
      const lastCloseMs = (batch[batch.length - 1].closeTime || batch[batch.length - 1].time) * 1e3;
      if (batch.length < 1e3 || lastCloseMs >= endTime) break;
      cursor = lastCloseMs + 1;
    }
    const seen = /* @__PURE__ */ new Set();
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
  async function fetchDerivsContext(asset) {
    const symbol = binanceSymbol(asset, "USDT");
    const out = {
      asset,
      fundingRate: null,
      openInterest: null,
      oiChange24hPct: null,
      longShortRatio: null,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      const f = await fetchJson(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
      out.fundingRate = num(f?.[0]?.fundingRate);
    } catch {
    }
    try {
      const oi = await fetchJson(`${FUT}/fapi/v1/openInterest?symbol=${symbol}`);
      out.openInterest = num(oi?.openInterest);
    } catch {
    }
    try {
      const hist = await fetchJson(`${FUT}/futures/data/openInterestHist?symbol=${symbol}&period=1d&limit=2`);
      let a = num(hist?.[0]?.sumOpenInterest);
      let b = num(hist?.[1]?.sumOpenInterest);
      if (hist?.[0]?.timestamp && hist?.[1]?.timestamp && Number(hist[0].timestamp) < Number(hist[1].timestamp)) {
        [a, b] = [b, a];
      }
      if (a !== null && b !== null && b > 0) out.oiChange24hPct = (a - b) / b * 100;
    } catch {
    }
    try {
      const ls = await fetchJson(`${FUT}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=4h&limit=1`);
      out.longShortRatio = num(ls?.[0]?.longShortRatio);
    } catch {
    }
    return out;
  }
  function dropUnclosedCandle(candles) {
    if (candles.length === 0) return candles;
    const now = Math.floor(Date.now() / 1e3);
    const last = candles[candles.length - 1];
    if (last.closeTime && last.closeTime > now) return candles.slice(0, -1);
    return candles;
  }

  // trading/indicators/sma.js
  function sma(values, period) {
    if (!Array.isArray(values) || !Number.isFinite(period) || period <= 0) return [];
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    out[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
      sum += values[i] - values[i - period];
      out[i] = sum / period;
    }
    return out;
  }
  function ema(values, period) {
    if (!Array.isArray(values) || !Number.isFinite(period) || period <= 0) return [];
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    out[period - 1] = seed / period;
    const k = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
      out[i] = values[i] * k + out[i - 1] * (1 - k);
    }
    return out;
  }
  function rma(values, period) {
    if (!Array.isArray(values) || !Number.isFinite(period) || period <= 0) return [];
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    out[period - 1] = seed / period;
    for (let i = period; i < values.length; i++) {
      out[i] = (out[i - 1] * (period - 1) + values[i]) / period;
    }
    return out;
  }

  // trading/indicators/macd.js
  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const fastE = ema(closes, fast);
    const slowE = ema(closes, slow);
    const macdLine = closes.map((_, i) => {
      if (fastE[i] === null || slowE[i] === null) return null;
      return fastE[i] - slowE[i];
    });
    const firstIdx = macdLine.findIndex((v) => v !== null);
    let signalLine = new Array(closes.length).fill(null);
    if (firstIdx !== -1) {
      const tail = macdLine.slice(firstIdx);
      const sig = ema(tail, signal);
      for (let i = 0; i < sig.length; i++) signalLine[firstIdx + i] = sig[i];
    }
    const hist = closes.map((_, i) => {
      if (macdLine[i] === null || signalLine[i] === null) return null;
      return macdLine[i] - signalLine[i];
    });
    return { macd: macdLine, signal: signalLine, hist };
  }

  // trading/indicators/rsi.js
  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return out;
    const gains = new Array(closes.length).fill(0);
    const losses = new Array(closes.length).fill(0);
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      gains[i] = d > 0 ? d : 0;
      losses[i] = d < 0 ? -d : 0;
    }
    const avgG = rma(gains.slice(1), period);
    const avgL = rma(losses.slice(1), period);
    for (let i = 0; i < avgG.length; i++) {
      const g = avgG[i];
      const l = avgL[i];
      if (g === null || l === null) continue;
      const rs = l === 0 ? Infinity : g / l;
      const r2 = l === 0 ? 100 : 100 - 100 / (1 + rs);
      out[i + 1] = r2;
    }
    return out;
  }

  // trading/indicators/atr.js
  function trueRange(candles) {
    const out = new Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (i === 0) {
        out[i] = c.high - c.low;
        continue;
      }
      const prevClose = candles[i - 1].close;
      out[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
    }
    return out;
  }
  function atr(candles, period = 14) {
    const tr = trueRange(candles);
    const trFromOne = tr.slice(1);
    const smoothed = rma(trFromOne, period);
    const out = new Array(candles.length).fill(null);
    for (let i = 0; i < smoothed.length; i++) out[i + 1] = smoothed[i];
    return out;
  }

  // trading/indicators/dmi.js
  function adx(candles, period = 14) {
    const len = candles.length;
    const empty = () => new Array(len).fill(null);
    if (len < period * 2) return { plusDI: empty(), minusDI: empty(), adx: empty() };
    const plusDM = new Array(len).fill(0);
    const minusDM = new Array(len).fill(0);
    for (let i = 1; i < len; i++) {
      const up = candles[i].high - candles[i - 1].high;
      const down = candles[i - 1].low - candles[i].low;
      plusDM[i] = up > down && up > 0 ? up : 0;
      minusDM[i] = down > up && down > 0 ? down : 0;
    }
    const tr = trueRange(candles);
    const trS = rma(tr.slice(1), period);
    const plusS = rma(plusDM.slice(1), period);
    const minusS = rma(minusDM.slice(1), period);
    const plusDI = empty();
    const minusDI = empty();
    const dx = new Array(len).fill(null);
    for (let i = 0; i < trS.length; i++) {
      const idx = i + 1;
      if (trS[i] === null || trS[i] === 0) continue;
      const p = 100 * plusS[i] / trS[i];
      const m = 100 * minusS[i] / trS[i];
      plusDI[idx] = p;
      minusDI[idx] = m;
      const sum = p + m;
      dx[idx] = sum === 0 ? 0 : 100 * Math.abs(p - m) / sum;
    }
    const firstDx = dx.findIndex((v) => v !== null);
    const adxOut = empty();
    if (firstDx !== -1) {
      const dxTail = dx.slice(firstDx).filter((v) => v !== null);
      const adxTail = rma(dxTail, period);
      for (let i = 0; i < adxTail.length; i++) adxOut[firstDx + i] = adxTail[i];
    }
    return { plusDI, minusDI, adx: adxOut };
  }

  // trading/strategy/regime.js
  var REGIME_PARAMS = {
    smaPeriod: 50,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    rsiPeriod: 14,
    adxPeriod: 14,
    adxMin: 20,
    // Ablation switches: turn individual regime conditions on/off to test whether
    // each actually contributes out-of-sample edge (see scripts/ablation.mjs). All
    // true = the v1.1 spec regime.
    use: { sma: true, macd: true, rsi: true, adx: true }
  };
  function computeRegime(weeklyCandles, params = REGIME_PARAMS) {
    const len = weeklyCandles.length;
    const closes = weeklyCandles.map((c) => c.close);
    const smaArr = sma(closes, params.smaPeriod);
    const { hist } = macd(closes, params.macdFast, params.macdSlow, params.macdSignal);
    const rsiArr = rsi(closes, params.rsiPeriod);
    const { adx: adxArr } = adx(weeklyCandles, params.adxPeriod);
    const series = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
      const close = closes[i];
      const smaV = smaArr[i];
      const histV = hist[i];
      const rsiV = rsiArr[i];
      const adxV = adxArr[i];
      if ([smaV, histV, rsiV, adxV].some((v) => v === null || v === void 0)) {
        series[i] = { state: "WARMUP", close, sma: smaV, hist: histV, rsi: rsiV, adx: adxV };
        continue;
      }
      const use = params.use || { sma: true, macd: true, rsi: true, adx: true };
      const trending = use.adx ? adxV >= params.adxMin : true;
      const directionalEnabled = use.sma || use.macd || use.rsi;
      const bullChecks = (!use.sma || close > smaV) && (!use.macd || histV > 0) && (!use.rsi || rsiV > 50);
      const bearChecks = (!use.sma || close < smaV) && (!use.macd || histV < 0) && (!use.rsi || rsiV < 50);
      let state = "FLAT";
      if (directionalEnabled && trending && bullChecks && !bearChecks) state = "LONG_OK";
      else if (directionalEnabled && trending && bearChecks && !bullChecks) state = "SHORT_OK";
      series[i] = { state, close, sma: smaV, hist: histV, rsi: rsiV, adx: adxV };
    }
    return { series, latest: series[len - 1] };
  }

  // trading/indicators/donchian.js
  function donchianCloses(closes, period = 20) {
    const len = closes.length;
    const upper = new Array(len).fill(null);
    const lower = new Array(len).fill(null);
    for (let i = period - 1; i < len; i++) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (closes[j] > hi) hi = closes[j];
        if (closes[j] < lo) lo = closes[j];
      }
      upper[i] = hi;
      lower[i] = lo;
    }
    return { upper, lower };
  }

  // trading/indicators/bollinger.js
  function bollinger(closes, period = 20, mult = 2) {
    const basis = sma(closes, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      const mean = basis[i];
      let sq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = closes[j] - mean;
        sq += d * d;
      }
      const stdev = Math.sqrt(sq / period);
      upper[i] = mean + mult * stdev;
      lower[i] = mean - mult * stdev;
    }
    return { basis, upper, lower };
  }

  // trading/strategy/signal.js
  var SIGNAL_PARAMS = {
    donchianEntry: 20,
    donchianExit: 10,
    bbPeriod: 20,
    bbMult: 2,
    bbExtensionSigmas: 0.5,
    rsiPeriod: 14,
    rsiLongMax: 75,
    rsiShortMin: 25,
    atrPeriod: 14,
    atrStopMult: 2.5,
    // Ablation switches. The anti-chase filters (RSI gate, BB-extension veto) are the
    // most suspect rules: they reject the strongest breakouts, which may be the very
    // right-tail trends the system needs. Turn them off to measure their real effect.
    useRsiVeto: true,
    useBbVeto: true,
    // When true, breakouts fire regardless of weekly regime — the bare-Donchian
    // baseline for ablation. Production keeps this false.
    ignoreRegime: false,
    // Direction switches. The predeclared long/short decision rule says: if one
    // book fails after costs, cut it rather than keep it for symmetry.
    allowLong: true,
    allowShort: true
  };
  function bbExtensionVeto(close, basis, upper, lower, sigmas) {
    if ([basis, upper, lower].some((v) => v === null || v === void 0)) return false;
    const sigma = (upper - basis) / 2;
    if (sigma <= 0) return false;
    const upperVetoLine = upper + sigmas * sigma;
    const lowerVetoLine = lower - sigmas * sigma;
    return { extendedUp: close > upperVetoLine, extendedDown: close < lowerVetoLine };
  }
  function computeSignal(dailyCandles, regimeState, params = SIGNAL_PARAMS) {
    const len = dailyCandles.length;
    const closes = dailyCandles.map((c) => c.close);
    const stateAt = Array.isArray(regimeState) ? (i) => regimeState[i] : () => regimeState;
    const entry = donchianCloses(closes, params.donchianEntry);
    const exit = donchianCloses(closes, params.donchianExit);
    const bb = bollinger(closes, params.bbPeriod, params.bbMult);
    const rsiArr = rsi(closes, params.rsiPeriod);
    const atrArr = atr(dailyCandles, params.atrPeriod);
    const series = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
      const close = closes[i];
      const prevEntryUpper = i > 0 ? entry.upper[i - 1] : null;
      const prevEntryLower = i > 0 ? entry.lower[i - 1] : null;
      const exitUpper = exit.upper[i];
      const exitLower = exit.lower[i];
      const atrV = atrArr[i];
      const rsiV = rsiArr[i];
      const ready = prevEntryUpper !== null && prevEntryLower !== null && exitUpper !== null && exitLower !== null && atrV !== null && atrV !== void 0 && rsiV !== null;
      if (!ready) {
        series[i] = { action: "WAIT", reason: "warmup", close };
        continue;
      }
      const veto = bbExtensionVeto(close, bb.basis[i], bb.upper[i], bb.lower[i], params.bbExtensionSigmas);
      const breakoutUp = close > prevEntryUpper;
      const breakoutDown = close < prevEntryLower;
      let action = "NONE";
      let reason = "no breakout";
      let stop = null;
      const longAllowed = params.allowLong !== false && (params.ignoreRegime || stateAt(i) === "LONG_OK");
      const shortAllowed = params.allowShort !== false && (params.ignoreRegime || stateAt(i) === "SHORT_OK");
      if (breakoutUp && longAllowed) {
        if (params.useBbVeto && veto && veto.extendedUp) {
          action = "VETO";
          reason = "long breakout but price extended above upper BB band";
        } else if (params.useRsiVeto && rsiV >= params.rsiLongMax) {
          action = "VETO";
          reason = `daily RSI ${rsiV.toFixed(1)} >= ${params.rsiLongMax} (overbought)`;
        } else {
          const atrStop = close - params.atrStopMult * atrV;
          stop = Math.max(atrStop, exitLower);
          action = "LONG";
          reason = `daily close ${close} broke 20-day high ${prevEntryUpper.toFixed(2)}`;
        }
      } else if (breakoutDown && shortAllowed) {
        if (params.useBbVeto && veto && veto.extendedDown) {
          action = "VETO";
          reason = "short breakout but price extended below lower BB band";
        } else if (params.useRsiVeto && rsiV <= params.rsiShortMin) {
          action = "VETO";
          reason = `daily RSI ${rsiV.toFixed(1)} <= ${params.rsiShortMin} (oversold)`;
        } else {
          const atrStop = close + params.atrStopMult * atrV;
          stop = Math.min(atrStop, exitUpper);
          action = "SHORT";
          reason = `daily close ${close} broke 20-day low ${prevEntryLower.toFixed(2)}`;
        }
      } else if (breakoutUp || breakoutDown) {
        action = "NONE";
        reason = `breakout against regime (${stateAt(i)})`;
      }
      series[i] = {
        action,
        reason,
        close,
        entryUpper: prevEntryUpper,
        entryLower: prevEntryLower,
        exitUpper,
        exitLower,
        atr: atrV,
        rsi: rsiV,
        stop
      };
    }
    return { series, latest: series[len - 1] };
  }

  // trading/strategy/sizing.js
  function sizePosition({ equity, riskPct, entry, stop, direction, leverage = null }) {
    const reasons = [];
    if (!Number.isFinite(equity) || equity <= 0) return { ok: false, reason: "equity invalid" };
    if (!Number.isFinite(riskPct) || riskPct <= 0) return { ok: false, reason: "riskPct invalid" };
    if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
      return { ok: false, reason: "entry/stop invalid" };
    }
    if (direction === "LONG" && stop >= entry) return { ok: false, reason: "long stop >= entry" };
    if (direction === "SHORT" && stop <= entry) return { ok: false, reason: "short stop <= entry" };
    const riskDollar = equity * (riskPct / 100);
    const perUnitRisk = Math.abs(entry - stop);
    const qty = riskDollar / perUnitRisk;
    const notional = qty * entry;
    const stopDistPct = perUnitRisk / entry * 100;
    let requiredLeverage = null;
    let marginUsed = null;
    if (Number.isFinite(leverage) && leverage > 0) {
      marginUsed = notional / leverage;
      if (marginUsed > equity) {
        reasons.push(`margin (${marginUsed.toFixed(0)}) exceeds equity (${equity}) at ${leverage}x`);
      }
    }
    requiredLeverage = notional / equity;
    return {
      ok: true,
      riskDollar,
      perUnitRisk,
      qty,
      notional,
      stopDistPct,
      requiredLeverage,
      marginUsed,
      warnings: reasons
    };
  }

  // trading/strategy/derivatives.js
  var DERIVATIVES_PARAMS = {
    fundingElevated: 5e-4,
    // 0.05% per interval — crowded
    fundingExtreme: 1e-3,
    // 0.10% — very crowded, squeeze risk high
    oiConfirmPct: 3,
    // OI up >3% over window = conviction
    oiFadePct: -3
    // OI down >3% = unwinding / weaker move
  };
  function assessDerivatives({ direction, fundingRate, oiChangePct, cvdSlope: cvdSlope2 }, params = DERIVATIVES_PARAMS) {
    const reasons = [];
    let crowding = 0;
    let confirm2 = 0;
    if (Number.isFinite(fundingRate)) {
      const f = fundingRate;
      const crowdedDir = f > 0 ? "LONG" : "SHORT";
      const mag = Math.abs(f);
      const pct = (f * 100).toFixed(4);
      if (mag >= params.fundingExtreme && crowdedDir === direction) {
        crowding += 2;
        reasons.push(`funding ${pct}% extreme \u2014 ${direction.toLowerCase()}s very crowded`);
      } else if (mag >= params.fundingElevated && crowdedDir === direction) {
        crowding += 1;
        reasons.push(`funding ${pct}% elevated \u2014 ${direction.toLowerCase()}s crowded`);
      } else if (mag >= params.fundingElevated && crowdedDir !== direction) {
        confirm2 += 1;
        reasons.push(`funding ${pct}% favors us \u2014 crowd is ${crowdedDir.toLowerCase()}`);
      }
    }
    if (Number.isFinite(oiChangePct)) {
      if (oiChangePct >= params.oiConfirmPct) {
        confirm2 += 1;
        reasons.push(`OI +${oiChangePct.toFixed(1)}% \u2014 rising conviction`);
      } else if (oiChangePct <= params.oiFadePct) {
        crowding += 1;
        reasons.push(`OI ${oiChangePct.toFixed(1)}% \u2014 positions unwinding, weaker move`);
      }
    }
    if (Number.isFinite(cvdSlope2) && cvdSlope2 !== 0) {
      const flowDir = cvdSlope2 > 0 ? "LONG" : "SHORT";
      if (flowDir === direction) {
        confirm2 += 1;
        reasons.push("aggressor flow confirms direction");
      } else {
        crowding += 1;
        reasons.push("aggressor flow diverges from price");
      }
    }
    let grade = "NEUTRAL";
    let standDown = false;
    if (crowding >= 2 && crowding > confirm2) {
      grade = "CROWDED";
      standDown = true;
    } else if (confirm2 >= 2 && confirm2 > crowding) {
      grade = "CONFIRMED";
    } else if (crowding > confirm2) {
      grade = "CAUTION";
    }
    return { grade, standDown, crowding, confirm: confirm2, reasons };
  }

  // trading/indicators/cvd.js
  function volumeDelta(candles) {
    return candles.map((c) => {
      const v = c.volume;
      const tb = c.takerBuyBase;
      if (!Number.isFinite(v) || !Number.isFinite(tb)) return null;
      return 2 * tb - v;
    });
  }
  function cvd(candles) {
    const delta = volumeDelta(candles);
    const out = new Array(candles.length).fill(null);
    let run = 0;
    let started = false;
    for (let i = 0; i < candles.length; i++) {
      if (delta[i] === null) {
        out[i] = started ? run : null;
        continue;
      }
      run += delta[i];
      started = true;
      out[i] = run;
    }
    return { delta, cvd: out };
  }
  function cvdSlope(candles, lookback = 10) {
    const { cvd: c } = cvd(candles);
    const out = new Array(candles.length).fill(null);
    for (let i = lookback; i < candles.length; i++) {
      if (c[i] === null || c[i - lookback] === null) continue;
      let vol = 0;
      for (let j = i - lookback + 1; j <= i; j++) vol += candles[j].volume || 0;
      if (vol <= 0) continue;
      out[i] = (c[i] - c[i - lookback]) / vol;
    }
    return out;
  }

  // trading/strategy/presets.js
  var PRESET_V1 = {
    name: "v1",
    signalParams: { ...SIGNAL_PARAMS, useRsiVeto: true, useBbVeto: true, allowLong: true, allowShort: true },
    regimeParams: { ...REGIME_PARAMS, use: { sma: true, macd: true, rsi: true, adx: true } },
    exitOnRegimeFlip: true
  };
  var PRESET_V2 = {
    name: "v2",
    signalParams: { ...SIGNAL_PARAMS, useRsiVeto: false, useBbVeto: false, allowLong: true, allowShort: false },
    regimeParams: { ...REGIME_PARAMS, use: { sma: true, macd: false, rsi: false, adx: false } },
    exitOnRegimeFlip: false
  };
  var PRODUCTION_PRESET = PRESET_V2;

  // trading/strategy/runOne.js
  function runOne({ asset, weekly, daily, equity, riskPct, derivs = null, preset = PRODUCTION_PRESET }) {
    const regime = computeRegime(weekly, preset.regimeParams);
    const regimeState = regime.latest?.state || "WARMUP";
    const signal = computeSignal(daily, regimeState, preset.signalParams);
    const latestSignal = signal.latest;
    const cvdSlopeArr = cvdSlope(daily, 10);
    const flowSlope = cvdSlopeArr.length ? cvdSlopeArr[cvdSlopeArr.length - 1] : null;
    let sizing = null;
    let derivsAssessment = null;
    if (latestSignal && (latestSignal.action === "LONG" || latestSignal.action === "SHORT")) {
      sizing = sizePosition({
        equity,
        riskPct,
        entry: latestSignal.close,
        stop: latestSignal.stop,
        direction: latestSignal.action
      });
      derivsAssessment = assessDerivatives({
        direction: latestSignal.action,
        fundingRate: derivs?.fundingRate ?? null,
        oiChangePct: derivs?.oiChange24hPct ?? null,
        cvdSlope: flowSlope
      });
    }
    return {
      asset,
      regimeState,
      regimeLatest: regime.latest,
      signal: latestSignal,
      sizing,
      flowSlope,
      derivs,
      derivsAssessment
    };
  }

  // trading/strategy/liquidation.js
  function estimateLiquidation({ entry, direction, leverage, mmrPct = 0.5 }) {
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (!Number.isFinite(leverage) || leverage <= 0) return null;
    const mmr = mmrPct / 100;
    const invLev = 1 / leverage;
    return direction === "LONG" ? entry * (1 - invLev + mmr) : entry * (1 + invLev - mmr);
  }
  function stopToLiqBufferPct({ entry, stop, direction, leverage, mmrPct = 0.5 }) {
    const liq = estimateLiquidation({ entry, direction, leverage, mmrPct });
    if (liq === null || !Number.isFinite(stop) || !Number.isFinite(entry) || entry <= 0) return null;
    return direction === "LONG" ? (stop - liq) / entry * 100 : (liq - stop) / entry * 100;
  }
  function maxSafeLeverage({ entry, stop, direction, mmrPct = 0.5, minBufferPct = 2, buckets = [1, 2, 3, 5, 8, 10, 15, 20, 25] }) {
    let best = null;
    for (const lev of buckets) {
      const buf = stopToLiqBufferPct({ entry, stop, direction, leverage: lev, mmrPct });
      if (buf !== null && buf >= minBufferPct) best = lev;
    }
    return best;
  }

  // trading/ui/dom.js
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "dataset") Object.assign(node.dataset, v);
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, String(v));
      }
    }
    append(node, children);
    return node;
  }
  function append(node, children) {
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(
        c instanceof Node ? c : document.createTextNode(String(c))
      );
    }
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, props, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "text") node.textContent = String(v);
        else node.setAttribute(k, String(v));
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // trading/ui/format.js
  function fmt(n, d = 2) {
    if (n === null || n === void 0 || !Number.isFinite(n)) return "-";
    return n.toLocaleString(void 0, { maximumFractionDigits: d });
  }
  function fmtDate(unixSecs) {
    if (!unixSecs) return "-";
    return new Date(unixSecs * 1e3).toISOString().slice(0, 10);
  }
  var ymd = fmtDate;

  // trading/ui/scanner.js
  var UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
  var QUOTE = "USDT";
  var WEEKLY_LIMIT = 200;
  var DAILY_LIMIT = 200;
  var LEVERAGE_BUCKETS = [1, 2, 3, 5, 8, 10, 15, 20, 25];
  var LS_KEY = "scanner.config.v1";
  var DEFAULT_CFG = { equity: 1e5, riskPct: 1, fetchDerivs: false, leverage: 5, mmrPct: 0.5 };
  function loadCfg() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...DEFAULT_CFG };
      return { ...DEFAULT_CFG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CFG };
    }
  }
  function saveCfg(cfg) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    } catch {
    }
  }
  async function scanAsset(asset, equity, riskPct, fetchDerivs) {
    const [weekly, daily] = await Promise.all([
      fetchKlines({ asset, quote: QUOTE, timeframe: "1W", limit: WEEKLY_LIMIT }),
      fetchKlines({ asset, quote: QUOTE, timeframe: "1D", limit: DAILY_LIMIT })
    ]);
    let derivs = null;
    if (fetchDerivs) {
      try {
        derivs = await fetchDerivsContext(asset);
      } catch {
        derivs = null;
      }
    }
    return runOne({
      asset,
      weekly: dropUnclosedCandle(weekly),
      daily: dropUnclosedCandle(daily),
      equity,
      riskPct,
      derivs
    });
  }
  function badge(text, kind, title) {
    return el("span", { class: `tr-badge tr-badge--${String(kind || "flat").toLowerCase()}`, title: title || null }, text);
  }
  function regimeBadge(state) {
    const label = state === "SHORT_OK" ? "BEAR \u2014 NO LONGS" : state === "LONG_OK" ? "BULL \u2014 LONGS OK" : state;
    const title = state === "SHORT_OK" ? "Price is below the 50W SMA. System is long-only: DO NOT buy, DO NOT short. Stand aside." : state === "LONG_OK" ? "Price is above the 50W SMA. Breakout signals may fire." : "";
    return badge(label, state, title);
  }
  function entryTrigger(sig) {
    if (sig.action === "LONG") return `> ${fmt(sig.entryUpper, 4)}`;
    if (sig.action === "SHORT") return `< ${fmt(sig.entryLower, 4)}`;
    return "-";
  }
  var COLS = [
    "Asset",
    "Regime",
    "Action",
    "Close",
    "Entry trigger",
    "Stop",
    "D10 exit",
    "Stop dist",
    "Qty",
    "Notional",
    "Margin",
    "Liq \u2248",
    "Stop\u2192Liq",
    "Max lev",
    "50W SMA",
    "W MACD hist",
    "W ADX",
    "W RSI",
    "D RSI",
    "Flow",
    "Funding",
    "OI 24h",
    "Derivs"
  ];
  function mount(root) {
    let cfg = loadCfg();
    let rows = [];
    let lastScan = null;
    let loading = false;
    const subtitle = "Mechanical swing v2.0 (validated 2026-07-18): weekly 50W-SMA regime \u2192 daily Donchian-20 breakout, LONG-ONLY \u2192 fixed-risk sizing, Donchian-10 trailing exit. No vetoes, no shorts \u2014 the ablation showed they subtract.";
    const runBtn = el("button", { class: "btn btn-primary", type: "button", onClick: runScan }, "RUN SCAN");
    const lastEl = el("div", { class: "tr-last" });
    const equityInput = el("input", { class: "tr-input", value: cfg.equity, onInput: (e) => {
      cfg.equity = e.target.value;
      saveCfg(cfg);
      updateRiskReadout();
    } });
    const riskInput = el("input", { class: "tr-input", value: cfg.riskPct, onInput: (e) => {
      cfg.riskPct = e.target.value;
      saveCfg(cfg);
      updateRiskReadout();
    } });
    const riskReadout = el("div", { class: "tr-readonly" });
    const levSelect = el("select", {
      class: "tr-input",
      onChange: (e) => {
        cfg.leverage = Number(e.target.value);
        saveCfg(cfg);
        renderTable();
      }
    }, ...LEVERAGE_BUCKETS.map((l) => el("option", { value: l, selected: Number(cfg.leverage) === l ? true : null }, `${l}x`)));
    const derivsBox = el("input", {
      type: "checkbox",
      checked: cfg.fetchDerivs ? true : null,
      onChange: (e) => {
        cfg.fetchDerivs = e.target.checked;
        saveCfg(cfg);
        derivsLabel.textContent = derivsText();
      }
    });
    const derivsLabel = el("span", { class: "tr-mut", style: "font-size:12px" });
    const summary = el("div", { class: "tr-summary" });
    const tableHost = el("div", { class: "tr-table-host" });
    function derivsText() {
      return cfg.fetchDerivs ? "On \u2014 fetches positioning per asset (slower)" : "Off \u2014 price/flow only";
    }
    function updateRiskReadout() {
      const v = (Number(cfg.equity) || 0) * (Number(cfg.riskPct) || 0) / 100;
      riskReadout.textContent = `${fmt(v, 2)} USDT`;
    }
    function dataRow(r2) {
      if (!r2.ok) {
        return el(
          "tr",
          null,
          el("td", { class: "tr-td" }, r2.asset),
          el("td", { class: "tr-td tr-err", colspan: 22 }, `error: ${r2.error}`)
        );
      }
      const sig = r2.signal || {};
      const rl = r2.regimeLatest || {};
      const sz = r2.sizing;
      const d = r2.derivs || {};
      const flow = r2.flowSlope;
      const da = r2.derivsAssessment;
      const leverage = Number(cfg.leverage) || 5;
      const mmrPct = Number(cfg.mmrPct) || 0.5;
      const hasSignal = sig.action === "LONG" || sig.action === "SHORT";
      const liq = hasSignal ? estimateLiquidation({ entry: sig.close, direction: sig.action, leverage, mmrPct }) : null;
      const liqBuf = hasSignal ? stopToLiqBufferPct({ entry: sig.close, stop: sig.stop, direction: sig.action, leverage, mmrPct }) : null;
      const safeLev = hasSignal ? maxSafeLeverage({ entry: sig.close, stop: sig.stop, direction: sig.action, mmrPct }) : null;
      const margin = hasSignal && sz?.ok ? sz.notional / leverage : null;
      const liqDanger = liqBuf !== null && liqBuf < 2;
      const histClass = rl.hist > 0 ? "tr-pos" : rl.hist < 0 ? "tr-neg" : "tr-mut";
      const flowClass = flow > 0 ? "tr-pos" : flow < 0 ? "tr-neg" : "tr-mut";
      const fundClass = d.fundingRate > 0 ? "tr-neg" : d.fundingRate < 0 ? "tr-pos" : "tr-mut";
      const oiClass = d.oiChange24hPct > 0 ? "tr-pos" : d.oiChange24hPct < 0 ? "tr-neg" : "tr-mut";
      return el(
        "tr",
        null,
        el("td", { class: "tr-td tr-strong" }, binanceSymbol(r2.asset)),
        el("td", { class: "tr-td" }, regimeBadge(r2.regimeState)),
        el("td", { class: "tr-td" }, badge(sig.action || "WAIT", sig.action || "WAIT", sig.reason || "")),
        el("td", { class: "tr-td" }, fmt(sig.close, 4)),
        el("td", { class: "tr-td" }, entryTrigger(sig)),
        el("td", { class: "tr-td" }, fmt(sig.stop, 4)),
        el("td", { class: "tr-td", title: "10-day trailing exit line. If you HOLD: exit when the daily close is below this. Ratchet your stop up to it daily \u2014 never down." }, fmt(sig.exitLower, 4)),
        el("td", { class: "tr-td" }, sz?.ok ? `${fmt(sz.stopDistPct, 2)}%` : "-"),
        el("td", { class: "tr-td" }, sz?.ok ? fmt(sz.qty, 6) : "-"),
        el("td", { class: "tr-td" }, sz?.ok ? fmt(sz.notional, 0) : "-"),
        el("td", { class: "tr-td" }, margin !== null ? fmt(margin, 0) : "-"),
        el("td", { class: "tr-td" }, liq !== null ? fmt(liq, 4) : "-"),
        el(
          "td",
          {
            class: `tr-td ${liqDanger ? "tr-neg tr-strong" : liqBuf !== null ? "tr-pos" : "tr-mut"}`,
            title: "Distance from stop to estimated liquidation. Below 2% = a wick can liquidate you before your stop fires \u2014 lower the leverage."
          },
          liqBuf !== null ? `${fmt(liqBuf, 1)}%${liqDanger ? " \u26A0" : ""}` : "-"
        ),
        el(
          "td",
          { class: "tr-td", title: "Largest leverage that keeps the stop \u22652% inside liquidation" },
          safeLev !== null ? `${safeLev}x` : hasSignal ? "none" : "-"
        ),
        el("td", { class: "tr-td" }, fmt(rl.sma, 2)),
        el("td", { class: `tr-td ${histClass}` }, fmt(rl.hist, 3)),
        el("td", { class: "tr-td" }, fmt(rl.adx, 1)),
        el("td", { class: "tr-td" }, fmt(rl.rsi, 1)),
        el("td", { class: "tr-td" }, fmt(sig.rsi, 1)),
        el(
          "td",
          { class: `tr-td ${flowClass}`, title: "CVD slope over last 10 days (aggressor flow)" },
          flow === null || flow === void 0 ? "-" : `${flow > 0 ? "\u25B2" : "\u25BC"} ${fmt(Math.abs(flow) * 100, 1)}`
        ),
        el("td", { class: `tr-td ${fundClass}` }, Number.isFinite(d.fundingRate) ? `${fmt(d.fundingRate * 100, 4)}%` : "-"),
        el("td", { class: `tr-td ${oiClass}` }, Number.isFinite(d.oiChange24hPct) ? `${fmt(d.oiChange24hPct, 1)}%` : "-"),
        el("td", { class: "tr-td" }, da ? badge(da.grade, da.grade, (da.reasons || []).join("\n")) : "-")
      );
    }
    function renderSummary(message, kind) {
      clear(summary);
      const longOk = rows.filter((r2) => r2.ok && r2.regimeState === "LONG_OK").length;
      const shortOk = rows.filter((r2) => r2.ok && r2.regimeState === "SHORT_OK").length;
      const flat = rows.filter((r2) => r2.ok && r2.regimeState === "FLAT").length;
      const entries = rows.filter((r2) => r2.ok && (r2.signal?.action === "LONG" || r2.signal?.action === "SHORT")).length;
      const vetoes = rows.filter((r2) => r2.ok && r2.signal?.action === "VETO").length;
      append(summary, [
        el("span", { class: "tr-pill tr-pill--longok" }, `BULL (longs allowed): ${longOk}`),
        el("span", { class: "tr-pill tr-pill--shortok" }, `BEAR (stand aside): ${shortOk}`),
        el("span", { class: "tr-pill tr-pill--flat" }, `FLAT: ${flat}`),
        el("span", { class: "tr-pill tr-pill--signal" }, `SIGNALS: ${entries}`),
        el("span", { class: "tr-pill tr-pill--veto" }, `VETOES: ${vetoes}`),
        message ? el("span", { class: `tr-status tr-status--${kind || "ok"}` }, message) : null
      ]);
    }
    function renderTable() {
      clear(tableHost);
      if (rows.length === 0) {
        tableHost.appendChild(el(
          "div",
          { class: "tr-empty" },
          "Click RUN SCAN. Manual refresh only \u2014 this is a once-a-day system."
        ));
        return;
      }
      const table = el(
        "table",
        { class: "tr-table" },
        el("thead", null, el("tr", null, ...COLS.map((c) => el("th", { class: "tr-th" }, c)))),
        el("tbody", null, ...rows.map(dataRow))
      );
      tableHost.appendChild(el("div", { class: "tr-table-wrap" }, table));
    }
    async function runScan() {
      if (loading) return;
      loading = true;
      runBtn.textContent = "SCANNING...";
      runBtn.disabled = true;
      renderSummary(`Scanning ${UNIVERSE.length} assets...`, "info");
      const equity = Number(cfg.equity) || 0;
      const riskPct = Number(cfg.riskPct) || 0;
      const results = await Promise.allSettled(UNIVERSE.map((a) => scanAsset(a, equity, riskPct, cfg.fetchDerivs)));
      rows = results.map((res, i) => res.status === "fulfilled" ? { ok: true, ...res.value } : { ok: false, asset: UNIVERSE[i], error: res.reason?.message || "fetch failed" });
      lastScan = /* @__PURE__ */ new Date();
      lastEl.textContent = `Last: ${lastScan.toLocaleTimeString()}`;
      const errs = rows.filter((r2) => !r2.ok).length;
      renderSummary(errs ? `Done with ${errs} error(s).` : "Scan complete.", errs ? "warn" : "ok");
      renderTable();
      loading = false;
      runBtn.textContent = "RUN SCAN";
      runBtn.disabled = false;
    }
    clear(root);
    root.appendChild(
      el(
        "div",
        { class: "tr-view" },
        el(
          "div",
          { class: "tr-header" },
          el(
            "div",
            null,
            el("h1", { class: "tr-title" }, "SCANNER"),
            el("div", { class: "tr-subtitle" }, subtitle)
          ),
          el("div", { class: "tr-header-actions" }, runBtn, lastEl)
        ),
        el(
          "div",
          { class: "tr-controls tr-controls--5" },
          el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "EQUITY (USDT)"), equityInput),
          el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "RISK % PER TRADE"), riskInput),
          el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "RISK $ (LOSS @ STOP)"), riskReadout),
          el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "LEVERAGE (ISOLATED)"), levSelect),
          el(
            "div",
            { class: "tr-field" },
            el("label", { class: "tr-label" }, "DERIVATIVES (FUNDING / OI)"),
            el("label", { class: "tr-readonly", style: "display:flex;align-items:center;gap:8px;cursor:pointer" }, derivsBox, derivsLabel)
          )
        ),
        summary,
        tableHost,
        el(
          "div",
          { class: "tr-foot" },
          `Source: Binance spot ${QUOTE} klines (1W, 1D), live unclosed candle excluded. Universe: ${UNIVERSE.join(" \xB7 ")}.`
        )
      )
    );
    derivsLabel.textContent = derivsText();
    updateRiskReadout();
    renderSummary("", "ok");
    renderTable();
  }

  // trading/backtest/funding.js
  function dayKey(unixSecs) {
    return Math.floor(unixSecs / 86400);
  }
  function buildDailyFundingMap(funding) {
    const map = /* @__PURE__ */ new Map();
    if (!Array.isArray(funding)) return map;
    for (const r2 of funding) {
      if (!Number.isFinite(r2?.time) || !Number.isFinite(r2?.fundingRate)) continue;
      const k = dayKey(r2.time);
      map.set(k, (map.get(k) || 0) + r2.fundingRate);
    }
    return map;
  }
  function accrueFunding({ direction, qty, markPrice, rateSum }) {
    if (!rateSum) return 0;
    const dir = direction === "LONG" ? 1 : -1;
    return dir * rateSum * qty * markPrice;
  }

  // trading/backtest/engine.js
  function slip(price, side, slippagePct) {
    const s = (slippagePct || 0) / 100;
    return side === "buy" ? price * (1 + s) : price * (1 - s);
  }
  function findLastClosedWeeklyIdx(weekly, t) {
    let lo = 0;
    let hi = weekly.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      const close = weekly[mid].closeTime ?? weekly[mid].time;
      if (close <= t) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }
  function backtestOne({
    asset = "ASSET",
    weekly,
    daily,
    startEquity = 1e5,
    riskPct = 1,
    feePct = 0.08,
    slippagePct = 0,
    funding = null,
    // Ablation switch: the regime-flip exit force-closes on any weekly regime change.
    // Weekly MACD histogram can flicker mid-trend, so this rule may repeatedly eject
    // us from trades the Donchian-10 trail would have ridden. false = trail-only exits.
    exitOnRegimeFlip = true,
    signalParams = SIGNAL_PARAMS,
    regimeParams = REGIME_PARAMS
  }) {
    const regime = computeRegime(weekly, regimeParams);
    const fundingByDay = buildDailyFundingMap(funding);
    const closes = daily.map((c) => c.close);
    const trail10 = donchianCloses(closes, signalParams.donchianExit);
    let equity = startEquity;
    let pos = null;
    let pendingEntry = null;
    const trades = [];
    const equityCurve = [];
    let dailyRegime = new Array(daily.length).fill("WARMUP");
    for (let i = 0; i < daily.length; i++) {
      const wIdx = findLastClosedWeeklyIdx(weekly, daily[i].time);
      dailyRegime[i] = wIdx >= 0 ? regime.series[wIdx]?.state || "WARMUP" : "WARMUP";
    }
    const signalSeries = computeSignal(daily, dailyRegime, signalParams).series;
    for (let i = 0; i < daily.length; i++) {
      const bar = daily[i];
      const regimeState = dailyRegime[i];
      if (!pos && pendingEntry) {
        const side = pendingEntry.action === "LONG" ? "buy" : "sell";
        const entryFill = slip(bar.open, side, slippagePct);
        const sz = sizePosition({
          equity,
          riskPct,
          entry: entryFill,
          stop: pendingEntry.stop,
          direction: pendingEntry.action
        });
        if (sz.ok && Number.isFinite(sz.qty) && sz.qty > 0) {
          pos = {
            asset,
            direction: pendingEntry.action,
            entry: entryFill,
            initialStop: pendingEntry.stop,
            stop: pendingEntry.stop,
            qty: sz.qty,
            riskAmount: sz.riskDollar,
            entryTime: bar.time,
            entryIdx: i
          };
        }
        pendingEntry = null;
      }
      if (pos) {
        if (i > 0) {
          if (pos.direction === "LONG") {
            const lo = trail10.lower[i - 1];
            if (lo !== null) pos.stop = Math.max(pos.stop, lo);
          } else {
            const hi = trail10.upper[i - 1];
            if (hi !== null) pos.stop = Math.min(pos.stop, hi);
          }
        }
        let exited = false;
        let exitPrice = null;
        let exitReason = null;
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
          const dir = pos.direction === "LONG" ? 1 : -1;
          const gross = dir * pos.qty * (exitPrice - pos.entry);
          const fees = (Math.abs(pos.entry) + Math.abs(exitPrice)) * pos.qty * (feePct / 100);
          const fundingCost = pos.fundingCost || 0;
          const net = gross - fees - fundingCost;
          equity += net;
          trades.push({
            asset: pos.asset,
            direction: pos.direction,
            entryTime: pos.entryTime,
            entry: pos.entry,
            initialStop: pos.initialStop,
            exitTime: bar.time,
            exit: exitPrice,
            exitReason,
            qty: pos.qty,
            pnl: net,
            fundingCost,
            pnlPct: net / startEquity * 100,
            rMultiple: net / pos.riskAmount,
            barsHeld: i - pos.entryIdx
          });
          pos = null;
        }
      }
      if (!pos && !pendingEntry) {
        const sig = signalSeries[i];
        if (sig && (sig.action === "LONG" || sig.action === "SHORT")) {
          pendingEntry = { action: sig.action, stop: sig.stop, signalIdx: i };
        }
      }
      let unrealized = 0;
      if (pos) {
        const rateSum = fundingByDay.get(dayKey(bar.time)) || 0;
        pos.fundingCost = (pos.fundingCost || 0) + accrueFunding({ direction: pos.direction, qty: pos.qty, markPrice: bar.close, rateSum });
        const dir = pos.direction === "LONG" ? 1 : -1;
        unrealized = dir * pos.qty * (bar.close - pos.entry) - pos.fundingCost;
      }
      equityCurve.push({ time: bar.time, equity: equity + unrealized, hasPosition: !!pos });
    }
    if (pos) {
      const last = daily[daily.length - 1];
      const dir = pos.direction === "LONG" ? 1 : -1;
      const exitFill = slip(last.close, pos.direction === "LONG" ? "sell" : "buy", slippagePct);
      const gross = dir * pos.qty * (exitFill - pos.entry);
      const fees = (Math.abs(pos.entry) + Math.abs(exitFill)) * pos.qty * (feePct / 100);
      const fundingCost = pos.fundingCost || 0;
      const net = gross - fees - fundingCost;
      equity += net;
      trades.push({
        asset: pos.asset,
        direction: pos.direction,
        entryTime: pos.entryTime,
        entry: pos.entry,
        initialStop: pos.initialStop,
        exitTime: last.time,
        exit: exitFill,
        exitReason: "end of data",
        qty: pos.qty,
        pnl: net,
        fundingCost,
        pnlPct: net / startEquity * 100,
        rMultiple: net / pos.riskAmount,
        barsHeld: daily.length - 1 - pos.entryIdx
      });
    }
    return { trades, equityCurve, finalEquity: equity, startEquity };
  }

  // trading/backtest/metrics.js
  function computeMetrics({ trades, equityCurve, startEquity }) {
    const n = trades.length;
    if (n === 0) {
      return {
        numTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        expectancy: 0,
        expectancyR: 0,
        profitFactor: 0,
        totalReturn: 0,
        totalReturnPct: 0,
        cagr: 0,
        maxDD: 0,
        maxDDPct: 0,
        maxDDDays: 0,
        avgBarsHeld: 0,
        bestTrade: null,
        worstTrade: null
      };
    }
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl <= 0);
    const sumWins = wins.reduce((s, t) => s + t.pnl, 0);
    const sumLosses = losses.reduce((s, t) => s + t.pnl, 0);
    const winRate = wins.length / n;
    const avgWin = wins.length ? sumWins / wins.length : 0;
    const avgLoss = losses.length ? sumLosses / losses.length : 0;
    const expectancy = trades.reduce((s, t) => s + t.pnl, 0) / n;
    const expectancyR = trades.reduce((s, t) => s + (t.rMultiple || 0), 0) / n;
    const profitFactor = sumLosses < 0 ? sumWins / Math.abs(sumLosses) : Infinity;
    const finalEq = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : startEquity;
    const totalReturn = finalEq - startEquity;
    const totalReturnPct = totalReturn / startEquity * 100;
    let years = 0;
    if (equityCurve.length >= 2) {
      const secs = equityCurve[equityCurve.length - 1].time - equityCurve[0].time;
      years = secs / (365.25 * 24 * 60 * 60);
    }
    const cagr = years > 0 && finalEq > 0 ? (Math.pow(finalEq / startEquity, 1 / years) - 1) * 100 : 0;
    let peak = startEquity;
    let peakTime = equityCurve[0]?.time || 0;
    let maxDD = 0;
    let maxDDPct = 0;
    let maxDDDays = 0;
    for (const pt of equityCurve) {
      if (pt.equity > peak) {
        peak = pt.equity;
        peakTime = pt.time;
      }
      const dd = peak - pt.equity;
      const ddPct = peak > 0 ? dd / peak * 100 : 0;
      if (ddPct > maxDDPct) {
        maxDDPct = ddPct;
        maxDD = dd;
        maxDDDays = (pt.time - peakTime) / 86400;
      }
    }
    const avgBarsHeld = trades.reduce((s, t) => s + (t.barsHeld || 0), 0) / n;
    const bestTrade = trades.reduce((b, t) => t.pnl > (b?.pnl ?? -Infinity) ? t : b, null);
    const worstTrade = trades.reduce((w, t) => t.pnl < (w?.pnl ?? Infinity) ? t : w, null);
    return {
      numTrades: n,
      winRate,
      avgWin,
      avgLoss,
      expectancy,
      expectancyR,
      profitFactor,
      totalReturn,
      totalReturnPct,
      cagr,
      maxDD,
      maxDDPct,
      maxDDDays,
      avgBarsHeld,
      bestTrade,
      worstTrade
    };
  }

  // trading/ui/backtest.js
  var UNIVERSE2 = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
  var START_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  var LS_KEY2 = "backtest.config.v1";
  var DEFAULT_CFG2 = { asset: "BTC", startYear: 2020, equity: 1e5, riskPct: 1, feePct: 0.08 };
  function loadCfg2() {
    try {
      const raw = localStorage.getItem(LS_KEY2);
      if (!raw) return { ...DEFAULT_CFG2 };
      return { ...DEFAULT_CFG2, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CFG2 };
    }
  }
  function saveCfg2(cfg) {
    try {
      localStorage.setItem(LS_KEY2, JSON.stringify(cfg));
    } catch {
    }
  }
  var CHART_OPTS = {
    height: 300,
    layout: { background: { color: "#0A0E1A" }, textColor: "#8B93A8" },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false }
  };
  var AREA_OPTS = {
    lineColor: "#0FD9A0",
    topColor: "rgba(15, 217, 160, 0.22)",
    bottomColor: "rgba(15, 217, 160, 0.02)",
    lineWidth: 2
  };
  function metricCard(label, value, sub, tone) {
    return el(
      "div",
      { class: "tr-metric" },
      el("div", { class: "tr-metric-label" }, label.toUpperCase()),
      el("div", { class: `tr-metric-value ${tone ? "tr-" + tone : ""}` }, value),
      sub ? el("div", { class: "tr-metric-sub" }, sub) : null
    );
  }
  var TRADE_COLS = ["#", "Dir", "Entry date", "Entry", "Exit date", "Exit", "Days", "PnL", "R", "Exit reason"];
  function mount2(root) {
    let cfg = loadCfg2();
    let chart = null;
    let series = null;
    const runBtn = el("button", { class: "btn btn-primary", type: "button", onClick: run }, "RUN BACKTEST");
    const statusEl = el("div", { class: "tr-status-line" });
    const chartDiv = el("div", { class: "tr-chart" });
    const resultsHost = el("div", { class: "tr-results" });
    const inputs = {
      asset: el(
        "select",
        { class: "tr-input", onChange: (e) => setCfg("asset", e.target.value) },
        ...UNIVERSE2.map((a) => el("option", { value: a, selected: a === cfg.asset }, binanceSymbol(a)))
      ),
      startYear: el(
        "select",
        { class: "tr-input", onChange: (e) => setCfg("startYear", e.target.value) },
        ...START_YEARS.map((y) => el("option", { value: y, selected: String(y) === String(cfg.startYear) }, String(y)))
      ),
      equity: el("input", { class: "tr-input", value: cfg.equity, onInput: (e) => setCfg("equity", e.target.value) }),
      riskPct: el("input", { class: "tr-input", value: cfg.riskPct, onInput: (e) => setCfg("riskPct", e.target.value) }),
      feePct: el("input", { class: "tr-input", value: cfg.feePct, onInput: (e) => setCfg("feePct", e.target.value) })
    };
    function setCfg(k, v) {
      cfg[k] = v;
      saveCfg2(cfg);
    }
    function field(label, control) {
      return el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, label), control);
    }
    function setStatus(message, kind) {
      clear(statusEl);
      if (message) statusEl.appendChild(el(
        "div",
        { class: `tr-status tr-status--${kind || "info"}` },
        (kind === "error" ? "\u26A0\uFE0F " : "") + message
      ));
    }
    function ensureChart() {
      if (chart || typeof window.LightweightCharts === "undefined") return;
      chart = window.LightweightCharts.createChart(chartDiv, {
        width: chartDiv.clientWidth || 800,
        ...CHART_OPTS
      });
      series = chart.addAreaSeries(AREA_OPTS);
    }
    function drawCurve(equityCurve) {
      ensureChart();
      if (!series) return;
      series.setData(equityCurve.map((p) => ({ time: p.time, value: p.equity })));
      try {
        chart.timeScale().fitContent();
      } catch {
      }
    }
    function renderResults(result) {
      clear(resultsHost);
      const m = result.metrics;
      const grid = el(
        "div",
        { class: "tr-metrics-grid" },
        metricCard("Trades", String(m.numTrades)),
        metricCard("Win rate", `${fmt(m.winRate * 100, 1)}%`),
        metricCard("Expectancy", `${fmt(m.expectancyR, 2)}R`, `${fmt(m.expectancy, 0)} USDT`),
        metricCard("Profit factor", m.profitFactor === Infinity ? "\u221E" : fmt(m.profitFactor, 2)),
        metricCard(
          "Total return",
          `${fmt(m.totalReturnPct, 1)}%`,
          `${fmt(m.totalReturn, 0)} USDT`,
          m.totalReturn > 0 ? "pos" : m.totalReturn < 0 ? "neg" : null
        ),
        metricCard("CAGR", `${fmt(m.cagr, 1)}%`),
        metricCard(
          "Max drawdown",
          `${fmt(m.maxDDPct, 1)}%`,
          `${fmt(m.maxDD, 0)} USDT / ${fmt(m.maxDDDays, 0)}d`,
          m.maxDDPct > 20 ? "neg" : null
        ),
        metricCard("Avg hold", `${fmt(m.avgBarsHeld, 0)} days`),
        metricCard("Avg win", fmt(m.avgWin, 0)),
        metricCard("Avg loss", fmt(m.avgLoss, 0)),
        metricCard("Best trade", fmt(m.bestTrade?.pnl, 0)),
        metricCard("Worst trade", fmt(m.worstTrade?.pnl, 0))
      );
      append(resultsHost, [grid]);
      if (m.maxDDPct > 20) {
        resultsHost.appendChild(el(
          "div",
          { class: "tr-warn-banner" },
          `\u26A0\uFE0F Max drawdown ${fmt(m.maxDDPct, 1)}% exceeds your 20% circuit-breaker threshold. Either reduce risk % or accept that you WILL see this drawdown live and plan for it.`
        ));
      }
      const tbody = el("tbody", null, ...result.trades.map((t, i) => el(
        "tr",
        null,
        el("td", { class: "tr-td" }, String(i + 1)),
        el("td", { class: `tr-td tr-strong ${t.direction === "LONG" ? "tr-pos" : "tr-neg"}` }, t.direction),
        el("td", { class: "tr-td" }, fmtDate(t.entryTime)),
        el("td", { class: "tr-td" }, fmt(t.entry, 4)),
        el("td", { class: "tr-td" }, fmtDate(t.exitTime)),
        el("td", { class: "tr-td" }, fmt(t.exit, 4)),
        el("td", { class: "tr-td" }, String(t.barsHeld)),
        el("td", { class: `tr-td ${t.pnl >= 0 ? "tr-pos" : "tr-neg"}` }, fmt(t.pnl, 0)),
        el("td", { class: `tr-td ${t.rMultiple >= 0 ? "tr-pos" : "tr-neg"}` }, fmt(t.rMultiple, 2)),
        el("td", { class: "tr-td tr-mut" }, t.exitReason)
      )));
      resultsHost.appendChild(el(
        "div",
        { class: "tr-table-wrap tr-table-wrap--tall" },
        el("div", { class: "tr-section-title tr-section-title--pad" }, `TRADES (${result.trades.length})`),
        el(
          "table",
          { class: "tr-table" },
          el("thead", null, el("tr", null, ...TRADE_COLS.map((c) => el("th", { class: "tr-th" }, c)))),
          tbody
        )
      ));
    }
    function renderEmpty() {
      clear(resultsHost);
      resultsHost.appendChild(el(
        "div",
        { class: "tr-empty" },
        "Pick asset + start year, click RUN BACKTEST. Single asset for now \u2014 portfolio-level replay (correlation caps, 1-entry-per-day across assets) comes later."
      ));
    }
    async function run() {
      runBtn.disabled = true;
      runBtn.textContent = "RUNNING...";
      setStatus("Fetching history...", "info");
      clear(resultsHost);
      try {
        const startTime = Date.UTC(Number(cfg.startYear), 0, 1);
        const [weeklyRaw, dailyRaw] = await Promise.all([
          fetchKlinesRange({ asset: cfg.asset, timeframe: "1W", startTime: startTime - 55 * 7 * 86400 * 1e3 }),
          fetchKlinesRange({ asset: cfg.asset, timeframe: "1D", startTime })
        ]);
        const weekly = dropUnclosedCandle(weeklyRaw);
        const daily = dropUnclosedCandle(dailyRaw);
        if (daily.length < 60) {
          throw new Error(`Only ${daily.length} daily candles \u2014 not enough history for ${cfg.asset} from ${cfg.startYear}.`);
        }
        setStatus(`Replaying ${daily.length} days...`, "info");
        const bt = backtestOne({
          asset: cfg.asset,
          weekly,
          daily,
          startEquity: Number(cfg.equity) || 1e5,
          riskPct: Number(cfg.riskPct) || 1,
          feePct: Number(cfg.feePct) || 0
        });
        const metrics = computeMetrics(bt);
        const result = { ...bt, metrics, candles: daily.length };
        drawCurve(result.equityCurve);
        renderResults(result);
        setStatus(`Done: ${daily.length} days, ${bt.trades.length} trades.`, "ok");
      } catch (e) {
        setStatus(e?.message || "Backtest failed.", "error");
        renderEmpty();
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = "RUN BACKTEST";
      }
    }
    const onResize = () => {
      if (chart) chart.applyOptions({ width: chartDiv.clientWidth || 800 });
    };
    clear(root);
    root.appendChild(
      el(
        "div",
        { class: "tr-view" },
        el(
          "div",
          { class: "tr-header" },
          el(
            "div",
            null,
            el("h1", { class: "tr-title" }, "BACKTEST"),
            el(
              "div",
              { class: "tr-subtitle" },
              "Same rules the Scanner runs live: weekly regime \u2192 daily Donchian-20 breakout \u2192 fixed-fractional risk \u2192 Donchian-10 trail. If you wouldn't have followed this equity curve through its worst stretch, don't trade it live."
            )
          ),
          el("div", { class: "tr-header-actions" }, runBtn)
        ),
        el(
          "div",
          { class: "tr-controls tr-controls--5" },
          field("ASSET", inputs.asset),
          field("FROM YEAR", inputs.startYear),
          field("START EQUITY", inputs.equity),
          field("RISK %", inputs.riskPct),
          field("FEE % (ROUND-TRIP)", inputs.feePct)
        ),
        statusEl,
        el(
          "div",
          { class: "tr-card" },
          el("div", { class: "tr-section-title" }, "EQUITY CURVE"),
          chartDiv
        ),
        resultsHost
      )
    );
    ensureChart();
    if (!chart) {
      setStatus("Chart library not loaded (CDN blocked?) \u2014 metrics and trades still work.", "warn");
    }
    renderEmpty();
    window.addEventListener("resize", onResize);
    return function cleanup() {
      window.removeEventListener("resize", onResize);
      try {
        chart?.remove();
      } catch {
      }
      chart = null;
      series = null;
    };
  }

  // trading/data/tradeLog.js
  var KEY = "tradeLog.v1";
  function loadTrades() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function saveTrades(arr) {
    try {
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch {
    }
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function addTrade(partial) {
    const trade = {
      id: uid(),
      status: "OPEN",
      exit: null,
      notes: "",
      systemSource: "scanner",
      ...partial
    };
    const all = loadTrades();
    all.push(trade);
    saveTrades(all);
    return trade;
  }
  function closeTrade(id, exit) {
    const all = loadTrades();
    const i = all.findIndex((t) => t.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], status: "CLOSED", exit };
    saveTrades(all);
    return all[i];
  }
  function updateTrade(id, patch) {
    const all = loadTrades();
    const i = all.findIndex((t) => t.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], ...patch };
    saveTrades(all);
    return all[i];
  }
  function deleteTrade(id) {
    const all = loadTrades().filter((t) => t.id !== id);
    saveTrades(all);
  }
  function importTrades(jsonString) {
    const data = JSON.parse(jsonString);
    if (!Array.isArray(data)) throw new Error("Import payload must be an array.");
    saveTrades(data);
    return data.length;
  }
  function exportTradesJSON() {
    return JSON.stringify(loadTrades(), null, 2);
  }
  function tradeToObsidianMarkdown(t) {
    const date = t.entry?.time ? new Date(t.entry.time * 1e3) : /* @__PURE__ */ new Date();
    const ymd2 = date.toISOString().slice(0, 10);
    const exitYmd = t.exit?.time ? new Date(t.exit.time * 1e3).toISOString().slice(0, 10) : null;
    const pnl = t.exit ? (t.direction === "LONG" ? 1 : -1) * t.entry.qty * (t.exit.price - t.entry.price) : null;
    const rMultiple = pnl !== null && t.entry?.riskDollar ? pnl / t.entry.riskDollar : null;
    const fm = {
      date: ymd2,
      asset: t.asset,
      direction: t.direction,
      status: t.status,
      entry: t.entry?.price,
      stop: t.entry?.stop,
      qty: t.entry?.qty,
      risk_dollar: t.entry?.riskDollar,
      leverage_used: t.entry?.leverage,
      exit_date: exitYmd,
      exit_price: t.exit?.price,
      exit_reason: t.exit?.reason,
      pnl_dollar: pnl,
      r_multiple: rMultiple,
      regime_state: t.regimeSnapshot?.state,
      weekly_sma50: t.regimeSnapshot?.sma,
      weekly_macd_hist: t.regimeSnapshot?.hist,
      weekly_adx: t.regimeSnapshot?.adx,
      weekly_rsi: t.regimeSnapshot?.rsi,
      daily_rsi: t.signalSnapshot?.rsi,
      daily_atr: t.signalSnapshot?.atr,
      source: t.systemSource,
      tags: ["trade", "mechanical-swing", t.asset.toLowerCase()]
    };
    const fmYaml = Object.entries(fm).map(([k, v]) => `${k}: ${formatYamlValue(v)}`).join("\n");
    const lines = [
      "---",
      fmYaml,
      "---",
      "",
      `# ${t.asset} ${t.direction} \u2014 ${ymd2}`,
      "",
      `**Status**: ${t.status}`,
      "",
      "## Entry",
      "",
      `- Time: ${date.toISOString()}`,
      `- Price: ${t.entry?.price}`,
      `- Stop: ${t.entry?.stop}`,
      `- Quantity: ${t.entry?.qty}`,
      `- Risk: $${t.entry?.riskDollar?.toFixed(2)}`,
      t.entry?.leverage != null ? `- Leverage: ${t.entry.leverage}x` : null,
      "",
      "## Regime snapshot (weekly, at entry)",
      "",
      t.regimeSnapshot ? [
        `- State: \`${t.regimeSnapshot.state}\``,
        `- 50W SMA: ${t.regimeSnapshot.sma?.toFixed?.(4)}`,
        `- MACD hist: ${t.regimeSnapshot.hist?.toFixed?.(4)}`,
        `- ADX: ${t.regimeSnapshot.adx?.toFixed?.(2)}`,
        `- RSI: ${t.regimeSnapshot.rsi?.toFixed?.(2)}`
      ].join("\n") : "_no snapshot captured_",
      "",
      "## Signal snapshot (daily, at entry)",
      "",
      t.signalSnapshot ? [
        `- Action: \`${t.signalSnapshot.action}\``,
        `- Reason: ${t.signalSnapshot.reason}`,
        `- Close: ${t.signalSnapshot.close}`,
        `- Daily RSI: ${t.signalSnapshot.rsi?.toFixed?.(2)}`,
        `- ATR(14): ${t.signalSnapshot.atr?.toFixed?.(4)}`
      ].join("\n") : "_no snapshot captured_",
      "",
      t.exit ? "## Exit\n" : null,
      t.exit ? `- Time: ${new Date(t.exit.time * 1e3).toISOString()}` : null,
      t.exit ? `- Price: ${t.exit.price}` : null,
      t.exit ? `- Reason: ${t.exit.reason}` : null,
      t.exit ? `- PnL: $${pnl?.toFixed(2)}` : null,
      t.exit ? `- R multiple: ${rMultiple?.toFixed(2)}` : null,
      "",
      "## Notes",
      "",
      t.notes || "_no notes_",
      "",
      "---",
      "_Auto-generated by Crypto Entry Checker. Schema v1._"
    ];
    return lines.filter((l) => l !== null).join("\n");
  }
  function obsidianFilename(t) {
    const date = t.entry?.time ? new Date(t.entry.time * 1e3) : /* @__PURE__ */ new Date();
    const ymd2 = date.toISOString().slice(0, 10);
    return `${ymd2}-${t.asset}-${t.direction}.md`;
  }
  function formatYamlValue(v) {
    if (v === null || v === void 0) return "null";
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
    if (Array.isArray(v)) return `[${v.map((x) => formatYamlValue(x)).join(", ")}]`;
    const s = String(v);
    if (/[:#\-?,&*!|>'"%@`{}[\]]/.test(s) || s.includes("\n")) {
      return JSON.stringify(s);
    }
    return s;
  }

  // trading/ui/tradelog.js
  var ASSETS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
  function tradePnl(t) {
    if (!t.exit) return null;
    return (t.direction === "LONG" ? 1 : -1) * t.entry.qty * (t.exit.price - t.entry.price);
  }
  function num2(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function today() {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
  function laneOf(t) {
    const s = (t.systemSource || "").toLowerCase();
    return s === "manual" || s === "discretionary" ? "DISCRETIONARY" : "SYSTEM";
  }
  function laneStats(trades) {
    let pnl = 0, wins = 0, losses = 0, rSum = 0;
    for (const t of trades) {
      const p = tradePnl(t) || 0;
      pnl += p;
      if (p > 0) wins++;
      else losses++;
      if (t.entry?.riskDollar) rSum += p / t.entry.riskDollar;
    }
    return { count: trades.length, wins, losses, pnl, avgR: trades.length ? rSum / trades.length : 0 };
  }
  function downloadBlob(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }
  function mount3(root) {
    const noticeEl = el("div");
    const statsEl = el("div", { class: "tr-lanes" });
    const openHost = el("div");
    const closedHost = el("div");
    let modalEl = null;
    function notice(msg, ms = 3e3) {
      clear(noticeEl);
      if (!msg) return;
      noticeEl.appendChild(el("div", { class: "tr-notice" }, msg));
      if (ms) setTimeout(() => clear(noticeEl), ms);
    }
    function statCard(label, value, tone) {
      return el(
        "div",
        { class: "tr-stat" },
        el("div", { class: "tr-metric-label" }, label.toUpperCase()),
        el("div", { class: `tr-stat-value ${tone ? "tr-" + tone : ""}` }, value)
      );
    }
    function closeModal() {
      if (modalEl) {
        modalEl.remove();
        modalEl = null;
      }
    }
    function openModal(title, body, onSave) {
      closeModal();
      const card2 = el(
        "div",
        { class: "tr-modal", onClick: (e) => e.stopPropagation() },
        el(
          "div",
          { class: "tr-modal-head" },
          el("div", { class: "tr-modal-title" }, title),
          el("button", { class: "tr-modal-x", type: "button", onClick: closeModal }, "\xD7")
        ),
        el("div", { class: "tr-modal-body" }, ...body),
        el(
          "div",
          { class: "tr-modal-foot" },
          el("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: closeModal }, "CANCEL"),
          el("button", { class: "btn btn-primary btn-sm", type: "button", onClick: onSave }, "SAVE")
        )
      );
      modalEl = el("div", { class: "tr-overlay", onClick: closeModal }, card2);
      root.appendChild(modalEl);
    }
    function field(label, control) {
      return el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, label), control);
    }
    function actionButton(label, onClick, kind, title) {
      return el("button", {
        class: `tr-act ${kind ? "tr-act--" + kind : ""}`,
        type: "button",
        onClick,
        title: title || label
      }, label);
    }
    function laneCards(s, openCount) {
      return [
        statCard("Open", String(openCount)),
        statCard("Closed", String(s.count)),
        statCard("Wins / Losses", `${s.wins} / ${s.losses}`),
        statCard("Win rate", s.count ? `${(s.wins / s.count * 100).toFixed(1)}%` : "-"),
        statCard("Realized PnL", `${fmt(s.pnl, 2)} USDT`, s.pnl > 0 ? "pos" : s.pnl < 0 ? "neg" : null),
        statCard("Avg R", fmt(s.avgR, 2))
      ];
    }
    function tradeTable(trades, showClose) {
      const head = ["Date", "Lane", "Asset", "Dir", "Entry", "Stop", "Qty", "Risk $", "Exit", "PnL", "R", "Actions"];
      const body = el("tbody", null, ...trades.map((t) => {
        const pnl = tradePnl(t);
        const r2 = pnl !== null && t.entry?.riskDollar ? pnl / t.entry.riskDollar : null;
        const pnlTone = pnl > 0 ? "tr-pos" : pnl < 0 ? "tr-neg" : "tr-mut";
        const lane = laneOf(t);
        return el(
          "tr",
          null,
          el("td", { class: "tr-td" }, ymd(t.entry?.time)),
          el("td", { class: "tr-td" }, el("span", { class: `tr-lane-badge tr-lane-badge--${lane === "SYSTEM" ? "sys" : "disc"}` }, lane === "SYSTEM" ? "SYS" : "DISC")),
          el("td", { class: "tr-td tr-strong" }, t.asset),
          el("td", { class: `tr-td tr-strong ${t.direction === "LONG" ? "tr-pos" : "tr-neg"}` }, t.direction),
          el("td", { class: "tr-td" }, fmt(t.entry?.price, 4)),
          el("td", { class: "tr-td" }, fmt(t.entry?.stop, 4)),
          el("td", { class: "tr-td" }, fmt(t.entry?.qty, 6)),
          el("td", { class: "tr-td" }, fmt(t.entry?.riskDollar, 2)),
          el("td", { class: "tr-td" }, t.exit ? `${ymd(t.exit.time)} @ ${fmt(t.exit.price, 4)}` : "-"),
          el("td", { class: `tr-td ${pnlTone}` }, fmt(pnl, 2)),
          el("td", { class: "tr-td" }, fmt(r2, 2)),
          el("td", { class: "tr-td" }, el(
            "div",
            { class: "tr-act-row" },
            showClose ? actionButton("close", () => openCloseModal(t)) : null,
            actionButton("edit", () => openEditModal(t)),
            actionButton("md", () => copyMd(t), null, "Copy Markdown"),
            actionButton("\u2193", () => downloadBlob(obsidianFilename(t), tradeToObsidianMarkdown(t), "text/markdown"), null, "Download .md"),
            actionButton("\xD7", () => removeTrade(t), "danger", "Delete")
          ))
        );
      }));
      return el(
        "div",
        { class: "tr-table-wrap" },
        el(
          "table",
          { class: "tr-table" },
          el("thead", null, el("tr", null, ...head.map((h) => el("th", { class: "tr-th" }, h)))),
          body
        )
      );
    }
    function section(title, content) {
      return el("div", { class: "tr-section" }, el("div", { class: "tr-section-title" }, title), content);
    }
    function empty(text) {
      return el("div", { class: "tr-empty" }, text);
    }
    function copyMd(t) {
      navigator.clipboard?.writeText(tradeToObsidianMarkdown(t)).then(() => notice(`Copied ${obsidianFilename(t)} to clipboard.`)).catch(() => notice("Clipboard unavailable."));
    }
    function removeTrade(t) {
      if (confirm("Delete this trade?")) {
        deleteTrade(t.id);
        render();
      }
    }
    function handleImport(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const n = importTrades(String(reader.result));
          render();
          notice(`Imported ${n} trades.`);
        } catch (err) {
          notice(`Import error: ${err.message}`, 5e3);
        }
      };
      reader.readAsText(file);
    }
    function openCloseModal(t) {
      const exitDate = el("input", { class: "tr-input", type: "date", value: t.exit?.time ? ymd(t.exit.time) : today() });
      const exitPrice = el("input", { class: "tr-input", value: t.exit?.price ?? "" });
      const reason = el(
        "select",
        { class: "tr-input" },
        ...["trailing stop hit", "regime flip", "discretionary exit", "manual stop"].map((rv) => el("option", { value: rv, selected: (t.exit?.reason ?? "trailing stop hit") === rv }, rv))
      );
      openModal("CLOSE TRADE", [
        el("div", { class: "tr-grid-2" }, field("Exit date", exitDate), field("Exit price", exitPrice)),
        field("Reason", reason)
      ], () => {
        closeTrade(t.id, {
          time: Math.floor((/* @__PURE__ */ new Date(exitDate.value + "T12:00:00Z")).getTime() / 1e3),
          price: num2(exitPrice.value),
          reason: reason.value
        });
        closeModal();
        render();
      });
    }
    function openEditModal(t) {
      const notes = el("textarea", { class: "tr-input tr-textarea" });
      notes.value = t.notes ?? "";
      openModal("EDIT TRADE", [field("Notes", notes)], () => {
        updateTrade(t.id, { notes: notes.value });
        closeModal();
        render();
      });
    }
    function openNewModal() {
      const f = {
        asset: el("select", { class: "tr-input" }, ...ASSETS.map((a) => el("option", { value: a }, a))),
        direction: el("select", { class: "tr-input" }, el("option", { value: "LONG" }, "LONG"), el("option", { value: "SHORT" }, "SHORT")),
        lane: el(
          "select",
          { class: "tr-input" },
          el("option", { value: "system" }, "SYSTEM (scanner signal)"),
          el("option", { value: "discretionary" }, "DISCRETIONARY (Cipher / judgment)")
        ),
        entryDate: el("input", { class: "tr-input", type: "date", value: today() }),
        price: el("input", { class: "tr-input" }),
        stop: el("input", { class: "tr-input" }),
        qty: el("input", { class: "tr-input" }),
        riskDollar: el("input", { class: "tr-input" }),
        leverage: el("input", { class: "tr-input" }),
        regimeState: el("select", { class: "tr-input" }, ...["LONG_OK", "SHORT_OK", "FLAT", "WARMUP"].map((s) => el("option", { value: s }, s))),
        weeklySma: el("input", { class: "tr-input" }),
        weeklyHist: el("input", { class: "tr-input" }),
        weeklyAdx: el("input", { class: "tr-input" }),
        weeklyRsi: el("input", { class: "tr-input" }),
        dailyClose: el("input", { class: "tr-input" }),
        dailyRsi: el("input", { class: "tr-input" }),
        dailyAtr: el("input", { class: "tr-input" }),
        signalReason: el("input", { class: "tr-input" }),
        notes: el("textarea", { class: "tr-input tr-textarea" })
      };
      openModal("NEW TRADE", [
        el(
          "div",
          { class: "tr-grid-2" },
          field("Asset", f.asset),
          field("Direction", f.direction),
          field("Lane", f.lane),
          field("Entry date", f.entryDate),
          field("Entry price", f.price),
          field("Stop price", f.stop),
          field("Quantity", f.qty),
          field("Risk $", f.riskDollar),
          field("Leverage", f.leverage)
        ),
        el("div", { class: "tr-section-title tr-section-title--sub" }, "WEEKLY REGIME (at entry)"),
        el(
          "div",
          { class: "tr-grid-4" },
          field("State", f.regimeState),
          field("50W SMA", f.weeklySma),
          field("MACD hist", f.weeklyHist),
          field("ADX", f.weeklyAdx),
          field("RSI", f.weeklyRsi)
        ),
        el("div", { class: "tr-section-title tr-section-title--sub" }, "DAILY SIGNAL (at entry)"),
        el(
          "div",
          { class: "tr-grid-4" },
          field("Close", f.dailyClose),
          field("RSI(14)", f.dailyRsi),
          field("ATR(14)", f.dailyAtr),
          field("Reason / setup", f.signalReason)
        ),
        field("Notes", f.notes)
      ], () => {
        const entryTime = Math.floor((/* @__PURE__ */ new Date(f.entryDate.value + "T12:00:00Z")).getTime() / 1e3);
        addTrade({
          asset: f.asset.value,
          direction: f.direction.value,
          entry: {
            time: entryTime,
            price: num2(f.price.value),
            stop: num2(f.stop.value),
            qty: num2(f.qty.value),
            riskDollar: num2(f.riskDollar.value),
            leverage: num2(f.leverage.value)
          },
          regimeSnapshot: {
            state: f.regimeState.value,
            sma: num2(f.weeklySma.value),
            hist: num2(f.weeklyHist.value),
            adx: num2(f.weeklyAdx.value),
            rsi: num2(f.weeklyRsi.value)
          },
          signalSnapshot: {
            action: f.direction.value,
            reason: f.signalReason.value,
            close: num2(f.dailyClose.value),
            rsi: num2(f.dailyRsi.value),
            atr: num2(f.dailyAtr.value)
          },
          notes: f.notes.value,
          systemSource: f.lane.value
        });
        closeModal();
        render();
      });
    }
    function render() {
      const trades = loadTrades();
      const open = trades.filter((t) => t.status === "OPEN");
      const closed = trades.filter((t) => t.status === "CLOSED");
      const sys = laneStats(closed.filter((t) => laneOf(t) === "SYSTEM"));
      const disc = laneStats(closed.filter((t) => laneOf(t) === "DISCRETIONARY"));
      const openSys = open.filter((t) => laneOf(t) === "SYSTEM").length;
      const openDisc = open.filter((t) => laneOf(t) === "DISCRETIONARY").length;
      clear(statsEl);
      append(statsEl, [
        el("div", { class: "tr-lane-label" }, "SYSTEM LANE (mechanical v2.0 \u2014 followed to the dot)"),
        el("div", { class: "tr-stats" }, ...laneCards(sys, openSys)),
        el("div", { class: "tr-lane-label" }, "DISCRETIONARY LANE (Market Cipher / your judgment)"),
        el("div", { class: "tr-stats" }, ...laneCards(disc, openDisc))
      ]);
      clear(openHost);
      openHost.appendChild(section(
        "OPEN POSITIONS",
        open.length ? tradeTable(open, true) : empty("No open positions.")
      ));
      clear(closedHost);
      closedHost.appendChild(section(
        "CLOSED",
        closed.length ? tradeTable(closed.slice().reverse(), false) : empty("No closed trades yet.")
      ));
    }
    const importInput = el("input", {
      type: "file",
      accept: "application/json",
      class: "tr-hidden-file",
      onChange: (e) => {
        const file = e.target.files?.[0];
        if (file) handleImport(file);
        e.target.value = "";
      }
    });
    clear(root);
    root.appendChild(
      el(
        "div",
        { class: "tr-view" },
        el(
          "div",
          { class: "tr-header" },
          el(
            "div",
            null,
            el("h1", { class: "tr-title" }, "TRADE LOG"),
            el(
              "div",
              { class: "tr-subtitle" },
              "Persisted in this browser. Every trade exports as Obsidian-flavored Markdown with YAML frontmatter \u2014 drop the file into your vault and your Memory Wiki indexes it."
            )
          ),
          el(
            "div",
            { class: "tr-header-actions" },
            el("button", { class: "btn btn-primary", type: "button", onClick: openNewModal }, "NEW TRADE"),
            el("button", {
              class: "btn btn-ghost btn-sm",
              type: "button",
              onClick: () => downloadBlob(`trades-${today()}.json`, exportTradesJSON(), "application/json")
            }, "EXPORT JSON"),
            el("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: () => importInput.click() }, "IMPORT JSON"),
            el("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: exportAllMd }, "EXPORT ALL TO MD"),
            importInput
          )
        ),
        noticeEl,
        statsEl,
        openHost,
        closedHost
      )
    );
    function exportAllMd() {
      const trades = loadTrades();
      if (!trades.length) {
        notice("No trades to export.");
        return;
      }
      const combined = trades.map((t) => `

<!-- file: ${obsidianFilename(t)} -->
${tradeToObsidianMarkdown(t)}`).join("\n");
      downloadBlob(`trades-bundle-${today()}.md`, combined, "text/markdown");
    }
    render();
    return function cleanup() {
      closeModal();
    };
  }

  // trading/options/payoff.js
  function legIntrinsic(type, strike, spot) {
    return type === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  }
  function legPayoff(leg, spot) {
    const qty = leg.qty ?? 1;
    const dir = leg.side === "short" ? -1 : 1;
    return dir * qty * (legIntrinsic(leg.type, leg.strike, spot) - leg.premium);
  }
  function payoffAt(legs, spot) {
    let sum = 0;
    for (const leg of legs) sum += legPayoff(leg, spot);
    return sum;
  }
  function netCost(legs) {
    let cost = 0;
    for (const leg of legs) {
      const qty = leg.qty ?? 1;
      cost += (leg.side === "short" ? -1 : 1) * qty * leg.premium;
    }
    return cost;
  }
  function payoffCurve(legs, smin, smax, steps = 240) {
    const pts = [];
    const span = smax - smin || 1;
    for (let i = 0; i <= steps; i++) {
      const s = smin + span * i / steps;
      pts.push({ s, pnl: payoffAt(legs, s) });
    }
    return pts;
  }
  function tailSlopes(legs) {
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
  function breakevens(legs, smin, smax, steps = 2e3) {
    const span = smax - smin || 1;
    const out = [];
    let prevS = smin;
    let prevP = payoffAt(legs, smin);
    for (let i = 1; i <= steps; i++) {
      const s = smin + span * i / steps;
      const p = payoffAt(legs, s);
      if (prevP < 0 && p >= 0 || prevP > 0 && p <= 0) {
        out.push(p === prevP ? s : prevS + (0 - prevP) * (s - prevS) / (p - prevP));
      }
      prevS = s;
      prevP = p;
    }
    return out.filter((v, i) => i === 0 || Math.abs(v - out[i - 1]) > span * 1e-4);
  }
  function analyze(legs, opts = {}) {
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
    if (right > 0) maxProfit = Infinity;
    if (right < 0) maxLoss = -Infinity;
    return {
      netCost: netCost(legs),
      maxProfit,
      maxLoss,
      breakevens: breakevens(legs, 0, smax)
    };
  }

  // trading/options/strategies.js
  var r = (x) => Math.round(x * 100) / 100;
  var DEFAULT_SPOT = 100;
  var STRATEGIES = [
    {
      id: "long-call",
      name: "Long Call",
      blurb: "Buy a call. Bullish; loss capped at the premium, upside unlimited.",
      when: "You're bullish and expect a meaningful rally before expiry, but want your downside capped at the premium paid.",
      build: (s) => [{ type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 }]
    },
    {
      id: "long-put",
      name: "Long Put",
      blurb: "Buy a put. Bearish; loss capped at the premium, profit grows as price falls.",
      when: "You're bearish and expect a drop \u2014 or you already hold the underlying and want crash protection (a hedge).",
      build: (s) => [{ type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 }]
    },
    {
      id: "short-call",
      name: "Short Call",
      blurb: "Sell a call. Collect premium; profit capped, loss unlimited if price rises.",
      when: "You're neutral-to-bearish and expect price to stay below the strike. Selling premium for income \u2014 safest when you own the underlying (a covered call) rather than naked.",
      build: (s) => [{ type: "call", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 }]
    },
    {
      id: "short-put",
      name: "Short Put",
      blurb: "Sell a put. Collect premium; profit capped, loss grows as price falls.",
      when: "You're neutral-to-bullish and would be happy to buy the underlying at the strike. You pocket the premium while you wait, and get assigned the shares if it falls.",
      build: (s) => [{ type: "put", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 }]
    },
    {
      id: "long-straddle",
      name: "Long Straddle",
      blurb: "Buy a call and a put at the same strike. Profits from a large move either way.",
      when: "You expect a big move but don't know the direction \u2014 earnings, a ruling, a token unlock \u2014 and think volatility is underpriced. You lose if the price stays flat.",
      build: (s) => [
        { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
        { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 }
      ]
    },
    {
      id: "short-straddle",
      name: "Short Straddle",
      blurb: "Sell a call and a put at the same strike. Profits if price stays put; big tails risk.",
      when: "You expect the price to sit still and volatility to fall (e.g. right after an event). You collect premium and accept large, potentially unlimited tail risk.",
      build: (s) => [
        { type: "call", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 },
        { type: "put", side: "short", strike: r(s), premium: r(s * 0.05), qty: 1 }
      ]
    },
    {
      id: "long-strangle",
      name: "Long Strangle",
      blurb: "Buy an OTM call and an OTM put. Cheaper than a straddle; needs a bigger move.",
      when: "Same 'big move, unknown direction' bet as a straddle, but cheaper \u2014 used when you want lower cost and expect an even larger swing to clear the wider strikes.",
      build: (s) => [
        { type: "put", side: "long", strike: r(s * 0.9), premium: r(s * 0.03), qty: 1 },
        { type: "call", side: "long", strike: r(s * 1.1), premium: r(s * 0.03), qty: 1 }
      ]
    },
    {
      id: "strip",
      name: "Strip",
      blurb: "Long 1 call + 2 puts at the same strike. A straddle tilted bearish.",
      when: "You expect a big move and lean bearish \u2014 it profits either way but pays out twice as fast on the downside.",
      build: (s) => [
        { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
        { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 2 }
      ]
    },
    {
      id: "strap",
      name: "Strap",
      blurb: "Long 2 calls + 1 put at the same strike. A straddle tilted bullish.",
      when: "You expect a big move and lean bullish \u2014 it profits either way but pays out twice as fast on the upside.",
      build: (s) => [
        { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 2 },
        { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 }
      ]
    },
    {
      id: "bull-call-spread",
      name: "Bull Call Spread",
      blurb: "Buy a call, sell a higher-strike call. Capped profit, capped loss, net debit.",
      when: "You're moderately bullish to a target price, not a runaway rally. Selling the higher call cheapens the trade and caps both cost and profit.",
      build: (s) => [
        { type: "call", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
        { type: "call", side: "short", strike: r(s * 1.1), premium: r(s * 0.02), qty: 1 }
      ]
    },
    {
      id: "bear-put-spread",
      name: "Bear Put Spread",
      blurb: "Buy a put, sell a lower-strike put. Capped profit, capped loss, net debit.",
      when: "You're moderately bearish to a target price. Defined risk and reward, and cheaper than a naked put because the short put offsets some cost.",
      build: (s) => [
        { type: "put", side: "long", strike: r(s), premium: r(s * 0.05), qty: 1 },
        { type: "put", side: "short", strike: r(s * 0.9), premium: r(s * 0.02), qty: 1 }
      ]
    },
    {
      id: "long-butterfly",
      name: "Long Call Butterfly",
      blurb: "Long 1 low + 1 high call, short 2 middle calls. Profits if price pins the middle.",
      when: "You expect the price to pin near a specific level at expiry (low volatility). A cheap, small, defined-risk bet that pays best if it lands on the body strike.",
      build: (s) => [
        { type: "call", side: "long", strike: r(s * 0.9), premium: r(s * 0.12), qty: 1 },
        { type: "call", side: "short", strike: r(s), premium: r(s * 0.05), qty: 2 },
        { type: "call", side: "long", strike: r(s * 1.1), premium: r(s * 0.015), qty: 1 }
      ]
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
        { type: "call", side: "long", strike: r(s * 1.2), premium: r(s * 0.01), qty: 1 }
      ]
    }
  ];
  function strategyById(id) {
    return STRATEGIES.find((s) => s.id === id) || null;
  }

  // trading/ui/options.js
  var num3 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  var round2 = (x) => Math.round(x * 100) / 100;
  function niceTicks(min, max, count) {
    if (!(max > min)) return [min];
    const step0 = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 0.5; v += step) {
      ticks.push(Number(v.toFixed(10)));
    }
    return ticks;
  }
  var chartSeq = 0;
  function buildChart(legs, spot) {
    const W = 900;
    const H = 440;
    const m = { left: 62, right: 20, top: 22, bottom: 34 };
    const plotW = W - m.left - m.right;
    const plotH = H - m.top - m.bottom;
    const strikes = legs.map((l) => num3(l.strike));
    const refLo = Math.min(spot, ...strikes);
    const refHi = Math.max(spot, ...strikes);
    const pad = Math.max((refHi - refLo) * 0.6, spot * 0.25, 1);
    const smin = Math.max(0, refLo - pad);
    const smax = refHi + pad || refHi + 1;
    const pts = payoffCurve(legs, smin, smax, 240);
    let ymin = 0;
    let ymax = 0;
    for (const p of pts) {
      if (p.pnl < ymin) ymin = p.pnl;
      if (p.pnl > ymax) ymax = p.pnl;
    }
    if (ymin === ymax) {
      ymin -= 1;
      ymax += 1;
    }
    const yp = (ymax - ymin) * 0.12;
    ymin -= yp;
    ymax += yp;
    const X = (s) => m.left + (s - smin) / (smax - smin) * plotW;
    const Y = (v) => m.top + (ymax - v) / (ymax - ymin) * plotH;
    const zeroY = Y(0);
    const id = `oc${++chartSeq}`;
    const curve = pts.map((p) => `${X(p.s).toFixed(1)},${Y(p.pnl).toFixed(1)}`).join(" ");
    const area = `M ${X(pts[0].s).toFixed(1)} ${zeroY.toFixed(1)} ` + pts.map((p) => `L ${X(p.s).toFixed(1)} ${Y(p.pnl).toFixed(1)}`).join(" ") + ` L ${X(pts[pts.length - 1].s).toFixed(1)} ${zeroY.toFixed(1)} Z`;
    const kids = [];
    kids.push(svgEl(
      "defs",
      null,
      svgEl("clipPath", { id: `${id}-p` }, svgEl("rect", { x: m.left, y: m.top, width: plotW, height: Math.max(0, zeroY - m.top) })),
      svgEl("clipPath", { id: `${id}-l` }, svgEl("rect", { x: m.left, y: zeroY, width: plotW, height: Math.max(0, m.top + plotH - zeroY) }))
    ));
    kids.push(svgEl("path", { d: area, fill: "rgba(15,217,160,0.16)", "clip-path": `url(#${id}-p)` }));
    kids.push(svgEl("path", { d: area, fill: "rgba(248,113,113,0.16)", "clip-path": `url(#${id}-l)` }));
    for (const t of niceTicks(ymin, ymax, 5)) {
      const y = Y(t);
      kids.push(svgEl("line", { x1: m.left, y1: y, x2: m.left + plotW, y2: y, stroke: "rgba(255,255,255,0.06)" }));
      kids.push(svgEl("text", { x: m.left - 8, y: y + 3, "text-anchor": "end", fill: "#4A5268", "font-size": 10, "font-family": "monospace", text: fmt(t, 0) }));
    }
    for (const t of niceTicks(smin, smax, 6)) {
      const x = X(t);
      kids.push(svgEl("line", { x1: x, y1: m.top, x2: x, y2: m.top + plotH, stroke: "rgba(255,255,255,0.05)" }));
      kids.push(svgEl("text", { x, y: m.top + plotH + 16, "text-anchor": "middle", fill: "#4A5268", "font-size": 10, "font-family": "monospace", text: fmt(t, t < 10 ? 1 : 0) }));
    }
    kids.push(svgEl("line", { x1: m.left, y1: zeroY, x2: m.left + plotW, y2: zeroY, stroke: "#8B93A8", "stroke-dasharray": "4 3" }));
    if (spot >= smin && spot <= smax) {
      const xs = X(spot);
      kids.push(svgEl("line", { x1: xs, y1: m.top, x2: xs, y2: m.top + plotH, stroke: "#F5A623", "stroke-dasharray": "2 3" }));
      kids.push(svgEl("text", { x: xs, y: m.top - 7, "text-anchor": "middle", fill: "#F5A623", "font-size": 10, "font-family": "monospace", text: "SPOT" }));
    }
    for (const b of breakevens(legs, smin, smax)) {
      const xb = X(b);
      kids.push(svgEl("circle", { cx: xb, cy: zeroY, r: 3.5, fill: "#EDF0F7" }));
      kids.push(svgEl("text", { x: xb, y: zeroY - 8, "text-anchor": "middle", fill: "#EDF0F7", "font-size": 10, "font-family": "monospace", text: fmt(b, b < 10 ? 2 : 0) }));
    }
    kids.push(svgEl("polyline", { points: curve, fill: "none", stroke: "#0FD9A0", "stroke-width": 2 }));
    kids.push(svgEl("rect", { x: m.left, y: m.top, width: plotW, height: plotH, fill: "none", stroke: "rgba(255,255,255,0.12)" }));
    return svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`,
      width: "100%",
      height: "auto",
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Option payoff diagram"
    }, ...kids);
  }
  function card(label, value, tone, sub) {
    return el(
      "div",
      { class: "tr-metric" },
      el("div", { class: "tr-metric-label" }, label.toUpperCase()),
      el("div", { class: `tr-metric-value ${tone ? "tr-" + tone : ""}` }, value),
      sub ? el("div", { class: "tr-metric-sub" }, sub) : null
    );
  }
  function summaryCards(legs, spot) {
    const a = analyze(legs, { spot });
    const cost = a.netCost;
    const costSub = cost > 0 ? "you pay (debit)" : cost < 0 ? "you receive (credit)" : "even";
    return [
      card("Net cost", fmt(Math.abs(cost), 2), cost > 0 ? "neg" : cost < 0 ? "pos" : null, costSub),
      card("Max profit", a.maxProfit === Infinity ? "Unlimited" : fmt(a.maxProfit, 2), "pos"),
      card("Max loss", a.maxLoss === -Infinity ? "Unlimited" : fmt(a.maxLoss, 2), "neg"),
      card("Breakeven", a.breakevens.length ? a.breakevens.map((b) => fmt(b, b < 10 ? 2 : 0)).join("  \xB7  ") : "\u2014")
    ];
  }
  function mount4(root) {
    let spot = DEFAULT_SPOT;
    let strategyId = "long-straddle";
    let legs = strategyById(strategyId).build(spot);
    const blurbEl = el("div", { class: "tr-opt-blurb" });
    const legsHost = el("div", { class: "tr-opt-legs" });
    const diagramHost = el("div", { class: "tr-opt-diagram" });
    const summaryHost = el("div", { class: "tr-opt-summary" });
    function selectEl(options, value, onChange) {
      return el(
        "select",
        { class: "tr-input", onChange: (e) => onChange(e.target.value) },
        ...options.map((o) => el("option", { value: o, selected: o === value }, o.toUpperCase()))
      );
    }
    function numInput(value, onInput) {
      return el("input", { class: "tr-input", value, inputmode: "decimal", onInput: (e) => onInput(num3(e.target.value)) });
    }
    function renderLegs() {
      clear(legsHost);
      legsHost.appendChild(el(
        "div",
        { class: "tr-opt-leg tr-opt-leg--head" },
        el("span", null, "SIDE"),
        el("span", null, "TYPE"),
        el("span", null, "STRIKE"),
        el("span", null, "PREMIUM"),
        el("span", null, "QTY"),
        el("span", null, "")
      ));
      legs.forEach((leg, i) => {
        legsHost.appendChild(el(
          "div",
          { class: "tr-opt-leg" },
          selectEl(["long", "short"], leg.side, (v) => {
            leg.side = v;
            renderDiagram();
          }),
          selectEl(["call", "put"], leg.type, (v) => {
            leg.type = v;
            renderDiagram();
          }),
          numInput(leg.strike, (v) => {
            leg.strike = v;
            renderDiagram();
          }),
          numInput(leg.premium, (v) => {
            leg.premium = v;
            renderDiagram();
          }),
          numInput(leg.qty ?? 1, (v) => {
            leg.qty = v;
            renderDiagram();
          }),
          el("button", {
            class: "tr-act tr-act--danger",
            type: "button",
            title: "Remove leg",
            onClick: () => {
              legs.splice(i, 1);
              renderLegs();
              renderDiagram();
            }
          }, "\xD7")
        ));
      });
    }
    function renderDiagram() {
      clear(diagramHost);
      clear(summaryHost);
      if (!legs.length) {
        diagramHost.appendChild(el("div", { class: "tr-empty" }, "Add at least one leg to see a payoff."));
        return;
      }
      diagramHost.appendChild(buildChart(legs, num3(spot)));
      append(summaryHost, summaryCards(legs, num3(spot)));
    }
    function setStrategy(id) {
      const strat = strategyById(id);
      if (!strat) return;
      strategyId = id;
      legs = strat.build(num3(spot) || DEFAULT_SPOT);
      clear(blurbEl);
      blurbEl.appendChild(el("div", { class: "tr-opt-blurb-what" }, strat.blurb));
      blurbEl.appendChild(el(
        "div",
        { class: "tr-opt-blurb-when" },
        el("strong", null, "When to use: "),
        strat.when
      ));
      renderLegs();
      renderDiagram();
    }
    const stratSelect = el(
      "select",
      { class: "tr-input", onChange: (e) => setStrategy(e.target.value) },
      ...STRATEGIES.map((s) => el("option", { value: s.id, selected: s.id === strategyId }, s.name))
    );
    const spotInput = el("input", {
      class: "tr-input",
      value: spot,
      inputmode: "decimal",
      onInput: (e) => {
        spot = num3(e.target.value);
        renderDiagram();
      }
    });
    clear(root);
    root.appendChild(el(
      "div",
      { class: "tr-view" },
      el(
        "div",
        { class: "tr-header" },
        el(
          "div",
          null,
          el("h1", { class: "tr-title" }, "OPTIONS PAYOFFS"),
          el(
            "div",
            { class: "tr-subtitle" },
            "Build a multi-leg options position and see its profit/loss at expiration. Pick a preset \u2014 straddle, strangle, strip, strap, spreads \u2014 or edit the legs directly."
          )
        )
      ),
      el(
        "div",
        { class: "tr-controls tr-controls--opt" },
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "STRATEGY"), stratSelect),
        el("div", { class: "tr-field" }, el("label", { class: "tr-label" }, "SPOT / UNDERLYING"), spotInput)
      ),
      blurbEl,
      el(
        "div",
        { class: "tr-opt-legs-wrap" },
        legsHost,
        el("button", {
          class: "btn btn-ghost btn-sm",
          type: "button",
          onClick: () => {
            legs.push({ type: "call", side: "long", strike: num3(spot), premium: round2(num3(spot) * 0.05), qty: 1 });
            renderLegs();
            renderDiagram();
          }
        }, "+ ADD LEG")
      ),
      el(
        "div",
        { class: "tr-card" },
        el("div", { class: "tr-section-title" }, "PAYOFF AT EXPIRATION"),
        diagramHost
      ),
      summaryHost,
      el(
        "div",
        { class: "tr-foot" },
        "Payoff is per 1 unit of the underlying at expiration. Premiums are editable illustrative defaults, not live option prices. Green = profit, red = loss; the amber line marks spot."
      )
    ));
    setStrategy(strategyId);
  }

  // trading/ui/app.js
  function mountLattice(root) {
    root.innerHTML = "";
    const f = document.createElement("iframe");
    f.src = "../lattice.html?embed=1";
    f.title = "Lattice \u2014 options pricer";
    f.style.cssText = "width:100%;border:0;display:block;min-height:calc(100vh - 120px);background:#05080F;";
    root.appendChild(f);
    return () => {
      root.innerHTML = "";
    };
  }
  var ROUTES = {
    scanner: mount,
    backtest: mount2,
    log: mount3,
    options: mount4,
    lattice: mountLattice
  };
  var DEFAULT = "scanner";
  function currentRoute() {
    const key = (window.location.hash || "").replace(/^#\/?/, "").trim();
    return ROUTES[key] ? key : DEFAULT;
  }
  function init() {
    const root = document.getElementById("trading-root");
    if (!root) return;
    const links = {};
    document.querySelectorAll("[data-route]").forEach((a) => {
      links[a.dataset.route] = a;
    });
    let cleanup = null;
    function navigate() {
      const key = currentRoute();
      if (typeof cleanup === "function") {
        try {
          cleanup();
        } catch {
        }
      }
      cleanup = ROUTES[key](root) || null;
      for (const [k, a] of Object.entries(links)) {
        a.classList.toggle("tr-subnav--active", k === key);
      }
      window.scrollTo({ top: 0 });
    }
    window.addEventListener("hashchange", navigate);
    navigate();
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
