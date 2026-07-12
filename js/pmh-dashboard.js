// ============================================================
//  Redesign Studio — dashboard logic
// ============================================================
import { supabase, currentUsername } from './pmh-supabase.js';

// ── Status model ────────────────────────────────────────────
const STATUS = {
  lead:        { label: 'Lead',        color: '#8B93A8' },
  redesigning: { label: 'Redesigning', color: '#A78BFA' },
  sent:        { label: 'Sent',        color: '#F5A623' },
  replied:     { label: 'Replied',     color: '#0FD9A0' },
  finished:    { label: 'Finished',    color: '#0FD9A0' },
  passed:      { label: 'Passed',      color: '#4A5268' },
};
const STATUS_ORDER = ['lead', 'redesigning', 'sent', 'replied', 'finished', 'passed'];

const TABS = [
  { key: 'all',      label: 'All',         match: () => true },
  { key: 'active',   label: 'Active',      match: (s) => ['lead', 'redesigning', 'sent', 'replied'].includes(s) },
  { key: 'redesign', label: 'Redesigning', match: (s) => s === 'redesigning' },
  { key: 'sent',     label: 'Sent',        match: (s) => s === 'sent' || s === 'replied' },
  { key: 'finished', label: 'Finished',    match: (s) => s === 'finished' },
  { key: 'passed',   label: 'Passed',      match: (s) => s === 'passed' },
];

// ── State ───────────────────────────────────────────────────
let jobs = [];
let eventsByJob = {};   // job_id -> [events]
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
  wireUI();
  await loadAll();
  subscribeRealtime();
})();

function buildStatusSelect() {
  $('f_status').innerHTML = STATUS_ORDER
    .map((k) => `<option value="${k}">${STATUS[k].label}</option>`).join('');
}

// ── Data loading ────────────────────────────────────────────
async function loadAll() {
  const [jobsRes, evRes] = await Promise.all([
    supabase.from('pmh_jobs').select('*').order('updated_at', { ascending: false }),
    supabase.from('pmh_job_events').select('*').order('created_at', { ascending: false }),
  ]);
  if (jobsRes.error) { console.error(jobsRes.error); }
  jobs = jobsRes.data || [];
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
  const tiles = [
    { n: counts.total, l: 'Companies', c: 'var(--text-primary)' },
    { n: counts.redesigning, l: 'Redesigning', c: STATUS.redesigning.color },
    { n: counts.sent + counts.replied, l: 'Pitched', c: STATUS.sent.color },
    { n: counts.finished, l: 'Finished', c: STATUS.finished.color },
  ];
  $('stats').innerHTML = tiles.map((t) =>
    `<div class="stat"><div class="stat-n" style="color:${t.c}">${t.n}</div><div class="stat-l">${t.l}</div></div>`
  ).join('');
}

function renderTabs() {
  $('tabs').innerHTML = TABS.map((t) => {
    const n = jobs.filter((j) => t.match(j.status)).length;
    return `<button class="db-tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label}<span class="cnt">${n}</span></button>`;
  }).join('');
  $('tabs').querySelectorAll('.db-tab').forEach((b) =>
    b.addEventListener('click', () => { activeTab = b.dataset.tab; render(); }));
}

function renderBoard() {
  const tab = TABS.find((t) => t.key === activeTab);
  const list = jobs.filter((j) => tab.match(j.status));
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

  const redesign = j.redesign_url
    ? `<div class="job-redesign"><span>🎨</span><a href="${esc(j.redesign_url)}" target="_blank" rel="noopener">View redesign →</a></div>`
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
        <div class="job-company">${esc(j.company)}</div>
        ${j.owner ? `<div class="job-owner">@${esc(j.owner)}</div>` : ''}
      </div>
      ${statusSelect}
    </div>
    ${metaRows.length ? `<div class="job-meta">${metaRows.join('')}</div>` : ''}
    ${redesign}
    ${notes}
    ${timeline}
    <div class="job-foot">
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

// ── UI wiring ───────────────────────────────────────────────
function wireUI() {
  $('addBtn').addEventListener('click', () => openModal(null));
  $('cancelBtn').addEventListener('click', closeModal);
  $('jobForm').addEventListener('submit', saveJob);
  $('modalBack').addEventListener('click', (e) => { if (e.target === $('modalBack')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  $('infoClose').addEventListener('click', () => { $('infoBanner').style.display = 'none'; try { localStorage.setItem('pmh-info-hidden', '1'); } catch (_) {} });
  if (localStorage.getItem('pmh-info-hidden')) $('infoBanner').style.display = 'none';
  $('logoutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.replace('login.html'); });
}
