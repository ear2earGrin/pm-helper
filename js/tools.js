'use strict';

/* ============================================================
   PM Helper — Planning Tools
   Shared by tools.html (standalone) and app.html (post-wizard)
   ============================================================ */

// ── Utilities ────────────────────────────────────────────────

function formatCurrency(n) {
  return '€ ' + n.toLocaleString('en-IE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Tree Engine ───────────────────────────────────────────────

let _nodeCounter = 100;
function newNodeId() { return 'n' + (++_nodeCounter); }

function makeTreeState(rootLabel, childLabels) {
  const rootId = newNodeId();
  const state = { rootId, nodes: {} };
  state.nodes[rootId] = { id: rootId, label: rootLabel, children: [] };
  for (const label of childLabels) {
    const id = newNodeId();
    state.nodes[id] = { id, label, children: [] };
    state.nodes[rootId].children.push(id);
  }
  return state;
}

function getNodeDepth(state, nodeId) {
  function findDepth(id, depth) {
    if (id === nodeId) return depth;
    const node = state.nodes[id];
    if (!node) return -1;
    for (const childId of node.children) {
      const d = findDepth(childId, depth + 1);
      if (d !== -1) return d;
    }
    return -1;
  }
  return findDepth(state.rootId, 0);
}

function getWbsPlaceholder(depth) {
  switch (depth) {
    case 0: return '(e.g. My Project)';
    case 1: return '(e.g. Planning, Execution)';
    case 2: return '(e.g. Project Charter)';
    default: return '(e.g. Charter draft)';
  }
}

function getPbsPlaceholder(depth) {
  switch (depth) {
    case 0: return '(e.g. My Project)';
    case 1: return '(e.g. Planning activities)';
    case 2: return '(e.g. Draft plan)';
    default: return '(e.g. Write section)';
  }
}

function buildNodeHTML(state, nodeId, treeType) {
  const node = state.nodes[nodeId];
  if (!node) return '';
  const isRoot = nodeId === state.rootId;
  const depth = getNodeDepth(state, nodeId);
  const placeholder = treeType === 'pbs' ? getPbsPlaceholder(depth) : getWbsPlaceholder(depth);
  const rootClass = isRoot ? ' root-node' : '';

  let html = '<div class="tree-node" data-node-id="' + nodeId + '">';
  html += '<div class="tree-node-inner' + rootClass + '">';
  html += '<input type="text" class="tree-node-label" value="' + escapeAttr(node.label) + '" placeholder="' + escapeAttr(placeholder) + '" data-node-id="' + nodeId + '" />';
  html += '<button class="tree-add-btn" data-action="add" data-node-id="' + nodeId + '" title="Add child">+</button>';
  if (!isRoot) {
    html += '<button class="tree-del-btn" data-action="delete" data-node-id="' + nodeId + '" title="Remove">×</button>';
  }
  html += '</div>';

  if (node.children.length > 0) {
    html += '<div class="tree-connector"></div>';
    html += '<div class="tree-children-row">';
    for (const childId of node.children) {
      html += buildNodeHTML(state, childId, treeType);
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderTree(state, containerId, treeType) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="tree-row">' + buildNodeHTML(state, state.rootId, treeType) + '</div>';

  container.querySelectorAll('.tree-node-label').forEach(function(input) {
    input.addEventListener('input', function() {
      const nid = this.dataset.nodeId;
      if (state.nodes[nid]) state.nodes[nid].label = this.value;
    });
  });

  container.addEventListener('click', function handler(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const nid = btn.dataset.nodeId;
    if (action === 'add') addTreeNode(state, nid, containerId, treeType);
    else if (action === 'delete') deleteTreeNode(state, nid, containerId, treeType);
  });
}

function addTreeNode(state, parentId, containerId, treeType) {
  const id = newNodeId();
  state.nodes[id] = { id, label: '', children: [] };
  state.nodes[parentId].children.push(id);
  renderTree(state, containerId, treeType);
  const container = document.getElementById(containerId);
  const newInput = container && container.querySelector('[data-node-id="' + id + '"].tree-node-label');
  if (newInput) newInput.focus();
}

function deleteTreeNode(state, nodeId, containerId, treeType) {
  if (nodeId === state.rootId) return;
  function removeSubtree(id) {
    const node = state.nodes[id];
    if (!node) return;
    for (const childId of node.children) removeSubtree(childId);
    delete state.nodes[id];
  }
  for (const nid in state.nodes) {
    const node = state.nodes[nid];
    const idx = node.children.indexOf(nodeId);
    if (idx !== -1) { node.children.splice(idx, 1); break; }
  }
  removeSubtree(nodeId);
  renderTree(state, containerId, treeType);
}

// ── WBS ──────────────────────────────────────────────────────

var wbsState;
function resetWBS() {
  wbsState = makeTreeState(wbsState ? wbsState.nodes[wbsState.rootId].label : 'My Project', ['Planning', 'Execution', 'Closeout']);
  renderTree(wbsState, 'wbs-tree', 'wbs');
}

// ── PBS ──────────────────────────────────────────────────────

var pbsState;
function resetPBS() {
  pbsState = makeTreeState(pbsState ? pbsState.nodes[pbsState.rootId].label : 'My Project', ['Planning activities', 'Execution activities', 'Monitoring activities']);
  renderTree(pbsState, 'pbs-tree', 'pbs');
}

// ── Stakeholders ──────────────────────────────────────────────

var shRowCount = 0;

function addStakeholderRow(name, role, interest, influence, strategy) {
  shRowCount++;
  const tbody = document.getElementById('sh-tbody');
  if (!tbody) return;
  const rowId = 'sh-row-' + shRowCount;
  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.innerHTML =
    '<td><input type="text" value="' + escapeAttr(name || '') + '" placeholder="(e.g. IT Department)" /></td>' +
    '<td><input type="text" value="' + escapeAttr(role || '') + '" placeholder="(e.g. Project Owner)" /></td>' +
    '<td>' + buildSelectHTML(['H', 'M', 'L'], interest || 'H') + '</td>' +
    '<td>' + buildSelectHTML(['H', 'M', 'L'], influence || 'H') + '</td>' +
    '<td><input type="text" value="' + escapeAttr(strategy || '') + '" placeholder="(e.g. Weekly steering update)" /></td>' +
    '<td><button class="btn-del-row" onclick="deleteStakeholderRow(\'' + rowId + '\')" title="Remove">×</button></td>';
  tbody.appendChild(tr);
}

function buildSelectHTML(options, selected) {
  let html = '<select>';
  for (const opt of options) {
    html += '<option value="' + opt + '"' + (opt === selected ? ' selected' : '') + '>' + opt + '</option>';
  }
  return html + '</select>';
}

function deleteStakeholderRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
}

// ── Cost ──────────────────────────────────────────────────────

var costRowCount = 0;

function addCostRow(name, amount) {
  costRowCount++;
  const container = document.getElementById('cost-activities');
  if (!container) return;
  const rowId = 'cost-row-' + costRowCount;
  const div = document.createElement('div');
  div.id = rowId;
  div.className = 'cost-activity-row';
  div.innerHTML =
    '<input type="text" class="field-input" style="flex:1;" value="' + escapeAttr(name || '') + '" placeholder="(e.g. Requirements workshop)" />' +
    '<input type="number" class="field-input" style="width:120px;font-family:var(--font-mono);" value="' + (amount !== undefined ? amount : '') + '" placeholder="(e.g. 2000)" min="0" oninput="recalcCosts()" />' +
    '<button class="btn-del-row" onclick="deleteCostRow(\'' + rowId + '\')" title="Remove">×</button>';
  container.appendChild(div);
  recalcCosts();
}

function deleteCostRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
  recalcCosts();
}

function recalcCosts() {
  const container = document.getElementById('cost-activities');
  if (!container) return;
  let total = 0;
  container.querySelectorAll('input[type="number"]').forEach(function(inp) {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) total += v;
  });
  const crPct = parseFloat((document.getElementById('cost-cr-pct') || {}).value) || 0;
  const mrPct = parseFloat((document.getElementById('cost-mr-pct') || {}).value) || 0;
  const crVal = total * crPct / 100;
  const bac = total + crVal;
  const mrVal = bac * mrPct / 100;
  const budget = bac + mrVal;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = formatCurrency(val); };
  set('cost-wp', total);
  set('cost-ca', total);
  set('cost-pe', total);
  set('cost-cr-val', crVal);
  set('cost-bac', bac);
  set('cost-mr-val', mrVal);
  set('cost-budget', budget);
}

// ── Gantt ─────────────────────────────────────────────────────

var ganttRowCount = 0;
var GANTT_TODAY = new Date().toISOString().slice(0, 10);

function addGanttRow(name, startDate, duration) {
  ganttRowCount++;
  const tbody = document.getElementById('gantt-tbody');
  if (!tbody) return;
  const rowId = 'gantt-row-' + ganttRowCount;
  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.innerHTML =
    '<td><input type="text" value="' + escapeAttr(name || '') + '" placeholder="(e.g. Requirements gathering)" oninput="renderGantt()" /></td>' +
    '<td><input type="date" value="' + escapeAttr(startDate || GANTT_TODAY) + '" oninput="renderGantt()" /></td>' +
    '<td><input type="number" value="' + (duration !== undefined ? duration : 5) + '" min="1" oninput="renderGantt()" /></td>' +
    '<td><button class="btn-del-row" onclick="deleteGanttRow(\'' + rowId + '\')" title="Remove">×</button></td>';
  tbody.appendChild(tr);
  renderGantt();
}

function deleteGanttRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
  renderGantt();
}

function renderGantt() {
  const tbody = document.getElementById('gantt-tbody');
  const container = document.getElementById('gantt-chart');
  if (!tbody || !container) return;

  const tasks = [];
  tbody.querySelectorAll('tr').forEach(function(tr) {
    const inputs = tr.querySelectorAll('input');
    if (inputs.length < 3) return;
    const name = inputs[0].value.trim() || 'Task';
    const startStr = inputs[1].value;
    const dur = parseInt(inputs[2].value, 10);
    if (!startStr || isNaN(dur) || dur < 1) return;
    const startMs = new Date(startStr).getTime();
    if (isNaN(startMs)) return;
    tasks.push({ name, startMs, endMs: startMs + (dur - 1) * 86400000, dur });
  });

  if (tasks.length === 0) {
    container.innerHTML = '<div class="gantt-empty">Add tasks above to see the chart.</div>';
    return;
  }

  const projectStart = Math.min(...tasks.map(t => t.startMs));
  const projectEnd   = Math.max(...tasks.map(t => t.endMs));
  const totalSpan    = projectEnd - projectStart || 86400000;
  const spanDays     = totalSpan / 86400000;
  const tickInterval = spanDays > 14 ? 7 : 3;

  const ticks = [];
  for (let ms = projectStart; ms <= projectEnd + tickInterval * 86400000; ms += tickInterval * 86400000) {
    ticks.push(ms);
  }

  const pct = ms => ((ms - projectStart) / totalSpan * 100).toFixed(2) + '%';
  const fmtDate = ms => { const d = new Date(ms); return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]; };

  let html = '<div class="gantt-wrap"><div class="gantt-header-row"><div class="gantt-label-col"></div><div class="gantt-timeline-header">';
  for (const tick of ticks) {
    html += '<div class="gantt-tick-line" style="left:' + pct(tick) + '"></div>';
    html += '<div class="gantt-tick-label" style="left:' + pct(tick) + '">' + fmtDate(tick) + '</div>';
  }
  html += '</div></div>';

  for (const task of tasks) {
    const offsetPct = ((task.startMs - projectStart) / totalSpan * 100).toFixed(2);
    const widthPct  = ((task.endMs - task.startMs + 86400000) / totalSpan * 100).toFixed(2);
    html += '<div class="gantt-row"><div class="gantt-row-label" title="' + escapeAttr(task.name) + '">' + escapeAttr(task.name) + '</div><div class="gantt-track">';
    for (const tick of ticks) html += '<div style="position:absolute;top:0;bottom:0;left:' + pct(tick) + ';width:1px;background:var(--border-subtle);"></div>';
    html += '<div class="gantt-bar" style="left:' + offsetPct + '%;width:' + widthPct + '%;"><span class="gantt-bar-label">' + escapeAttr(task.name) + '</span></div></div></div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

// ── initTools — called after AI results are rendered ─────────

function initTools(projectName) {
  const name = projectName || 'My Project';

  // Reset counters so IDs don't clash on re-init
  shRowCount = 0;
  costRowCount = 0;
  ganttRowCount = 0;

  // Clear any existing rows (for re-runs)
  ['sh-tbody', 'cost-activities', 'gantt-tbody'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  // Trees
  wbsState = makeTreeState(name, ['Planning', 'Execution', 'Closeout']);
  pbsState = makeTreeState(name, ['Planning activities', 'Execution activities', 'Monitoring activities']);
  renderTree(wbsState, 'wbs-tree', 'wbs');
  renderTree(pbsState, 'pbs-tree', 'pbs');

  // Stakeholders
  addStakeholderRow('Project Sponsor', 'Sponsor', 'H', 'H', 'Monthly steering committee');
  addStakeholderRow('End Users', 'End User', 'H', 'M', 'Regular demos and feedback sessions');

  // Cost
  addCostRow('Requirements & analysis', 2000);
  addCostRow('Design & prototyping', 5000);
  addCostRow('Development', 18000);
  recalcCosts();

  // Gantt
  const today = GANTT_TODAY;
  const d = new Date(today);
  const w1 = new Date(d); w1.setDate(d.getDate() + 7);
  const w3 = new Date(d); w3.setDate(d.getDate() + 21);
  addGanttRow('Requirements gathering', today, 5);
  addGanttRow('Design', w1.toISOString().slice(0, 10), 7);
  addGanttRow('Development', w3.toISOString().slice(0, 10), 14);
}
