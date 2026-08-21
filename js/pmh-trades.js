// ============================================================
//  Crypto trade log — shared panel for both partners
//  Backed by public.pmh_trades (Supabase; RLS: each partner sees
//  ONLY their own rows — enforced server-side by pmh_username()).
//  Supports partial take-profits (partials jsonb) and per-side
//  fee estimates (fee_pct, % of notional — Kraken defaults).
// ============================================================
import { supabase } from './pmh-supabase.js';

const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}
function fmtPrice(n) { return fmt(n, Number(n) >= 100 ? 2 : 6); }
function signed(n, d = 2) { return `${n > 0 ? '+' : ''}${fmt(n, d)}`; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function numPos(v) { const n = num(v); return n !== null && n > 0 ? n : null; }
function today() { return new Date().toISOString().slice(0, 10); }

// ── Trade math ──────────────────────────────────────────────
// Isolated-margin liquidation estimate (maintenance margin ~0.5%):
//   LONG:  liq ≈ entry × (1 − 1/lev + mmr)     SHORT: entry × (1 + 1/lev − mmr)
const MMR = 0.005;
export function estimateLiq(entry, leverage, direction) {
  const e = num(entry), l = num(leverage);
  if (!e || !l || l <= 1) return null;
  return direction === 'SHORT' ? e * (1 + 1 / l - MMR) : e * (1 - 1 / l + MMR);
}

function feeRate(t) { const f = num(t.fee_pct); return f && f > 0 ? f / 100 : 0; }
function dirSign(t) { return t.direction === 'SHORT' ? -1 : 1; }

// Net result of exiting `qty` at `price`: direction-signed gross minus the
// per-side fee on both the (pro-rata) entry notional and the exit notional.
function fillNet(t, price, qty) {
  const e = num(t.entry_price), p = num(price), q = num(qty);
  if (e === null || p === null || q === null || q <= 0) return null;
  const f = feeRate(t);
  const gross = (p - e) * q * dirSign(t);
  const fees = f * q * (p + e);
  return { gross, fees, net: gross - fees };
}

function partialFills(t) { return Array.isArray(t.partials) ? t.partials : []; }

// Aggregate the recorded partial fills.
function partialsSummary(t) {
  let qtyClosed = 0, realized = 0, fees = 0, notional = 0;
  for (const fl of partialFills(t)) {
    const r = fillNet(t, fl.price, fl.qty);
    if (!r) continue;
    qtyClosed += Number(fl.qty);
    realized += r.net;
    fees += r.fees;
    notional += Number(fl.price) * Number(fl.qty);
  }
  return {
    count: partialFills(t).length, qtyClosed, realized, fees,
    avgExit: qtyClosed > 0 ? notional / qtyClosed : null,
  };
}

function remainingQty(t) {
  const q = num(t.quantity);
  if (q === null) return null;
  return Math.max(0, q - partialsSummary(t).qtyClosed);
}

// Full realized PnL: partial fills + (for CLOSED trades) the final fill of the
// remaining quantity at exit_price. Returns {pnl, fees, pct} or null.
function tradePnl(t) {
  const e = num(t.entry_price), q = num(t.quantity);
  const ps = partialsSummary(t);
  let pnl = ps.realized, fees = ps.fees, any = ps.count > 0;
  if (t.status === 'CLOSED') {
    const qr = q !== null ? Math.max(0, q - ps.qtyClosed) : null;
    const fin = qr !== null && qr > 0 ? fillNet(t, t.exit_price, qr) : null;
    if (fin) { pnl += fin.net; fees += fin.fees; any = true; }
  }
  if (!any || e === null || q === null) return null;
  const lev = num(t.leverage);
  const margin = lev && lev > 0 ? (e * q) / lev : e * q;
  return { pnl, fees, pct: margin > 0 ? (pnl / margin) * 100 : null };
}

// Break-even price for the REMAINING quantity: closing the rest at this price
// makes the whole trade (incl. fees and profit already taken) net zero.
//   LONG:  B = (e(1+f) − R/qr) / (1−f)      SHORT: B = (e(1−f) + R/qr) / (1+f)
function breakEven(t) {
  const e = num(t.entry_price), qr = remainingQty(t);
  if (e === null || !qr) return null;
  const f = feeRate(t), R = partialsSummary(t).realized;
  const b = t.direction === 'SHORT'
    ? (e * (1 - f) + R / qr) / (1 + f)
    : (e * (1 + f) - R / qr) / (1 - f);
  return b > 0 ? b : null;
}

// Total outcome if the remaining quantity exits at `price` now.
function whatIf(t, price) {
  const qr = remainingQty(t);
  if (!qr || numPos(price) === null) return null;
  const fin = fillNet(t, price, qr);
  return fin ? partialsSummary(t).realized + fin.net : null;
}

// ── State ───────────────────────────────────────────────────
let trades = [];
let me = null;
let closingTrade = null;
let partialTrade = null;
let liqTouched = false;         // user overrode the auto liq estimate
let expanded = new Set();       // trade ids with the detail row open

// ── Data ────────────────────────────────────────────────────
async function loadTrades() {
  const { data, error } = await supabase.from('pmh_trades')
    .select('*')
    .order('status', { ascending: false })      // OPEN before CLOSED
    .order('opened_at', { ascending: false });
  if (error) { console.error(error); return; }
  trades = data || [];
  render();
}

// ── Rendering ───────────────────────────────────────────────
function render() {
  renderStats();
  renderTables();
}

function renderStats() {
  const list = trades;
  const open = list.filter((t) => t.status === 'OPEN');
  const closed = list.filter((t) => t.status === 'CLOSED');
  let realized = 0, feesTotal = 0, wins = 0;
  list.forEach((t) => {
    const p = tradePnl(t);
    if (p) { realized += p.pnl; feesTotal += p.fees; }
  });
  closed.forEach((t) => { const p = tradePnl(t); if (p && p.pnl > 0) wins++; });
  const winRate = closed.length ? `${Math.round((wins / closed.length) * 100)}%` : '—';
  const pnlColor = realized > 0 ? 'var(--accent)' : realized < 0 ? 'var(--danger)' : 'var(--text-primary)';
  $('tr_stats').innerHTML = [
    { n: open.length, l: 'Open positions', c: 'var(--text-primary)' },
    { n: closed.length, l: 'Closed trades', c: 'var(--text-primary)' },
    { n: signed(realized), l: 'Realized PnL (USDT)', c: pnlColor, t: 'Closed trades + profit already taken on open positions, net of estimated fees' },
    { n: winRate, l: 'Win rate', c: 'var(--text-primary)' },
    { n: fmt(feesTotal), l: 'Est. fees (USDT)', c: 'var(--text-muted)', t: 'Estimated entry+exit fees on realized fills (funding not included)' },
  ].map((t) =>
    `<div class="stat" ${t.t ? `title="${esc(t.t)}"` : ''}><div class="stat-n" style="color:${t.c}">${t.n}</div><div class="stat-l">${t.l}</div></div>`
  ).join('');
}

function dirBadge(d) {
  return `<span class="t-dir ${d === 'SHORT' ? 't-dir--short' : 't-dir--long'}">${d}</span>`;
}

const COLS = 12;

function detailRow(t) {
  const ps = partialsSummary(t);
  const qr = remainingQty(t);
  const fills = partialFills(t).map((fl, i) => {
    const r = fillNet(t, fl.price, fl.qty);
    return `<div class="t-fill">
      <span>${esc(fl.date || '')}</span>
      <span>${fmt(fl.qty, 6)} @ ${fmt(fl.price, 6)}</span>
      <span class="${r && r.net > 0 ? 't-pos' : r && r.net < 0 ? 't-neg' : ''}">${r ? signed(r.net) : '—'}</span>
      ${t.status === 'OPEN' ? `<button class="btn btn-sm btn-ghost-danger" data-tact="fill-del" data-id="${t.id}" data-i="${i}" title="Remove this fill">✕</button>` : '<span></span>'}
    </div>`;
  }).join('');

  const metrics = [];
  if (qr !== null) metrics.push(['Remaining qty', fmt(qr, 6)]);
  if (ps.count) metrics.push(['Avg exit (fills)', fmtPrice(ps.avgExit)]);
  if (ps.count) metrics.push(['Taken so far (net)', `<span class="${ps.realized > 0 ? 't-pos' : ps.realized < 0 ? 't-neg' : ''}">${signed(ps.realized)}</span>`]);
  if (t.status === 'OPEN') {
    const be = breakEven(t);
    if (be !== null) metrics.push([`Break-even for rest`, `${fmtPrice(be)} <small class="t-muted">total ≥ 0 ${t.direction === 'SHORT' ? 'below' : 'above'} this</small>`]);
    const atSL = whatIf(t, t.stop_loss), atTP = whatIf(t, t.take_profit);
    if (atSL !== null) metrics.push(['If SL hits now', `<span class="${atSL > 0 ? 't-pos' : atSL < 0 ? 't-neg' : ''}">${signed(atSL)}</span>`]);
    if (atTP !== null) metrics.push(['If TP hits', `<span class="${atTP > 0 ? 't-pos' : atTP < 0 ? 't-neg' : ''}">${signed(atTP)}</span>`]);
  }
  if (ps.fees) metrics.push(['Est. fees so far', fmt(ps.fees)]);
  if (t.notes) metrics.push(['Notes', esc(t.notes)]);

  return `<tr class="t-detail"><td colspan="${COLS}">
    <div class="t-detail-grid">
      ${metrics.map(([l, v]) => `<div class="t-metric"><div class="t-metric-l">${l}</div><div class="t-metric-v">${v}</div></div>`).join('')}
    </div>
    ${fills ? `<div class="t-fills"><div class="t-metric-l" style="margin-bottom:4px">Partial fills</div>${fills}</div>` : ''}
  </td></tr>`;
}

function tradeRow(t) {
  const p = tradePnl(t);
  const ps = partialsSummary(t);
  const qr = remainingQty(t);
  const hasDetail = ps.count > 0 || t.notes;
  const isOpen = t.status === 'OPEN';

  let pnlCell;
  if (t.status === 'CLOSED' && p) {
    pnlCell = `<span class="${p.pnl > 0 ? 't-pos' : p.pnl < 0 ? 't-neg' : ''}">${signed(p.pnl)}${p.pct !== null ? ` <small>(${signed(p.pct, 1)}%)</small>` : ''}</span>`;
  } else if (isOpen && ps.count > 0) {
    pnlCell = `<span class="${ps.realized > 0 ? 't-pos' : ps.realized < 0 ? 't-neg' : ''}">${signed(ps.realized)} <small class="t-muted">so far</small></span>`;
  } else {
    pnlCell = '<span class="t-muted">—</span>';
  }

  const qtyCell = isOpen && ps.count > 0 && qr !== null
    ? `${fmt(qr, 6)} <small class="t-muted">/ ${fmt(t.quantity, 6)}</small>`
    : fmt(t.quantity, 6);

  const actions = isOpen
    ? `<button class="btn btn-sm" data-tact="partial" data-id="${t.id}" title="Log a partial take-profit">Partial</button>
       <button class="btn btn-sm btn-primary" data-tact="close" data-id="${t.id}">Close</button>
       <button class="btn btn-sm" data-tact="edit" data-id="${t.id}">Edit</button>
       <button class="btn btn-sm btn-ghost-danger" data-tact="delete" data-id="${t.id}">✕</button>`
    : `<button class="btn btn-sm" data-tact="edit" data-id="${t.id}">Edit</button>
       <button class="btn btn-sm btn-ghost-danger" data-tact="delete" data-id="${t.id}">✕</button>`;

  const caret = hasDetail
    ? `<span class="t-caret">${expanded.has(t.id) ? '▾' : '▸'}</span> `
    : '';

  return `<tr class="${hasDetail ? 't-expandable' : ''}" data-trow="${t.id}">
    <td>${esc(t.opened_at || '')}${t.closed_at ? `<div class="t-muted t-small">→ ${esc(t.closed_at)}</div>` : ''}</td>
    <td class="t-coin">${caret}${esc((t.coin || '').toUpperCase())}${t.notes && !hasDetail ? ` <span class="t-note" title="${esc(t.notes)}">📝</span>` : ''}</td>
    <td>${dirBadge(t.direction)}</td>
    <td>${fmt(t.entry_price, 6)}</td>
    <td class="t-pos-c">${fmt(t.take_profit, 6)}</td>
    <td class="t-neg-c">${fmt(t.stop_loss, 6)}</td>
    <td>${qtyCell}</td>
    <td>${t.leverage ? fmt(t.leverage, 1) + '×' : '—'}</td>
    <td class="t-warn-c" title="Estimated liquidation price">${fmt(t.liq_est, 6)}</td>
    <td>${t.status === 'CLOSED' ? fmt(t.exit_price, 6) : '<span class="t-muted">open</span>'}</td>
    <td>${pnlCell}</td>
    <td><div class="t-actions">${actions}</div></td>
  </tr>${expanded.has(t.id) ? detailRow(t) : ''}`;
}

const HEAD = `<tr>
  <th>Date</th><th>Coin</th><th>Dir</th><th>Entry</th><th>TP</th><th>SL</th>
  <th>Qty</th><th>Lev</th><th>Liq est.</th><th>Exit</th><th>PnL</th><th></th></tr>`;

function renderTables() {
  const list = trades;
  const open = list.filter((t) => t.status === 'OPEN');
  const closed = list.filter((t) => t.status === 'CLOSED');
  const table = (rows) =>
    `<div class="t-wrap"><table class="t-table"><thead>${HEAD}</thead><tbody>${rows.join('')}</tbody></table></div>`;
  $('tr_open').innerHTML = open.length ? table(open.map(tradeRow))
    : '<div class="db-empty" style="padding:24px"><p>No open positions.</p></div>';
  $('tr_closed').innerHTML = closed.length ? table(closed.map(tradeRow))
    : '<div class="db-empty" style="padding:24px"><p>No closed trades yet.</p></div>';

  document.querySelectorAll('[data-tact]').forEach((el) => {
    const id = el.dataset.id, t = trades.find((x) => x.id === id);
    const act = el.dataset.tact;
    el.addEventListener('click', (e) => e.stopPropagation());
    if (act === 'partial') el.addEventListener('click', () => openPartial(t));
    if (act === 'close') el.addEventListener('click', () => openClose(t));
    if (act === 'edit') el.addEventListener('click', () => openTradeModal(t));
    if (act === 'delete') el.addEventListener('click', () => deleteTrade(t));
    if (act === 'fill-del') el.addEventListener('click', () => deleteFill(t, +el.dataset.i));
  });
  document.querySelectorAll('tr.t-expandable').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.trow;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderTables();
    });
  });
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
  $('t_notes').value = editing ? t.notes || '' : '';
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
    notes: $('t_notes').value.trim() || null,
  };
  if (!payload.coin || payload.entry_price === null) { alert('Coin and entry price are required.'); return; }
  $('t_save').disabled = true;
  let res;
  if (id) res = await supabase.from('pmh_trades').update(payload).eq('id', id);
  else res = await supabase.from('pmh_trades').insert({ ...payload, owner: me, status: 'OPEN' });
  $('t_save').disabled = false;
  if (res.error) { alert('Could not save: ' + res.error.message); return; }
  closeTradeModal();
  await loadTrades();
}

// ── Partial take-profit modal ───────────────────────────────
function openPartial(t) {
  if (!t) return;
  if (num(t.quantity) === null) { alert('Set the open quantity on this trade first (Edit).'); return; }
  const qr = remainingQty(t);
  if (!qr) { alert('Nothing left to take — the full quantity is already realized. Use Close.'); return; }
  partialTrade = t;
  $('p_meta').innerHTML = `<b>${esc(t.coin)}</b> ${dirBadge(t.direction)} · entry ${fmt(t.entry_price, 6)} · remaining <b>${fmt(qr, 6)}</b> of ${fmt(t.quantity, 6)}`;
  $('p_price').value = '';
  $('p_qty').value = '';
  $('p_qty').placeholder = `max ${+qr.toPrecision(8)}`;
  $('p_date').value = today();
  $('p_preview').textContent = '';
  $('partialBack').classList.add('show');
  $('p_price').focus();
}
function closePartialModal() { $('partialBack').classList.remove('show'); partialTrade = null; }

function previewPartial() {
  if (!partialTrade) return;
  const price = num($('p_price').value), qty = num($('p_qty').value);
  const box = $('p_preview');
  const r = price !== null && qty !== null && qty > 0 ? fillNet(partialTrade, price, qty) : null;
  if (!r) { box.textContent = ''; return; }
  const qr = remainingQty(partialTrade);
  const after = { ...partialTrade, partials: [...partialFills(partialTrade), { price, qty }] };
  const newTotal = partialsSummary(after).realized;
  const remAfter = Math.max(0, qr - qty);
  const be = remAfter > 0 ? breakEven(after) : null;
  const lines = [
    `This fill: <b class="${r.net > 0 ? 't-pos' : r.net < 0 ? 't-neg' : ''}">${signed(r.net)} USDT</b>`
      + (r.fees ? ` <small class="t-muted">(after ~${fmt(r.fees)} fees)</small>` : ''),
    `Taken in total: <b class="${newTotal > 0 ? 't-pos' : newTotal < 0 ? 't-neg' : ''}">${signed(newTotal)}</b> · remaining ${fmt(remAfter, 6)}`,
  ];
  if (be !== null) lines.push(`Rest is risk-free ${partialTrade.direction === 'SHORT' ? 'below' : 'above'} <b>${fmtPrice(be)}</b>`);
  if (qty > qr + 1e-12) lines.push(`<span class="t-neg">Quantity exceeds the remaining ${fmt(qr, 6)}.</span>`);
  box.innerHTML = lines.join('<br>');
}

async function confirmPartial(e) {
  e.preventDefault();
  if (!partialTrade) return;
  const price = num($('p_price').value), qty = num($('p_qty').value);
  const qr = remainingQty(partialTrade);
  if (price === null || qty === null || qty <= 0) { alert('Enter price and quantity.'); return; }
  if (qty > qr + 1e-12) { alert(`Only ${+qr.toPrecision(8)} is still open.`); return; }
  const fills = [...partialFills(partialTrade), { date: $('p_date').value || today(), price, qty }];
  const { error } = await supabase.from('pmh_trades').update({ partials: fills }).eq('id', partialTrade.id);
  if (error) { alert('Could not save: ' + error.message); return; }
  expanded.add(partialTrade.id);
  closePartialModal();
  await loadTrades();
}

async function deleteFill(t, i) {
  const fl = partialFills(t)[i];
  if (!fl) return;
  if (!confirm(`Remove the fill ${fl.qty} @ ${fl.price}?`)) return;
  const fills = partialFills(t).filter((_, j) => j !== i);
  const { error } = await supabase.from('pmh_trades').update({ partials: fills }).eq('id', t.id);
  if (error) { alert('Could not remove: ' + error.message); return; }
  await loadTrades();
}

// ── Close-position modal ────────────────────────────────────
function openClose(t) {
  if (!t) return;
  closingTrade = t;
  const ps = partialsSummary(t);
  const qr = remainingQty(t);
  $('c_meta').innerHTML = `<b>${esc(t.coin)}</b> ${dirBadge(t.direction)} · entry ${fmt(t.entry_price, 6)}`
    + ` · ${qr !== null && ps.count ? `closing remaining <b>${fmt(qr, 6)}</b>` : `qty ${fmt(t.quantity, 6)}`}`
    + `${t.leverage ? ` · ${fmt(t.leverage, 1)}×` : ''}`
    + (ps.count ? `<br><small class="t-muted">${signed(ps.realized)} USDT already taken in ${ps.count} partial fill${ps.count > 1 ? 's' : ''}</small>` : '');
  $('c_exit').value = '';
  $('c_date').value = today();
  $('c_preview').textContent = '';
  $('closeBack').classList.add('show');
  $('c_exit').focus();
}
function closeCloseModal() { $('closeBack').classList.remove('show'); closingTrade = null; }

function previewPnl() {
  if (!closingTrade) return;
  const p = tradePnl({ ...closingTrade, status: 'CLOSED', exit_price: num($('c_exit').value) });
  if (!p) { $('c_preview').textContent = ''; return; }
  const ps = partialsSummary(closingTrade);
  $('c_preview').innerHTML = `Total result: <b class="${p.pnl > 0 ? 't-pos' : p.pnl < 0 ? 't-neg' : ''}">`
    + `${signed(p.pnl)} USDT${p.pct !== null ? ` (${signed(p.pct, 1)}% on margin)` : ''}</b>`
    + (ps.count ? ` <small class="t-muted">incl. ${signed(ps.realized)} from partials</small>` : '')
    + (p.fees ? `<br><small class="t-muted">≈ ${fmt(p.fees)} in fees included</small>` : '');
}

async function confirmClose(e) {
  e.preventDefault();
  const exit = num($('c_exit').value);
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

// ── Init (called from pmh-dashboard.js after auth) ──────────
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
  $('p_cancel').addEventListener('click', closePartialModal);
  $('partialForm').addEventListener('submit', confirmPartial);
  $('partialBack').addEventListener('click', (e) => { if (e.target === $('partialBack')) closePartialModal(); });
  ['p_price', 'p_qty'].forEach((id) => $(id).addEventListener('input', previewPartial));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeTradeModal(); closeCloseModal(); closePartialModal(); } });

  await loadTrades();
  try {
    supabase.channel('pmh-trades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pmh_trades' }, () => loadTrades())
      .subscribe();
  } catch (err) { console.warn('Trades realtime unavailable.', err); }
}
