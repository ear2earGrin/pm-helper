// ============================================================
//  Crypto trade log — private per partner
//  Backed by public.pmh_trades (Supabase; RLS: each partner sees
//  ONLY their own rows — enforced server-side by pmh_username()).
//
//  Position model: the opening entry lives on the row (opened_at,
//  entry_price, quantity). Every later change is an event in the
//  `partials` jsonb array: { date, price, qty, kind } where kind is
//  'add' (scale in) or 'tp' (take profit / reduce; the default, and
//  what legacy rows without `kind` mean). Walking those events in
//  date order gives the running average entry, the realized PnL and
//  the quantity timeline that funding is charged against.
// ============================================================
import { supabase, SUPABASE_URL, SUPABASE_ANON } from './pmh-supabase.js';

const BUILD = 'v5-funding-20260821';

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}
function fmtPrice(n) { return fmt(n, Math.abs(Number(n)) >= 100 ? 2 : 6); }
function signed(n, d = 2) { return `${n > 0 ? '+' : ''}${fmt(n, d)}`; }
function tone(n) { return n > 0 ? 't-pos' : n < 0 ? 't-neg' : ''; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function numPos(v) { const n = num(v); return n !== null && n > 0 ? n : null; }
function today() { return new Date().toISOString().slice(0, 10); }

// ── Position walk ───────────────────────────────────────────
const MMR = 0.005;
// Isolated-margin liquidation estimate:
//   LONG: entry × (1 − 1/lev + mmr)      SHORT: entry × (1 + 1/lev − mmr)
export function estimateLiq(entry, leverage, direction) {
  const e = numPos(entry), l = numPos(leverage);
  if (!e || !l || l <= 1) return null;
  return direction === 'SHORT' ? e * (1 + 1 / l - MMR) : e * (1 - 1 / l + MMR);
}

function feeRate(t) { const f = num(t.fee_pct); return f && f > 0 ? f / 100 : 0; }
function dirSign(t) { return t.direction === 'SHORT' ? -1 : 1; }
function fundingOf(t) { return num(t.funding_paid) || 0; }   // signed: negative = paid
function partialFills(t) { return Array.isArray(t.partials) ? t.partials : []; }

// Chronological position events, opening entry first.
function positionEvents(t) {
  const evs = [{ date: t.opened_at, price: num(t.entry_price), qty: num(t.quantity), kind: 'add', open: true }];
  for (const f of partialFills(t)) {
    evs.push({ date: f.date, price: num(f.price), qty: num(f.qty), kind: f.kind === 'add' ? 'add' : 'tp' });
  }
  return evs
    .filter((e) => e.price !== null && e.qty !== null && e.qty > 0)
    // stable sort keeps same-day events in the order they were logged
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

// Weighted-average-cost walk (what exchanges show as "average entry").
function walk(t, { includeClose = true } = {}) {
  const f = feeRate(t), s = dirSign(t);
  const evs = positionEvents(t);
  if (includeClose && t.status === 'CLOSED' && numPos(t.exit_price) !== null) {
    evs.push({ date: t.closed_at, price: num(t.exit_price), qty: Infinity, kind: 'tp', final: true });
  }
  let qty = 0, avg = 0, realized = 0, fees = 0, exitQty = 0, exitNotional = 0, addQty = 0;
  for (const e of evs) {
    if (e.kind === 'tp') {
      const q = Math.min(e.qty, qty);
      if (q <= 0) continue;
      realized += (e.price - avg) * q * s;
      fees += f * e.price * q;
      qty -= q; exitQty += q; exitNotional += e.price * q;
    } else {
      fees += f * e.price * e.qty;
      avg = qty + e.qty > 0 ? (avg * qty + e.price * e.qty) / (qty + e.qty) : e.price;
      qty += e.qty; addQty += e.qty;
    }
  }
  return {
    qty, avg, realized, fees, addQty, exitQty,
    avgExit: exitQty > 0 ? exitNotional / exitQty : null,
    // everything banked so far, after fees and funding
    net: realized - fees + fundingOf(t),
  };
}

function remainingQty(t) { return walk(t, { includeClose: false }).qty; }

// Full result of the trade (only meaningful once something is realized).
function tradePnl(t) {
  const w = walk(t);
  if (w.exitQty <= 0 && fundingOf(t) === 0) return null;
  const lev = numPos(t.leverage);
  const basis = w.avg * (w.addQty || 0);
  const margin = lev ? basis / lev : basis;
  return { pnl: w.net, fees: w.fees, funding: fundingOf(t), pct: margin > 0 ? (w.net / margin) * 100 : null };
}

// Break-even price for the REMAINING quantity: closing the rest here makes the
// whole trade (incl. profit taken, fees and funding) net zero.
//   LONG:  B = (A − R/qr) / (1 − f)      SHORT: B = (A + R/qr) / (1 + f)
function breakEven(t) {
  const w = walk(t, { includeClose: false });
  if (!w.qty || !w.avg) return null;
  const f = feeRate(t);
  const b = t.direction === 'SHORT'
    ? (w.avg + w.net / w.qty) / (1 + f)
    : (w.avg - w.net / w.qty) / (1 - f);
  return b > 0 ? b : null;
}

// Total outcome if the remaining quantity exits at `price`.
function whatIf(t, price) {
  const p = numPos(price);
  const w = walk(t, { includeClose: false });
  if (p === null || !w.qty) return null;
  return w.net + (p - w.avg) * w.qty * dirSign(t) - feeRate(t) * p * w.qty;
}

// ── Funding (Kraken public API) ─────────────────────────────
// Position size over time, so funding is charged against what was actually
// open at each hour. Adds count from the start of their day, exits from the
// end of theirs (day granularity is plenty for an estimate).
function qtyAt(t, ts) {
  let q = 0;
  for (const e of positionEvents(t)) {
    if (!e.date) continue;
    const at = Date.parse(e.date + (e.kind === 'tp' ? 'T23:59:59Z' : 'T00:00:00Z'));
    if (!Number.isFinite(at) || at > ts) continue;
    q = e.kind === 'tp' ? Math.max(0, q - e.qty) : q + e.qty;
  }
  return q;
}

const KRAKEN_SYMBOL = { BTC: 'PF_XBTUSD', XBT: 'PF_XBTUSD' };
function krakenSymbol(coin) {
  const c = String(coin || '').toUpperCase();
  return KRAKEN_SYMBOL[c] || `PF_${c}USD`;
}

const ratesCache = new Map();
// Kraken sends no CORS headers, so this goes through our `funding` Edge
// Function (a thin server-side proxy for the same public endpoint).
async function fundingRates(symbol, since) {
  const key = `${symbol}|${since || 0}`;
  if (ratesCache.has(key)) return ratesCache.get(key);
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  const params = new URLSearchParams({ symbol });
  if (since) params.set('since', String(since));
  const endpoint = `${SUPABASE_URL}/functions/v1/funding?${params.toString()}`;
  let res;
  try {
    res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON } });
  } catch (e) {
    throw new Error(`can't reach the funding proxy — ${e.message || e}`);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (j.error === 'kraken_error') throw new Error(`Kraken said ${j.status} for ${symbol}`);
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  const rates = (j.rates || [])
    .map((r) => ({ ts: Date.parse(r.timestamp), rate: Number(r.fundingRate) }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.rate));
  if (!rates.length) throw new Error(`no rates for ${symbol} in this period`);
  ratesCache.set(key, rates);
  return rates;
}

// fundingRate is USD per contract per hour and PF_ contracts are 1 unit of the
// base coin. Positive rate => longs pay shorts, so a long's PnL effect is
// negative. Returns { effect, hours, from, to, covered }.
async function estimateFunding(t) {
  const start = Date.parse((t.opened_at || today()) + 'T00:00:00Z');
  const rates = await fundingRates(krakenSymbol(t.coin), start);
  const end = t.status === 'CLOSED' && t.closed_at
    ? Date.parse(t.closed_at + 'T23:59:59Z') : Date.now();
  let effect = 0, hours = 0, from = null, to = null;
  for (const r of rates) {
    if (r.ts < start || r.ts > end) continue;
    const q = qtyAt(t, r.ts);
    if (!q) continue;
    effect += -dirSign(t) * q * r.rate;
    hours++;
    if (from === null || r.ts < from) from = r.ts;
    if (to === null || r.ts > to) to = r.ts;
  }
  if (!hours) throw new Error('no funding hours in this window');
  const expected = Math.max(1, Math.round((end - start) / 3600000));
  return { effect, hours, from, to, covered: Math.min(1, hours / expected) };
}

// ── State ───────────────────────────────────────────────────
let trades = [];
let me = null;
let closingTrade = null;
let fillTrade = null;           // trade being added to / partially closed
let fillKind = 'tp';            // 'tp' | 'add'
let liqTouched = false;
let expanded = new Set();
let fundingBusy = new Set();

// ── Data ────────────────────────────────────────────────────
async function loadTrades() {
  const { data, error } = await supabase.from('pmh_trades')
    .select('*')
    .order('status', { ascending: false })
    .order('opened_at', { ascending: false });
  if (error) { console.error(error); return; }
  trades = data || [];
  render();
}

// ── Rendering ───────────────────────────────────────────────
function render() { renderStats(); renderTables(); }

function renderStats() {
  const open = trades.filter((t) => t.status === 'OPEN');
  const closed = trades.filter((t) => t.status === 'CLOSED');
  let realized = 0, feesTotal = 0, fundingTotal = 0, wins = 0;
  trades.forEach((t) => {
    const p = tradePnl(t);
    if (p) { realized += p.pnl; feesTotal += p.fees; fundingTotal += p.funding; }
  });
  closed.forEach((t) => { const p = tradePnl(t); if (p && p.pnl > 0) wins++; });
  const winRate = closed.length ? `${Math.round((wins / closed.length) * 100)}%` : '—';
  const costs = feesTotal - fundingTotal;   // fees + funding paid, as a positive cost
  $('tr_stats').innerHTML = [
    { n: open.length, l: 'Open positions', c: 'var(--text-primary)' },
    { n: closed.length, l: 'Closed trades', c: 'var(--text-primary)' },
    { n: signed(realized), l: 'Realized PnL (USDT)', c: realized > 0 ? 'var(--accent)' : realized < 0 ? 'var(--danger)' : 'var(--text-primary)',
      t: 'Closed trades + profit already taken on open positions, after estimated fees and funding' },
    { n: winRate, l: 'Win rate', c: 'var(--text-primary)' },
    { n: fmt(costs), l: 'Fees + funding', c: 'var(--text-muted)', t: 'Estimated trading fees plus funding paid (a negative total means funding earned you money)' },
  ].map((s) =>
    `<div class="stat"${s.t ? ` title="${esc(s.t)}"` : ''}><div class="stat-n" style="color:${s.c}">${s.n}</div><div class="stat-l">${s.l}</div></div>`
  ).join('');
}

function dirBadge(d) {
  return `<span class="t-dir ${d === 'SHORT' ? 't-dir--short' : 't-dir--long'}">${d}</span>`;
}

const COLS = 12;

function detailRow(t) {
  const w = walk(t, { includeClose: false });
  const fills = partialFills(t);
  const isOpen = t.status === 'OPEN';
  const hasAdds = fills.some((f) => f.kind === 'add');
  const m = [];

  m.push(['Avg entry', fmtPrice(w.avg) + (hasAdds ? ' <small class="t-muted">incl. adds</small>' : '')]);
  m.push(['Remaining qty', `${fmt(w.qty, 6)} <small class="t-muted">of ${fmt(w.addQty, 6)} bought</small>`]);
  if (w.avgExit !== null) m.push(['Avg exit (fills)', fmtPrice(w.avgExit)]);
  if (w.exitQty > 0 || fundingOf(t)) m.push(['Taken so far (net)', `<span class="${tone(w.net)}">${signed(w.net)}</span>`]);

  if (isOpen) {
    const be = breakEven(t);
    if (be !== null) m.push(['Break-even for rest', `${fmtPrice(be)} <small class="t-muted">total ≥ 0 ${t.direction === 'SHORT' ? 'below' : 'above'} this</small>`]);
    const atSL = whatIf(t, t.stop_loss);
    m.push(['If SL hits now', atSL === null
      ? '<span class="t-muted">N/A <small>no stop set</small></span>'
      : `<span class="${tone(atSL)}">${signed(atSL)}</span>`]);
    const atTP = whatIf(t, t.take_profit);
    m.push(['If TP hits', atTP === null
      ? '<span class="t-muted">N/A <small>no target set</small></span>'
      : `<span class="${tone(atTP)}">${signed(atTP)}</span>`]);
  }

  const fund = fundingOf(t);
  const busy = fundingBusy.has(t.id);
  m.push(['Funding', `${t.funding_paid == null
      ? '<span class="t-muted">not estimated</span>'
      : `<span class="${tone(fund)}">${signed(fund)}</span>`}
     <button class="btn btn-sm t-fund-btn" data-tact="funding" data-id="${t.id}"${busy ? ' disabled' : ''}>${busy ? '…' : '↻ Kraken'}</button>
     <div class="t-fund-note" id="fundnote-${t.id}"></div>`]);
  if (w.fees) m.push(['Est. fees', fmt(w.fees)]);
  if (t.notes) m.push(['Notes', esc(t.notes)]);

  const fillRows = fills.map((f, i) => {
    const add = f.kind === 'add';
    const q = Number(f.qty) || 0;
    const pnl = add ? null : (Number(f.price) - w.avg) * q * dirSign(t);
    return `<div class="t-fill">
      <span>${esc(f.date || '')}</span>
      <span><span class="${add ? 't-pos' : 't-muted'}">${add ? '+' : '−'}</span> ${fmt(f.qty, 6)} @ ${fmtPrice(f.price)}</span>
      <span class="${add ? 't-muted' : tone(pnl)}">${add ? 'added' : signed(pnl)}</span>
      ${isOpen ? `<button class="btn btn-sm btn-ghost-danger" data-tact="fill-del" data-id="${t.id}" data-i="${i}" title="Remove">✕</button>` : '<span></span>'}
    </div>`;
  }).join('');

  return `<tr class="t-detail"><td colspan="${COLS}">
    <div class="t-detail-grid">
      ${m.map(([l, v]) => `<div class="t-metric"><div class="t-metric-l">${l}</div><div class="t-metric-v">${v}</div></div>`).join('')}
    </div>
    ${fillRows ? `<div class="t-fills"><div class="t-metric-l" style="margin-bottom:4px">Position changes</div>${fillRows}</div>` : ''}
  </td></tr>`;
}

function tradeRow(t) {
  const w = walk(t, { includeClose: false });
  const p = tradePnl(t);
  const isOpen = t.status === 'OPEN';
  const fills = partialFills(t);
  const hasAdds = fills.some((f) => f.kind === 'add');

  let pnlCell = '<span class="t-muted">—</span>';
  if (!isOpen && p) {
    pnlCell = `<span class="${tone(p.pnl)}">${signed(p.pnl)}${p.pct !== null ? ` <small>(${signed(p.pct, 1)}%)</small>` : ''}</span>`;
  } else if (isOpen && (w.exitQty > 0 || fundingOf(t))) {
    pnlCell = `<span class="${tone(w.net)}">${signed(w.net)} <small class="t-muted">so far</small></span>`;
  }

  const qtyCell = isOpen && fills.length
    ? `${fmt(w.qty, 6)} <small class="t-muted">/ ${fmt(w.addQty, 6)}</small>`
    : fmt(w.qty || t.quantity, 6);

  const actions = isOpen
    ? `<button class="btn btn-sm" data-tact="add" data-id="${t.id}" title="Add to this position">+ Add</button>
       <button class="btn btn-sm" data-tact="partial" data-id="${t.id}" title="Log a partial take-profit">Partial</button>
       <button class="btn btn-sm btn-primary" data-tact="close" data-id="${t.id}">Close</button>
       <button class="btn btn-sm" data-tact="edit" data-id="${t.id}">Edit</button>
       <button class="btn btn-sm btn-ghost-danger" data-tact="delete" data-id="${t.id}">✕</button>`
    : `<button class="btn btn-sm" data-tact="edit" data-id="${t.id}">Edit</button>
       <button class="btn btn-sm btn-ghost-danger" data-tact="delete" data-id="${t.id}">✕</button>`;

  return `<tr class="t-expandable" data-trow="${t.id}">
    <td>${esc(t.opened_at || '')}${t.closed_at ? `<div class="t-muted t-small">→ ${esc(t.closed_at)}</div>` : ''}</td>
    <td class="t-coin"><span class="t-caret">${expanded.has(t.id) ? '▾' : '▸'}</span> ${esc((t.coin || '').toUpperCase())}</td>
    <td>${dirBadge(t.direction)}</td>
    <td>${fmtPrice(w.avg || t.entry_price)}${hasAdds ? ' <small class="t-muted">avg</small>' : ''}</td>
    <td class="t-pos-c">${numPos(t.take_profit) ? fmtPrice(t.take_profit) : '<span class="t-muted">—</span>'}</td>
    <td class="t-neg-c">${numPos(t.stop_loss) ? fmtPrice(t.stop_loss) : '<span class="t-muted">—</span>'}</td>
    <td>${qtyCell}</td>
    <td>${numPos(t.leverage) ? fmt(t.leverage, 1) + '×' : '—'}</td>
    <td class="t-warn-c" title="Estimated liquidation price">${numPos(t.liq_est) ? fmtPrice(t.liq_est) : '<span class="t-muted">—</span>'}</td>
    <td>${t.status === 'CLOSED' ? fmtPrice(t.exit_price) : '<span class="t-muted">open</span>'}</td>
    <td>${pnlCell}</td>
    <td><div class="t-actions">${actions}</div></td>
  </tr>${expanded.has(t.id) ? detailRow(t) : ''}`;
}

const HEAD = `<tr>
  <th>Date</th><th>Coin</th><th>Dir</th><th>Entry</th><th>TP</th><th>SL</th>
  <th>Qty</th><th>Lev</th><th>Liq est.</th><th>Exit</th><th>PnL</th><th></th></tr>`;

function renderTables() {
  const open = trades.filter((t) => t.status === 'OPEN');
  const closed = trades.filter((t) => t.status === 'CLOSED');
  const table = (rows) =>
    `<div class="t-wrap"><table class="t-table"><thead>${HEAD}</thead><tbody>${rows.join('')}</tbody></table></div>`;
  $('tr_open').innerHTML = open.length ? table(open.map(tradeRow))
    : '<div class="db-empty" style="padding:24px"><p>No open positions.</p></div>';
  $('tr_closed').innerHTML = closed.length ? table(closed.map(tradeRow))
    : '<div class="db-empty" style="padding:24px"><p>No closed trades yet.</p></div>';

  document.querySelectorAll('[data-tact]').forEach((el) => {
    const t = trades.find((x) => x.id === el.dataset.id);
    const act = el.dataset.tact;
    el.addEventListener('click', (e) => e.stopPropagation());
    if (act === 'add') el.addEventListener('click', () => openFill(t, 'add'));
    if (act === 'partial') el.addEventListener('click', () => openFill(t, 'tp'));
    if (act === 'close') el.addEventListener('click', () => openClose(t));
    if (act === 'edit') el.addEventListener('click', () => openTradeModal(t));
    if (act === 'delete') el.addEventListener('click', () => deleteTrade(t));
    if (act === 'fill-del') el.addEventListener('click', () => deleteFill(t, +el.dataset.i));
    if (act === 'funding') el.addEventListener('click', () => refreshFunding(t));
  });
  document.querySelectorAll('tr.t-expandable').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.trow;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderTables();
    });
  });
}

// ── Funding refresh ─────────────────────────────────────────
async function refreshFunding(t) {
  if (!t || fundingBusy.has(t.id)) return;
  fundingBusy.add(t.id);
  expanded.add(t.id);
  renderTables();
  const note = (msg, cls) => {
    const el = $(`fundnote-${t.id}`);
    if (el) el.innerHTML = `<span class="${cls || 't-muted'}">${msg}</span>`;
  };
  try {
    const r = await estimateFunding(t);
    const { error } = await supabase.from('pmh_trades')
      .update({ funding_paid: +r.effect.toFixed(4) }).eq('id', t.id);
    if (error) throw error;
    fundingBusy.delete(t.id);
    await loadTrades();
    const days = Math.max(1, Math.round((r.to - r.from) / 86400000));
    note(`${r.hours} hourly rates · ~${days}d covered`
      + (r.covered < 0.9 ? ` — Kraken returned only ${Math.round(r.covered * 100)}% of the period, so this is a partial estimate` : ''));
  } catch (e) {
    fundingBusy.delete(t.id);
    renderTables();
    note(`Couldn't fetch: ${esc(e.message || e)}<br><span class="t-muted">build ${esc(BUILD)} · you can type the number into Funding via Edit.</span>`, 't-neg');
  }
}

// ── New / edit trade modal ──────────────────────────────────
function autoLiq() {
  if (liqTouched) return;
  const v = estimateLiq($('t_entry').value, $('t_lev').value, $('t_dir').value);
  $('t_liq').value = v === null ? '' : String(+v.toPrecision(6));
}

function openTradeModal(t) {
  const editing = !!t;
  liqTouched = editing && t.liq_est != null;
  $('tradeTitle').textContent = editing ? 'Edit trade' : 'New trade';
  $('t_id').value = editing ? t.id : '';
  $('t_coin').value = editing ? t.coin || '' : '';
  $('t_dir').value = editing ? t.direction : 'LONG';
  $('t_date').value = editing ? t.opened_at || today() : today();
  $('t_entry').value = editing ? t.entry_price ?? '' : '';
  $('t_qty').value = editing ? t.quantity ?? '' : '';
  $('t_lev').value = editing ? t.leverage ?? '' : '';
  $('t_tp').value = editing ? t.take_profit ?? '' : '';
  $('t_sl').value = editing ? t.stop_loss ?? '' : '';
  $('t_liq').value = editing ? t.liq_est ?? '' : '';
  $('t_fee').value = editing ? (t.fee_pct ?? '') : '0.05';
  $('t_funding').value = editing ? (t.funding_paid ?? '') : '';
  $('t_notes').value = editing ? t.notes || '' : '';
  $('t_entryHint').textContent = editing && partialFills(t).some((f) => f.kind === 'add')
    ? 'This is the FIRST entry — later adds are separate, the table shows the average.' : '';
  $('tradeBack').classList.add('show');
  $('t_coin').focus();
}
function closeTradeModal() { $('tradeBack').classList.remove('show'); }

async function saveTrade(e) {
  e.preventDefault();
  const id = $('t_id').value;
  const payload = {
    coin: $('t_coin').value.trim().toUpperCase(),
    direction: $('t_dir').value,
    opened_at: $('t_date').value || today(),
    entry_price: num($('t_entry').value),
    quantity: num($('t_qty').value),
    leverage: numPos($('t_lev').value),
    take_profit: numPos($('t_tp').value),
    stop_loss: numPos($('t_sl').value),
    liq_est: numPos($('t_liq').value),
    fee_pct: numPos($('t_fee').value),
    funding_paid: num($('t_funding').value),
    notes: $('t_notes').value.trim() || null,
  };
  if (!payload.coin || payload.entry_price === null) { alert('Coin and entry price are required.'); return; }
  $('t_save').disabled = true;
  const res = id
    ? await supabase.from('pmh_trades').update(payload).eq('id', id)
    : await supabase.from('pmh_trades').insert({ ...payload, owner: me, status: 'OPEN' });
  $('t_save').disabled = false;
  if (res.error) { alert('Could not save: ' + res.error.message); return; }
  closeTradeModal();
  await loadTrades();
}

// ── Add / partial fill modal ────────────────────────────────
function openFill(t, kind) {
  if (!t) return;
  if (num(t.quantity) === null) { alert('Set the open quantity on this trade first (Edit).'); return; }
  const w = walk(t, { includeClose: false });
  if (kind === 'tp' && !w.qty) { alert('Nothing left to take — the whole position is realized. Use Close.'); return; }
  fillTrade = t; fillKind = kind;
  $('fillTitle').textContent = kind === 'add' ? 'Add to position' : 'Partial take-profit';
  $('p_priceLabel').textContent = kind === 'add' ? 'Fill price *' : 'Exit price *';
  $('p_qtyLabel').textContent = kind === 'add' ? 'Quantity bought *' : 'Quantity sold *';
  $('p_submit').textContent = kind === 'add' ? 'Add to position' : 'Log partial';
  $('p_meta').innerHTML = `<b>${esc(t.coin)}</b> ${dirBadge(t.direction)} · avg entry ${fmtPrice(w.avg)} · open <b>${fmt(w.qty, 6)}</b>`;
  $('p_price').value = '';
  $('p_qty').value = '';
  $('p_qty').placeholder = kind === 'add' ? '' : `max ${+w.qty.toPrecision(8)}`;
  $('p_date').value = today();
  $('p_preview').textContent = '';
  $('partialBack').classList.add('show');
  $('p_price').focus();
}
function closeFillModal() { $('partialBack').classList.remove('show'); fillTrade = null; }

function previewFill() {
  if (!fillTrade) return;
  const price = numPos($('p_price').value), qty = numPos($('p_qty').value);
  const box = $('p_preview');
  if (price === null || qty === null) { box.textContent = ''; return; }
  const draft = {
    ...fillTrade,
    partials: [...partialFills(fillTrade), { date: $('p_date').value || today(), price, qty, kind: fillKind }],
  };
  const before = walk(fillTrade, { includeClose: false });
  const after = walk(draft, { includeClose: false });
  const lines = [];
  if (fillKind === 'add') {
    lines.push(`New average entry: <b>${fmtPrice(after.avg)}</b> <small class="t-muted">(was ${fmtPrice(before.avg)})</small>`);
    lines.push(`Position size: <b>${fmt(after.qty, 6)}</b> ${esc(fillTrade.coin)}`);
    const liq = estimateLiq(after.avg, fillTrade.leverage, fillTrade.direction);
    if (liq !== null) lines.push(`Est. liquidation moves to <b>${fmtPrice(liq)}</b> <small class="t-muted">(saved with the add)</small>`);
  } else {
    const realizedNow = after.net - before.net;
    lines.push(`This fill: <b class="${tone(realizedNow)}">${signed(realizedNow)} USDT</b>`);
    lines.push(`Taken in total: <b class="${tone(after.net)}">${signed(after.net)}</b> · remaining ${fmt(after.qty, 6)}`);
    if (qty > before.qty + 1e-12) lines.push(`<span class="t-neg">Only ${fmt(before.qty, 6)} is open.</span>`);
  }
  const be = after.qty > 0 ? breakEven(draft) : null;
  if (be !== null) lines.push(`Break-even for the rest: <b>${fmtPrice(be)}</b>`);
  box.innerHTML = lines.join('<br>');
}

async function confirmFill(e) {
  e.preventDefault();
  if (!fillTrade) return;
  const price = numPos($('p_price').value), qty = numPos($('p_qty').value);
  if (price === null || qty === null) { alert('Enter price and quantity.'); return; }
  const w = walk(fillTrade, { includeClose: false });
  if (fillKind === 'tp' && qty > w.qty + 1e-12) { alert(`Only ${+w.qty.toPrecision(8)} is still open.`); return; }

  const fills = [...partialFills(fillTrade), { date: $('p_date').value || today(), price, qty, kind: fillKind }];
  const patch = { partials: fills };
  // Adding moves the average entry, so the liquidation estimate moves with it.
  if (fillKind === 'add') {
    const after = walk({ ...fillTrade, partials: fills }, { includeClose: false });
    const liq = estimateLiq(after.avg, fillTrade.leverage, fillTrade.direction);
    if (liq !== null) patch.liq_est = +liq.toPrecision(8);
  }
  const { error } = await supabase.from('pmh_trades').update(patch).eq('id', fillTrade.id);
  if (error) { alert('Could not save: ' + error.message); return; }
  expanded.add(fillTrade.id);
  closeFillModal();
  await loadTrades();
}

async function deleteFill(t, i) {
  const f = partialFills(t)[i];
  if (!f) return;
  if (!confirm(`Remove ${f.kind === 'add' ? 'the add of' : 'the fill'} ${f.qty} @ ${f.price}?`)) return;
  const fills = partialFills(t).filter((_, j) => j !== i);
  const { error } = await supabase.from('pmh_trades').update({ partials: fills }).eq('id', t.id);
  if (error) { alert('Could not remove: ' + error.message); return; }
  await loadTrades();
}

// ── Close-position modal ────────────────────────────────────
function openClose(t) {
  if (!t) return;
  closingTrade = t;
  const w = walk(t, { includeClose: false });
  $('c_meta').innerHTML = `<b>${esc(t.coin)}</b> ${dirBadge(t.direction)} · avg entry ${fmtPrice(w.avg)}`
    + ` · closing remaining <b>${fmt(w.qty, 6)}</b>${numPos(t.leverage) ? ` · ${fmt(t.leverage, 1)}×` : ''}`
    + (w.exitQty > 0 || fundingOf(t) ? `<br><small class="t-muted">${signed(w.net)} USDT already banked</small>` : '');
  $('c_exit').value = '';
  $('c_date').value = today();
  $('c_preview').textContent = '';
  $('closeBack').classList.add('show');
  $('c_exit').focus();
}
function closeCloseModal() { $('closeBack').classList.remove('show'); closingTrade = null; }

function previewPnl() {
  if (!closingTrade) return;
  const exit = numPos($('c_exit').value);
  if (exit === null) { $('c_preview').textContent = ''; return; }
  const p = tradePnl({ ...closingTrade, status: 'CLOSED', exit_price: exit, closed_at: $('c_date').value || today() });
  if (!p) { $('c_preview').textContent = ''; return; }
  const w = walk(closingTrade, { includeClose: false });
  $('c_preview').innerHTML = `Total result: <b class="${tone(p.pnl)}">${signed(p.pnl)} USDT`
    + `${p.pct !== null ? ` (${signed(p.pct, 1)}% on margin)` : ''}</b>`
    + (w.exitQty > 0 ? ` <small class="t-muted">incl. ${signed(w.net)} already banked</small>` : '')
    + (p.fees || p.funding ? `<br><small class="t-muted">after ~${fmt(p.fees)} fees${p.funding ? ` and ${signed(p.funding)} funding` : ''}</small>` : '');
}

async function confirmClose(e) {
  e.preventDefault();
  const exit = numPos($('c_exit').value);
  if (exit === null || !closingTrade) { alert('Enter the exit price.'); return; }
  const { error } = await supabase.from('pmh_trades')
    .update({ status: 'CLOSED', exit_price: exit, closed_at: $('c_date').value || today() })
    .eq('id', closingTrade.id);
  if (error) { alert('Could not close: ' + error.message); return; }
  closeCloseModal();
  await loadTrades();
}

async function deleteTrade(t) {
  if (!t) return;
  if (!confirm(`Delete the ${t.coin} ${t.direction} trade? This can't be undone.`)) return;
  const { error } = await supabase.from('pmh_trades').delete().eq('id', t.id);
  if (error) { alert('Could not delete: ' + error.message); return; }
  await loadTrades();
}

// ── Init ────────────────────────────────────────────────────
export async function initTrades(username) {
  me = username;
  $('t_newBtn').addEventListener('click', () => openTradeModal(null));
  $('t_cancel').addEventListener('click', closeTradeModal);
  $('tradeForm').addEventListener('submit', saveTrade);
  $('tradeBack').addEventListener('click', (e) => { if (e.target === $('tradeBack')) closeTradeModal(); });
  ['t_entry', 't_lev'].forEach((id) => $(id).addEventListener('input', autoLiq));
  $('t_dir').addEventListener('change', autoLiq);
  $('t_liq').addEventListener('input', () => { liqTouched = true; });
  $('c_cancel').addEventListener('click', closeCloseModal);
  $('closeForm').addEventListener('submit', confirmClose);
  $('closeBack').addEventListener('click', (e) => { if (e.target === $('closeBack')) closeCloseModal(); });
  $('c_exit').addEventListener('input', previewPnl);
  $('p_cancel').addEventListener('click', closeFillModal);
  $('partialForm').addEventListener('submit', confirmFill);
  $('partialBack').addEventListener('click', (e) => { if (e.target === $('partialBack')) closeFillModal(); });
  ['p_price', 'p_qty'].forEach((id) => $(id).addEventListener('input', previewFill));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeTradeModal(); closeCloseModal(); closeFillModal(); } });

  await loadTrades();
  try {
    supabase.channel('pmh-trades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pmh_trades' }, () => loadTrades())
      .subscribe();
  } catch (err) { console.warn('Trades realtime unavailable.', err); }
}
