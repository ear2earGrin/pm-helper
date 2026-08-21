// ============================================================
//  Crypto trade log — shared panel for both partners
//  Backed by public.pmh_trades (Supabase, RLS: authenticated).
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
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function today() { return new Date().toISOString().slice(0, 10); }

// Isolated-margin liquidation estimate (maintenance margin ~0.5%):
//   LONG:  liq ≈ entry × (1 − 1/lev + mmr)
//   SHORT: liq ≈ entry × (1 + 1/lev − mmr)
const MMR = 0.005;
export function estimateLiq(entry, leverage, direction) {
  const e = num(entry), l = num(leverage);
  if (!e || !l || l <= 1) return null;
  return direction === 'SHORT' ? e * (1 + 1 / l - MMR) : e * (1 - 1 / l + MMR);
}

// Realized PnL in quote currency (USDT) + % on margin.
function tradePnl(t) {
  const e = num(t.entry_price), x = num(t.exit_price), q = num(t.quantity);
  if (t.status !== 'CLOSED' || e === null || x === null || q === null) return null;
  const pnl = (x - e) * q * (t.direction === 'SHORT' ? -1 : 1);
  const lev = num(t.leverage);
  const margin = lev && lev > 0 ? (e * q) / lev : e * q;
  return { pnl, pct: margin > 0 ? (pnl / margin) * 100 : null };
}

// ── State ───────────────────────────────────────────────────
let trades = [];
let me = null;
let ownerFilter = 'all';        // all | <username>
let closingTrade = null;
let liqTouched = false;         // user overrode the auto liq estimate

const OWNERS = ['mdonkov', 'lkashkin'];

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
  renderOwnerTabs();
  renderTables();
}

function visible() {
  return ownerFilter === 'all' ? trades : trades.filter((t) => t.owner === ownerFilter);
}

function renderStats() {
  const list = visible();
  const open = list.filter((t) => t.status === 'OPEN');
  const closed = list.filter((t) => t.status === 'CLOSED');
  let realized = 0, wins = 0;
  closed.forEach((t) => {
    const p = tradePnl(t);
    if (p) { realized += p.pnl; if (p.pnl > 0) wins++; }
  });
  const winRate = closed.length ? `${Math.round((wins / closed.length) * 100)}%` : '—';
  const pnlColor = realized > 0 ? 'var(--accent)' : realized < 0 ? 'var(--danger)' : 'var(--text-primary)';
  $('tr_stats').innerHTML = [
    { n: open.length, l: 'Open positions', c: 'var(--text-primary)' },
    { n: closed.length, l: 'Closed trades', c: 'var(--text-primary)' },
    { n: `${realized > 0 ? '+' : ''}${fmt(realized)}`, l: 'Realized PnL (USDT)', c: pnlColor },
    { n: winRate, l: 'Win rate', c: 'var(--text-primary)' },
  ].map((t) =>
    `<div class="stat"><div class="stat-n" style="color:${t.c}">${t.n}</div><div class="stat-l">${t.l}</div></div>`
  ).join('');
}

function renderOwnerTabs() {
  const tabs = [{ key: 'all', label: 'Both' }, ...OWNERS.map((o) => ({ key: o, label: '@' + o }))];
  $('tr_tabs').innerHTML = tabs.map((t) => {
    const n = t.key === 'all' ? trades.length : trades.filter((x) => x.owner === t.key).length;
    return `<button class="db-tab ${t.key === ownerFilter ? 'active' : ''}" data-owner="${t.key}">${t.label}<span class="cnt">${n}</span></button>`;
  }).join('');
  $('tr_tabs').querySelectorAll('.db-tab').forEach((b) =>
    b.addEventListener('click', () => { ownerFilter = b.dataset.owner; render(); }));
}

function dirBadge(d) {
  return `<span class="t-dir ${d === 'SHORT' ? 't-dir--short' : 't-dir--long'}">${d}</span>`;
}

function tradeRow(t) {
  const p = tradePnl(t);
  const pnlCell = p
    ? `<span class="${p.pnl > 0 ? 't-pos' : p.pnl < 0 ? 't-neg' : ''}">${p.pnl > 0 ? '+' : ''}${fmt(p.pnl)}${p.pct !== null ? ` <small>(${p.pct > 0 ? '+' : ''}${fmt(p.pct, 1)}%)</small>` : ''}</span>`
    : '<span class="t-muted">—</span>';
  const actions = t.status === 'OPEN'
    ? `<button class="btn btn-sm btn-primary" data-tact="close" data-id="${t.id}">Close</button>
       <button class="btn btn-sm" data-tact="edit" data-id="${t.id}">Edit</button>
       <button class="btn btn-sm btn-ghost-danger" data-tact="delete" data-id="${t.id}">✕</button>`
    : `<button class="btn btn-sm" data-tact="edit" data-id="${t.id}">Edit</button>
       <button class="btn btn-sm btn-ghost-danger" data-tact="delete" data-id="${t.id}">✕</button>`;
  return `<tr>
    <td>${esc(t.opened_at || '')}${t.closed_at ? `<div class="t-muted t-small">→ ${esc(t.closed_at)}</div>` : ''}</td>
    <td><span class="t-owner">@${esc(t.owner)}</span></td>
    <td class="t-coin">${esc((t.coin || '').toUpperCase())}${t.notes ? ` <span class="t-note" title="${esc(t.notes)}">📝</span>` : ''}</td>
    <td>${dirBadge(t.direction)}</td>
    <td>${fmt(t.entry_price, 6)}</td>
    <td class="t-pos-c">${fmt(t.take_profit, 6)}</td>
    <td class="t-neg-c">${fmt(t.stop_loss, 6)}</td>
    <td>${fmt(t.quantity, 6)}</td>
    <td>${t.leverage ? fmt(t.leverage, 1) + '×' : '—'}</td>
    <td class="t-warn-c" title="Estimated liquidation price">${fmt(t.liq_est, 6)}</td>
    <td>${t.status === 'CLOSED' ? fmt(t.exit_price, 6) : '<span class="t-muted">open</span>'}</td>
    <td>${pnlCell}</td>
    <td><div class="t-actions">${actions}</div></td>
  </tr>`;
}

const HEAD = `<tr>
  <th>Date</th><th>Who</th><th>Coin</th><th>Dir</th><th>Entry</th><th>TP</th><th>SL</th>
  <th>Qty</th><th>Lev</th><th>Liq est.</th><th>Exit</th><th>PnL</th><th></th></tr>`;

function renderTables() {
  const list = visible();
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
    if (el.dataset.tact === 'close') el.addEventListener('click', () => openClose(t));
    if (el.dataset.tact === 'edit') el.addEventListener('click', () => openTradeModal(t));
    if (el.dataset.tact === 'delete') el.addEventListener('click', () => deleteTrade(t));
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
    leverage: num($('t_lev').value),
    take_profit: num($('t_tp').value),
    stop_loss: num($('t_sl').value),
    liq_est: num($('t_liq').value),
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

// ── Close-position modal ────────────────────────────────────
function openClose(t) {
  if (!t) return;
  closingTrade = t;
  $('c_meta').innerHTML = `<b>${esc(t.coin)}</b> ${dirBadge(t.direction)} · entry ${fmt(t.entry_price, 6)} · qty ${fmt(t.quantity, 6)}${t.leverage ? ` · ${fmt(t.leverage, 1)}×` : ''}`;
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
  $('c_preview').innerHTML = `Result: <b class="${p.pnl > 0 ? 't-pos' : p.pnl < 0 ? 't-neg' : ''}">`
    + `${p.pnl > 0 ? '+' : ''}${fmt(p.pnl)} USDT${p.pct !== null ? ` (${p.pct > 0 ? '+' : ''}${fmt(p.pct, 1)}% on margin)` : ''}</b>`;
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeTradeModal(); closeCloseModal(); } });

  await loadTrades();
  try {
    supabase.channel('pmh-trades')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pmh_trades' }, () => loadTrades())
      .subscribe();
  } catch (err) { console.warn('Trades realtime unavailable.', err); }
}
