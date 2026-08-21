// ============================================================
//  Redesign Studio — dashboard logic
// ============================================================
import { supabase, currentUsername, SUPABASE_URL, SUPABASE_ANON } from './pmh-supabase.js';
// NOTE: keep the ?v= in sync with dashboard.html — without it the browser
// happily serves a cached copy of this module even when the entry file changes.
import { initTrades } from './pmh-trades.js?v=v6-fees-20260821';

// ── Prospecting lists ───────────────────────────────────────
const COUNTRIES = [
  { code: 'BG', name: 'Bulgaria' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' }, { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' }, { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' }, { code: 'BE', name: 'Belgium' },
  { code: 'AT', name: 'Austria' }, { code: 'CH', name: 'Switzerland' },
  { code: 'PT', name: 'Portugal' }, { code: 'GR', name: 'Greece' },
  { code: 'RO', name: 'Romania' }, { code: 'RS', name: 'Serbia' },
  { code: 'HR', name: 'Croatia' }, { code: 'SI', name: 'Slovenia' },
  { code: 'HU', name: 'Hungary' }, { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czechia' }, { code: 'SK', name: 'Slovakia' },
  { code: 'DK', name: 'Denmark' }, { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' }, { code: 'FI', name: 'Finland' },
  { code: 'TR', name: 'Turkey' }, { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' }, { code: 'AE', name: 'United Arab Emirates' },
];
const BUSINESS_TYPES = [
  'Accountants', 'Lawyers', 'Dentists', 'Doctors / Clinics', 'Restaurants',
  'Cafes', 'Bars', 'Hotels', 'Hair salons', 'Beauty salons', 'Barbers',
  'Gyms', 'Real estate agencies', 'Plumbers', 'Electricians', 'Builders',
  'Auto repair shops', 'Car dealers', 'Bakeries', 'Butchers', 'Florists',
  'Pharmacies', 'Opticians', 'Veterinarians', 'Photographers', 'Architects',
  'Interior designers', 'Marketing agencies', 'Travel agencies', 'Notaries',
  'Cleaning services', 'Landscapers', 'Tattoo studios', 'Pet groomers',
];

// ── Status model ────────────────────────────────────────────
const STATUS = {
  lead:        { label: 'Lead',        color: '#8B93A8' },
  redesigning: { label: 'Redesigning', color: '#A78BFA' },
  review:      { label: 'Review',      color: '#38BDF8' },
  sent:        { label: 'Sent',        color: '#F5A623' },
  replied:     { label: 'Replied',     color: '#0FD9A0' },
  finished:    { label: 'Finished',    color: '#0FD9A0' },
  passed:      { label: 'Passed',      color: '#4A5268' },
};
const STATUS_ORDER = ['lead', 'redesigning', 'review', 'sent', 'replied', 'finished', 'passed'];

// A job pitched this long ago with no reply needs a call/visit.
const FOLLOWUP_DAYS = 7;
function needsFollowup(j) {
  return j.status === 'sent' && (Date.now() - new Date(j.updated_at)) / 86400000 >= FOLLOWUP_DAYS;
}

const TABS = [
  { key: 'all',      label: 'All',       match: () => true },
  { key: 'active',   label: 'Active',    match: (j) => ['lead', 'redesigning', 'review', 'sent', 'replied'].includes(j.status) },
  { key: 'review',   label: 'Review',    match: (j) => j.status === 'review' },
  { key: 'sent',     label: 'Sent',      match: (j) => j.status === 'sent' || j.status === 'replied' },
  { key: 'followup', label: 'Follow up', match: needsFollowup },
  { key: 'finished', label: 'Finished',  match: (j) => j.status === 'finished' },
  { key: 'passed',   label: 'Passed',    match: (j) => j.status === 'passed' },
];

// ── State ───────────────────────────────────────────────────
let jobs = [];
let eventsByJob = {};   // job_id -> [events]
let redesignsBySlug = {}; // redesign slug -> manifest entry
let activeTab = 'all';
let me = null;

// ── Helpers ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mapsUrl(job) {
  if (job.maps_url) return job.maps_url;
  if (job.address) return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(job.address);
  return null;
}
function redesignSlugFromUrl(url) {
  const m = String(url || '').match(/\/redesigns\/([^/?#]+)\/?/);
  return m ? m[1] : '';
}
function redesignQuality(job) {
  const slug = redesignSlugFromUrl(job.redesign_url);
  return slug && redesignsBySlug[slug] ? redesignsBySlug[slug].quality : null;
}
function timeAgo(iso) {
  const d = new Date(iso), now = new Date();
  const s = Math.floor((now - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return d.toLocaleDateString();
}

// ── Auth gate ───────────────────────────────────────────────
(async function init() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) { location.replace('login.html'); return; }
  me = await currentUsername();
  $('whoami').textContent = me || 'partner';

  buildStatusSelect();
  buildProspectControls();
  wireUI();
  wireViewSwitcher();
  await Promise.all([loadAll(), initTrades(me)]);
  subscribeRealtime();
})();

// ── View switcher (Outreach / Crypto trades) ────────────────
function wireViewSwitcher() {
  const btns = document.querySelectorAll('.db-view-btn');
  function show(view) {
    $('view-outreach').hidden = view !== 'outreach';
    $('view-trades').hidden = view !== 'trades';
    btns.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    try { localStorage.setItem('pmh-view', view); } catch (_) {}
    if (view === 'trades') history.replaceState(null, '', '#trades');
    else history.replaceState(null, '', location.pathname);
  }
  btns.forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  const initial = location.hash === '#trades' ? 'trades'
    : (localStorage.getItem('pmh-view') === 'trades' ? 'trades' : 'outreach');
  show(initial);
}

function buildStatusSelect() {
  $('f_status').innerHTML = STATUS_ORDER
    .map((k) => `<option value="${k}">${STATUS[k].label}</option>`).join('');
}

// ── Data loading ────────────────────────────────────────────
async function loadRedesignManifest() {
  try {
    const res = await fetch('/redesigns/manifest.json', { cache: 'no-store' });
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    (data.redesigns || []).forEach((r) => { if (r.slug) map[r.slug] = r; });
    return map;
  } catch (err) {
    console.warn('Redesign manifest unavailable.', err);
    return {};
  }
}

async function loadAll() {
  const [jobsRes, evRes, manifest] = await Promise.all([
    supabase.from('pmh_jobs').select('*').order('updated_at', { ascending: false }),
    supabase.from('pmh_job_events').select('*').order('created_at', { ascending: false }),
    loadRedesignManifest(),
  ]);
  if (jobsRes.error) { console.error(jobsRes.error); }
  jobs = jobsRes.data || [];
  redesignsBySlug = manifest;
  eventsByJob = {};
  (evRes.data || []).forEach((e) => {
    (eventsByJob[e.job_id] = eventsByJob[e.job_id] || []).push(e);
  });
  render();
}

// ── Rendering ───────────────────────────────────────────────
function render() {
  renderStats();
  renderTabs();
  renderBoard();
}

function renderStats() {
  const counts = { total: jobs.length };
  STATUS_ORDER.forEach((k) => (counts[k] = 0));
  jobs.forEach((j) => (counts[j.status] = (counts[j.status] || 0) + 1));
  const followups = jobs.filter(needsFollowup).length;
  const tiles = [
    { n: counts.total, l: 'Companies', c: 'var(--text-primary)' },
    { n: counts.review, l: 'To review', c: STATUS.review.color },
    { n: counts.sent + counts.replied, l: 'Pitched', c: STATUS.sent.color },
    { n: followups, l: 'Follow up', c: followups ? 'var(--danger)' : 'var(--text-muted)' },
    { n: counts.finished, l: 'Finished', c: STATUS.finished.color },
  ];
  $('stats').innerHTML = tiles.map((t) =>
    `<div class="stat"><div class="stat-n" style="color:${t.c}">${t.n}</div><div class="stat-l">${t.l}</div></div>`
  ).join('');
}

function renderTabs() {
  $('tabs').innerHTML = TABS.map((t) => {
    const n = jobs.filter((j) => t.match(j)).length;
    return `<button class="db-tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label}<span class="cnt">${n}</span></button>`;
  }).join('');
  $('tabs').querySelectorAll('.db-tab').forEach((b) =>
    b.addEventListener('click', () => { activeTab = b.dataset.tab; render(); }));
}

function renderBoard() {
  const tab = TABS.find((t) => t.key === activeTab);
  const list = jobs.filter((j) => tab.match(j));
  const board = $('board');

  if (!list.length) {
    board.innerHTML = `<div class="db-empty"><div class="big">Nothing here yet</div>
      <p>Add a company you want to pitch a redesign to.</p></div>`;
    return;
  }
  board.innerHTML = `<div class="db-grid">${list.map(jobCard).join('')}</div>`;
  wireCards();
}

function jobCard(j) {
  const st = STATUS[j.status] || STATUS.lead;
  const maps = mapsUrl(j);
  const evs = (eventsByJob[j.id] || []).slice(0, 4);

  const statusSelect = `<select class="pill" data-act="status" data-id="${j.id}" style="color:${st.color}">
    ${STATUS_ORDER.map((k) => `<option value="${k}" ${k === j.status ? 'selected' : ''}>${STATUS[k].label}</option>`).join('')}
  </select>`;

  const metaRows = [];
  if (maps) metaRows.push(`<a href="${esc(maps)}" target="_blank" rel="noopener"><span class="ic">📍</span><span class="val">${esc(j.address || 'View on Google Maps')}</span></a>`);
  else if (j.address) metaRows.push(`<span class="row"><span class="ic">📍</span><span class="val">${esc(j.address)}</span></span>`);
  if (j.email) metaRows.push(`<a href="mailto:${esc(j.email)}"><span class="ic">✉️</span><span class="val">${esc(j.email)}</span></a>`);
  if (j.phone) metaRows.push(`<span class="row"><span class="ic">📞</span><span class="val">${esc(j.phone)}</span></span>`);
  if (j.website_url) metaRows.push(`<a href="${esc(j.website_url)}" target="_blank" rel="noopener"><span class="ic">🌐</span><span class="val">${esc(j.website_url.replace(/^https?:\/\//, ''))}</span></a>`);

  const quality = redesignQuality(j);
  const isBespoke = quality === 'bespoke';
  const redesignedStar = isBespoke ? ' <span title="Bespoke redesign" aria-label="Bespoke redesign">⭐</span>' : '';
  const redesign = j.redesign_url
    ? `<div class="job-redesign"><span>${isBespoke ? '⭐' : '🎨'}</span><a href="${esc(j.redesign_url)}" target="_blank" rel="noopener">${isBespoke ? 'View bespoke redesign' : 'View redesign'} →</a></div>`
    : `<div class="job-redesign"><span>🎨</span><span class="muted">No redesign linked yet</span></div>`;

  const notes = j.notes ? `<div class="job-meta"><span class="row"><span class="ic">📝</span><span class="val" style="white-space:normal;color:var(--text-secondary)">${esc(j.notes)}</span></span></div>` : '';

  const timeline = `
    <div class="job-events">
      <div class="job-events-head">Status reports</div>
      ${evs.length ? evs.map((e) => `<div class="ev">${esc(e.body)}<div class="ev-meta">${esc(e.author || '?')} · ${timeAgo(e.created_at)}</div></div>`).join('')
        : '<div class="ev" style="opacity:.6">No updates yet.</div>'}
      <div class="ev-add">
        <input type="text" data-act="ev-input" data-id="${j.id}" placeholder="Add a status update…" />
        <button class="btn btn-sm btn-primary" data-act="ev-add" data-id="${j.id}">Log</button>
      </div>
    </div>`;

  return `<article class="job">
    <div class="job-top">
      <div>
        <div class="job-company">${esc(j.company)}${redesignedStar}</div>
        ${j.owner || j.site_score != null ? `<div class="job-owner">${j.owner ? '@' + esc(j.owner) : ''}${j.owner && j.site_score != null ? ' · ' : ''}${j.site_score != null ? `<span title="${esc(j.score_notes || '')}">site ${j.site_score}/10</span>` : ''}</div>` : ''}
      </div>
      ${statusSelect}
    </div>
    ${metaRows.length ? `<div class="job-meta">${metaRows.join('')}</div>` : ''}
    ${redesign}
    ${notes}
    ${timeline}
    <div class="job-foot">
      ${j.status === 'sent' || j.status === 'replied' ? `
        <button class="btn btn-sm" data-act="log-called" data-id="${j.id}" style="margin-right:auto">📞 Called</button>
        <button class="btn btn-sm" data-act="log-visited" data-id="${j.id}">🚶 Visited</button>` : ''}
      ${j.status === 'review' || (j.redesign_url && j.status === 'redesigning') ? `
        <button class="btn btn-sm btn-primary" data-act="send" data-id="${j.id}">✉️ Review &amp; Send</button>` : ''}
      <button class="btn btn-sm" data-act="edit" data-id="${j.id}">Edit</button>
      <button class="btn btn-sm btn-ghost-danger" data-act="delete" data-id="${j.id}">Delete</button>
    </div>
  </article>`;
}

function wireCards() {
  document.querySelectorAll('[data-act]').forEach((el) => {
    const act = el.dataset.act, id = el.dataset.id;
    if (act === 'status') el.addEventListener('change', () => changeStatus(id, el.value));
    if (act === 'edit') el.addEventListener('click', () => openModal(jobs.find((j) => j.id === id)));
    if (act === 'send') el.addEventListener('click', () => openSend(jobs.find((j) => j.id === id)));
    if (act === 'log-called') el.addEventListener('click', () => quickLog(id, '📞 Called — waiting to hear back'));
    if (act === 'log-visited') el.addEventListener('click', () => quickLog(id, '🚶 Visited in person'));
    if (act === 'delete') el.addEventListener('click', () => deleteJob(id));
    if (act === 'ev-add') el.addEventListener('click', () => addEvent(id));
    if (act === 'ev-input') el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addEvent(id); } });
  });
}

// ── Mutations ───────────────────────────────────────────────
async function changeStatus(id, status) {
  const job = jobs.find((j) => j.id === id);
  const prev = job ? job.status : null;
  if (job) job.status = status;               // optimistic
  render();
  const { error } = await supabase.from('pmh_jobs').update({ status }).eq('id', id);
  if (error) { alert('Could not update status: ' + error.message); if (job) job.status = prev; render(); return; }
  await supabase.from('pmh_job_events').insert({
    job_id: id, author: me, kind: 'status', body: `Status → ${STATUS[status]?.label || status}`,
  });
  await loadAll();
}

async function addEvent(id) {
  const input = document.querySelector(`[data-act="ev-input"][data-id="${id}"]`);
  const body = input && input.value.trim();
  if (!body) return;
  input.value = '';
  const { error } = await supabase.from('pmh_job_events').insert({ job_id: id, author: me, kind: 'note', body });
  if (error) { alert('Could not save update: ' + error.message); return; }
  await loadAll();
}

async function deleteJob(id) {
  const job = jobs.find((j) => j.id === id);
  if (!confirm(`Delete "${job ? job.company : 'this company'}"? This can't be undone.`)) return;
  const { error } = await supabase.from('pmh_jobs').delete().eq('id', id);
  if (error) { alert('Could not delete: ' + error.message); return; }
  await loadAll();
}

// ── Modal (add / edit) ──────────────────────────────────────
function openModal(job) {
  const editing = !!job;
  $('modalTitle').textContent = editing ? 'Edit company' : 'New company';
  $('f_id').value = editing ? job.id : '';
  $('f_placeid').value = editing ? job.place_id || '' : '';
  $('f_search').value = '';
  $('f_results').innerHTML = '';
  $('f_company').value = editing ? job.company || '' : '';
  $('f_address').value = editing ? job.address || '' : '';
  $('f_maps').value = editing ? job.maps_url || '' : '';
  $('f_email').value = editing ? job.email || '' : '';
  $('f_phone').value = editing ? job.phone || '' : '';
  $('f_website').value = editing ? job.website_url || '' : '';
  $('f_redesign').value = editing ? job.redesign_url || '' : '';
  $('f_status').value = editing ? job.status || 'lead' : 'lead';
  $('f_owner').value = editing ? job.owner || '' : (me || '');
  $('f_notes').value = editing ? job.notes || '' : '';
  $('modalBack').classList.add('show');
  $('f_company').focus();
}
function closeModal() { $('modalBack').classList.remove('show'); }

async function saveJob(e) {
  e.preventDefault();
  const id = $('f_id').value;
  const payload = {
    company: $('f_company').value.trim(),
    address: $('f_address').value.trim() || null,
    maps_url: $('f_maps').value.trim() || null,
    email: $('f_email').value.trim() || null,
    phone: $('f_phone').value.trim() || null,
    website_url: $('f_website').value.trim() || null,
    redesign_url: $('f_redesign').value.trim() || null,
    status: $('f_status').value,
    owner: $('f_owner').value || null,
    notes: $('f_notes').value.trim() || null,
    place_id: $('f_placeid').value || null,
  };
  if (!payload.company) return;

  $('saveBtn').disabled = true;
  let res, isNew = !id;
  if (id) res = await supabase.from('pmh_jobs').update(payload).eq('id', id).select().single();
  else res = await supabase.from('pmh_jobs').insert(payload).select().single();
  $('saveBtn').disabled = false;

  if (res.error) { alert('Could not save: ' + res.error.message); return; }
  if (isNew && res.data) {
    await supabase.from('pmh_job_events').insert({ job_id: res.data.id, author: me, kind: 'system', body: 'Company added to the board' });
  }
  closeModal();
  await loadAll();
}

// ── Realtime ────────────────────────────────────────────────
function subscribeRealtime() {
  try {
    supabase.channel('pmh-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pmh_jobs' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pmh_job_events' }, () => loadAll())
      .subscribe();
  } catch (err) { console.warn('Realtime unavailable, using manual refresh.', err); }
}

// ── Google Places (via the `places` Edge Function) ──────────
async function placesSearch({ q, region, max = 5, pageToken }) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const params = new URLSearchParams({ q, max: String(max) });
  if (region) params.set('region', region);
  if (pageToken) params.set('pageToken', pageToken);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/places?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = j.detail?.error?.message || j.detail?.message;
    if (j.error === 'places_error') throw new Error('Google Places: ' + (detail || 'request rejected'));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  return { results: j.results || [], nextPageToken: j.next_page_token || null };
}

// Batch-rate businesses 1-10 via the `site-score` Edge Function (1 = terrible
// site = great lead). Sends {website_url, company, city} so the function can
// hunt for a website that isn't listed on Google. Returns results in order.
async function scoreSites(items) {
  if (!items.length) return [];
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/site-score`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.slice(0, 25) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j.results || [];
}

// ── Prospecting modal ───────────────────────────────────────
function buildProspectControls() {
  $('p_country').innerHTML = COUNTRIES.map((c) =>
    `<option value="${c.code}" ${c.code === 'BG' ? 'selected' : ''}>${c.name}</option>`).join('');
  $('p_type_list').innerHTML = BUSINESS_TYPES.map((t) => `<option value="${esc(t)}"></option>`).join('');
}
function openProspect() { $('prospectBack').classList.add('show'); $('p_city').focus(); }
function closeProspect() { $('prospectBack').classList.remove('show'); }

let prospectResults = [];
let prospectQuery = null;
let prospectNextToken = null;

async function runProspect(loadMore = false) {
  const country = COUNTRIES.find((c) => c.code === $('p_country').value);
  const city = $('p_city').value.trim();
  const type = $('p_type').value.trim();
  if (!type) { $('p_status').textContent = 'Pick or type a business type first.'; return; }
  const q = `${type} in ${city}${city && country ? ', ' : ''}${country ? country.name : ''}`.trim();

  if (!loadMore) { prospectResults = []; prospectNextToken = null; prospectQuery = q; $('p_results').innerHTML = ''; }
  $('p_status').textContent = loadMore ? 'Loading more…' : 'Searching…';
  $('prospectMore').style.display = 'none';
  try {
    const { results, nextPageToken } = await placesSearch({
      q, region: country?.code, max: 20,
      pageToken: loadMore ? prospectNextToken : undefined,
    });
    prospectNextToken = nextPageToken;
    const fresh = results.filter((r) => !prospectResults.some((p) => p.place_id === r.place_id));
    prospectResults.push(...fresh);

    // Rate every new business 1-10 (worst = best lead; resolver finds sites
    // not listed on Google), then sort worst-first
    $('p_status').textContent = `Rating ${fresh.length} business${fresh.length === 1 ? '' : 'es'}…`;
    renderProspectResults(prospectResults);
    try {
      const items = fresh.map((r) => ({ website_url: r.website_url || '', company: r.company, city }));
      const scored = await scoreSites(items);
      fresh.forEach((r, i) => {
        const s = scored[i];
        if (!s) return;
        r.score = s.score; r.label = s.label; r.reasons = s.reasons || [];
        if (s.resolved_url && !r.website_url) { r.website_url = s.resolved_url; r.found_via_search = true; }
      });
    } catch (e) {
      fresh.forEach((r) => {
        if (r.score != null) return;
        if (!r.website_url) { r.score = 1; r.label = 'No website'; r.reasons = ['No website listed on Google']; }
      });
      $('p_status').textContent = 'Rating unavailable (' + e.message + ') — showing partial ratings.';
    }
    prospectResults.sort((a, b) => (a.score ?? 11) - (b.score ?? 11));
    const weak = prospectResults.filter((r) => (r.score ?? 11) <= 6).length;
    $('p_status').textContent =
      `${prospectResults.length} results for “${prospectQuery}” — ${weak} look weak (≤6/10), worst first`;
    renderProspectResults(prospectResults);
    $('prospectMore').style.display = prospectNextToken ? '' : 'none';
  } catch (e) {
    $('p_status').textContent = 'Search failed: ' + e.message;
  }
}

function renderProspectResults(results) {
  const box = $('p_results');
  if (!results.length) { box.innerHTML = '<div class="p-note">No matches. Try a broader city or a different business type.</div>'; return; }
  box.innerHTML = results.map((r, i) => {
    const onBoard = r.place_id && jobs.some((j) => j.place_id === r.place_id);
    const web = r.website_url ? r.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
    let badge = '<span class="score-badge s-wait" title="Rating…">…</span>';
    if (r.score != null) {
      const cls = r.score <= 3 ? 's-red' : r.score <= 6 ? 's-amber' : 's-green';
      badge = `<span class="score-badge ${cls}" title="${esc((r.reasons || []).join(' · '))}">${r.score}/10 ${esc(r.label || '')}</span>`;
    }
    return `<div class="p-result ${onBoard ? 'is-on' : ''}">
      <div class="p-result-main">
        <div class="p-result-name">${esc(r.company)} ${badge}</div>
        <div class="p-result-sub">${web ? `${r.found_via_search ? '🔎 ' : ''}<a href="${esc(r.website_url)}" target="_blank" rel="noopener">${esc(web)}</a> · ` : ''}${esc(r.address || '')}</div>
      </div>
      <button type="button" class="btn btn-primary p-result-add" data-i="${i}">${onBoard ? 'On board' : '+ Add'}</button>
    </div>`;
  }).join('');
  box.querySelectorAll('.p-result-add').forEach((b) =>
    b.addEventListener('click', () => addProspect(results[+b.dataset.i], b)));
}

async function addProspect(r, btn) {
  if (r.place_id && jobs.some((j) => j.place_id === r.place_id)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  const type = $('p_type').value.trim(), city = $('p_city').value.trim();
  const payload = {
    company: r.company, address: r.address || null, maps_url: r.maps_url || null,
    phone: r.phone || null, website_url: r.website_url || null, place_id: r.place_id || null,
    status: 'lead', owner: me,
    site_score: r.score ?? null,
    score_notes: r.reasons ? r.reasons.join(' · ') : null,
    notes: type ? `Prospect · ${type}${city ? ' in ' + city : ''}` : null,
  };
  const { data, error } = await supabase.from('pmh_jobs').insert(payload).select().single();
  if (error) { alert('Could not add: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = '+ Add'; } return; }
  if (data) {
    jobs.unshift(data);
    supabase.from('pmh_job_events').insert({ job_id: data.id, author: me, kind: 'system', body: 'Added from prospect search' });
  }
  if (btn) { const row = btn.closest('.p-result'); if (row) row.classList.add('is-on'); btn.disabled = false; btn.textContent = 'On board'; }
  render();
}

// ── Single-company autofill (inside the New Company modal) ───
async function searchAutofill() {
  const q = $('f_search').value.trim();
  if (!q) return;
  const box = $('f_results');
  box.innerHTML = '<div class="p-note">Searching…</div>';
  try {
    const { results } = await placesSearch({ q, max: 5 });
    if (!results.length) { box.innerHTML = '<div class="p-note">No matches.</div>'; return; }
    box.innerHTML = results.map((r, i) =>
      `<button type="button" class="p-result" data-i="${i}"><div class="p-result-main">
        <div class="p-result-name">${esc(r.company)}</div>
        <div class="p-result-sub">${esc(r.address || '')}</div>
      </div></button>`).join('');
    box.querySelectorAll('.p-result').forEach((b) => b.addEventListener('click', () => {
      const r = results[+b.dataset.i];
      $('f_company').value = r.company || $('f_company').value;
      $('f_address').value = r.address || '';
      $('f_maps').value = r.maps_url || '';
      $('f_phone').value = r.phone || '';
      $('f_website').value = r.website_url || '';
      $('f_placeid').value = r.place_id || '';
      box.innerHTML = '';
    }));
  } catch (e) { box.innerHTML = `<div class="p-note">Search failed: ${esc(e.message)}</div>`; }
}

// ── Review & Send (human-in-the-loop email) ─────────────────
const DISPLAY_NAME = { mdonkov: 'M. Donkov', lkashkin: 'L. Kashkin' };
let sendJob = null;

function pitchTemplate(j) {
  const sig = DISPLAY_NAME[me] || me || '';
  return `Hello ${j.company} team,

We took the liberty of redesigning your website as a free preview — see it live here:
${j.redesign_url || '(redesign link)'}

We build modern, fast websites for local businesses. If you like the new look, we'll refine it with your feedback and hand it over ready to use — a flat €500, no subscriptions required.

Best regards,
${sig}
Redesign Studio · pm-brief.com

—
You received this one-time email because your business is publicly listed. Reply "unsubscribe" and we won't contact you again.`;
}

async function openSend(j) {
  if (!j) return;
  sendJob = j;
  $('s_meta').innerHTML = `<b>${esc(j.company)}</b>`
    + (j.redesign_url ? ` · <a href="${esc(j.redesign_url)}" target="_blank" rel="noopener">redesign ↗</a>` : '')
    + (j.website_url ? ` · <a href="${esc(j.website_url)}" target="_blank" rel="noopener">current site ↗</a>` : '');
  $('s_to').value = j.email || '';
  $('s_subject').value = `A new website for ${j.company}`;
  $('s_body').value = pitchTemplate(j);
  $('s_hint').textContent = 'Checking auto-send config…';
  $('sendBack').classList.add('show');
  ($('s_to').value ? $('s_subject') : $('s_to')).focus();
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-pitch?action=status`, {
      headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_ANON },
    });
    const s = await res.json();
    $('s_auto').disabled = !s.configured;
    $('s_hint').textContent = s.configured
      ? 'Auto-send is configured — "Send automatically" delivers via Resend and marks the job Sent.'
      : 'Auto-send not configured yet (see docs/EMAIL-SETUP.md). Use "Open in mail app", then "Mark as sent".';
  } catch (_) {
    $('s_auto').disabled = true;
    $('s_hint').textContent = 'Could not check email config — use "Open in mail app", then "Mark as sent".';
  }
}
function closeSend() { $('sendBack').classList.remove('show'); sendJob = null; }

function openMailto() {
  const to = $('s_to').value.trim();
  if (!to) { alert('Enter the company email first.'); return; }
  window.open(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($('s_subject').value)}&body=${encodeURIComponent($('s_body').value)}`, '_blank');
}

async function markSentManually() {
  const to = $('s_to').value.trim(), subject = $('s_subject').value.trim();
  if (!to || !sendJob) { alert('Enter the company email first.'); return; }
  const { error } = await supabase.from('pmh_jobs').update({ status: 'sent', email: to }).eq('id', sendJob.id);
  if (error) { alert('Could not update: ' + error.message); return; }
  await supabase.from('pmh_job_events').insert({
    job_id: sendJob.id, author: me, kind: 'email', body: `Sent pitch manually to ${to} — “${subject}”`,
  });
  closeSend(); await loadAll();
}

async function sendAuto() {
  const to = $('s_to').value.trim(), subject = $('s_subject').value.trim(), text = $('s_body').value;
  if (!to || !subject || !text.trim() || !sendJob) { alert('Fill in to, subject and message.'); return; }
  $('s_auto').disabled = true;
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-pitch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: sendJob.id, to, subject, text }),
    });
    const r = await res.json().catch(() => ({}));
    if (r.ok) { closeSend(); await loadAll(); return; }
    $('s_hint').textContent = r.error === 'not_configured'
      ? 'Auto-send not configured — use "Open in mail app" + "Mark as sent".'
      : 'Send failed: ' + (r.message || r.error || `HTTP ${res.status}`);
  } catch (e) { $('s_hint').textContent = 'Send failed: ' + e.message; }
  $('s_auto').disabled = false;
}

async function quickLog(id, body) {
  const { error } = await supabase.from('pmh_job_events').insert({ job_id: id, author: me, kind: 'note', body });
  if (error) { alert('Could not log: ' + error.message); return; }
  // touch the job so updated_at resets the follow-up clock
  await supabase.from('pmh_jobs').update({ notes: body }).eq('id', id);
  await loadAll();
}

// ── UI wiring ───────────────────────────────────────────────
function wireUI() {
  $('addBtn').addEventListener('click', () => openModal(null));
  $('cancelBtn').addEventListener('click', closeModal);
  // Places autofill inside the New Company modal
  $('f_searchBtn').addEventListener('click', searchAutofill);
  $('f_search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchAutofill(); } });
  // Prospecting modal
  $('prospectBtn').addEventListener('click', openProspect);
  $('prospectClose').addEventListener('click', closeProspect);
  $('prospectRun').addEventListener('click', () => runProspect(false));
  $('prospectMore').addEventListener('click', () => runProspect(true));
  $('p_city').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runProspect(); } });
  $('p_type').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runProspect(); } });
  $('prospectBack').addEventListener('click', (e) => { if (e.target === $('prospectBack')) closeProspect(); });
  // Review & Send modal
  $('s_cancel').addEventListener('click', closeSend);
  $('s_mailto').addEventListener('click', openMailto);
  $('s_marksent').addEventListener('click', markSentManually);
  $('s_auto').addEventListener('click', sendAuto);
  $('sendBack').addEventListener('click', (e) => { if (e.target === $('sendBack')) closeSend(); });
  $('jobForm').addEventListener('submit', saveJob);
  $('modalBack').addEventListener('click', (e) => { if (e.target === $('modalBack')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeProspect(); closeSend(); } });
  $('infoClose').addEventListener('click', () => { $('infoBanner').style.display = 'none'; try { localStorage.setItem('pmh-info-hidden', '1'); } catch (_) {} });
  if (localStorage.getItem('pmh-info-hidden')) $('infoBanner').style.display = 'none';
  $('logoutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.replace('login.html'); });
}
