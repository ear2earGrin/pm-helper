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

// items = array of { label, ghost?, children?: [{label, ghost?}] }
function makeTreeState(rootLabel, items) {
  const rootId = newNodeId();
  const state = { rootId, nodes: {} };
  state.nodes[rootId] = { id: rootId, label: rootLabel, ghost: false, children: [] };
  for (const item of items) {
    const id = newNodeId();
    state.nodes[id] = { id, label: item.label || '', ghost: !!item.ghost, children: [] };
    state.nodes[rootId].children.push(id);
    for (const child of (item.children || [])) {
      const cid = newNodeId();
      state.nodes[cid] = { id: cid, label: child.label || '', ghost: !!child.ghost, children: [] };
      state.nodes[id].children.push(cid);
    }
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
  const rootClass = isRoot ? ' root-node' : (node.ghost ? ' ghost-node' : '');
  const displayValue = node.ghost ? '' : node.label;
  const displayPlaceholder = node.ghost ? '...' : placeholder;

  let html = '<div class="tree-node" data-node-id="' + nodeId + '">';
  html += '<div class="tree-node-inner' + rootClass + '">';
  html += '<input type="text" class="tree-node-label' + (node.ghost ? ' ghost-label' : '') + '" value="' + escapeAttr(displayValue) + '" placeholder="' + escapeAttr(displayPlaceholder) + '" data-node-id="' + nodeId + '" />';
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
      if (state.nodes[nid]) {
        state.nodes[nid].label = this.value;
        // Promote ghost to real node when user starts typing
        if (state.nodes[nid].ghost && this.value.length > 0) {
          state.nodes[nid].ghost = false;
          this.classList.remove('ghost-label');
          this.closest('.tree-node-inner').classList.remove('ghost-node');
        }
      }
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
var _lastWbsItems = null;

function resetWBS() {
  const name = wbsState ? wbsState.nodes[wbsState.rootId].label : 'My Project';
  const items = _lastWbsItems || defaultWbsItems();
  wbsState = makeTreeState(name, items);
  renderTree(wbsState, 'wbs-tree', 'wbs');
}

function defaultWbsItems() {
  return [
    { label: 'Project Management', children: [{ label: '', ghost: true }, { label: '', ghost: true }] },
    { label: 'Requirements', children: [{ label: '', ghost: true }, { label: '', ghost: true }] },
    { label: 'Delivery', children: [{ label: '', ghost: true }, { label: '', ghost: true }] },
    { label: '', ghost: true },
  ];
}

// ── PBS ──────────────────────────────────────────────────────

var pbsState;
var _lastPbsItems = null;

function resetPBS() {
  const name = pbsState ? pbsState.nodes[pbsState.rootId].label : 'My Project';
  const items = _lastPbsItems || defaultPbsItems();
  pbsState = makeTreeState(name, items);
  renderTree(pbsState, 'pbs-tree', 'pbs');
}

function defaultPbsItems() {
  return [
    { label: 'Initiating', children: [{ label: 'Draft Project Charter' }, { label: 'Identify Stakeholders' }, { label: '', ghost: true }] },
    { label: 'Planning', children: [{ label: 'Create WBS' }, { label: 'Develop Schedule' }, { label: 'Estimate Costs' }, { label: '', ghost: true }] },
    { label: 'Executing', children: [{ label: '', ghost: true }, { label: '', ghost: true }, { label: '', ghost: true }] },
    { label: 'Monitoring & Control', children: [{ label: 'Track Progress' }, { label: 'Manage Risks' }, { label: '', ghost: true }] },
    { label: 'Closing', children: [{ label: 'Lessons Learned' }, { label: 'Project Sign-off' }, { label: '', ghost: true }] },
  ];
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

function initTools(projectName, artefacts, answers) {
  const name = projectName || 'My Project';

  // Reset counters
  shRowCount = 0;
  costRowCount = 0;
  ganttRowCount = 0;
  ['sh-tbody', 'cost-activities', 'gantt-tbody'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  // ── WBS: Level 1 = AI-generated in-scope items ──────────────
  const inScope = (artefacts && artefacts.charter && artefacts.charter.scope && artefacts.charter.scope.inScope) || [];

  const wbsItems = inScope.slice(0, 6).map(function(item) {
    // Truncate long labels
    const label = item.length > 40 ? item.slice(0, 38) + '…' : item;
    return {
      label: label,
      children: [{ label: '', ghost: true }, { label: '', ghost: true }]
    };
  });

  // Always add "Project Management" if not already in scope
  const hasPM = wbsItems.some(function(i) { return i.label.toLowerCase().includes('project manag'); });
  if (!hasPM) {
    wbsItems.unshift({
      label: 'Project Management',
      children: [
        { label: 'Project Charter' },
        { label: 'Project Work Plan' },
        { label: '', ghost: true }
      ]
    });
  }

  // Add ghost node at end for user to expand
  wbsItems.push({ label: '', ghost: true });

  _lastWbsItems = wbsItems;
  wbsState = makeTreeState(name, wbsItems);
  renderTree(wbsState, 'wbs-tree', 'wbs');

  // ── PBS: PM² phases with context-aware activities ───────────
  const risks = (artefacts && artefacts.risks) || [];
  const riskActions = risks.slice(0, 2).map(function(r) {
    return { label: r.responseAction ? r.responseAction.slice(0, 40) : 'Manage: ' + (r.cause || '').slice(0, 30) };
  });

  const pbsItems = [
    {
      label: 'Initiating',
      children: [
        { label: 'Draft Project Charter' },
        { label: 'Identify Stakeholders' },
        { label: 'Define Scope & Objectives' },
        { label: '', ghost: true }
      ]
    },
    {
      label: 'Planning',
      children: [
        { label: 'Build WBS & PBS' },
        { label: 'Develop Project Schedule' },
        { label: 'Estimate Costs & Budget' },
        { label: 'Plan Risk Responses' },
        { label: '', ghost: true }
      ]
    },
    {
      label: 'Executing',
      children: inScope.slice(0, 3).map(function(item) {
        return { label: 'Deliver: ' + (item.length > 30 ? item.slice(0, 28) + '…' : item) };
      }).concat([{ label: '', ghost: true }, { label: '', ghost: true }])
    },
    {
      label: 'Monitoring & Control',
      children: [
        { label: 'Track Progress vs. Plan' },
        { label: 'Report to Steering Committee' },
      ].concat(riskActions).concat([{ label: '', ghost: true }])
    },
    {
      label: 'Closing',
      children: [
        { label: 'Lessons Learned Review' },
        { label: 'Project Acceptance Sign-off' },
        { label: 'Archive Project Documents' },
        { label: '', ghost: true }
      ]
    },
  ];

  _lastPbsItems = pbsItems;
  pbsState = makeTreeState(name, pbsItems);
  renderTree(pbsState, 'pbs-tree', 'pbs');

  // ── Stakeholders: seed from AI stakeholder matrix ───────────
  const aiStakeholders = (artefacts && artefacts.stakeholders) || [];
  if (aiStakeholders.length > 0) {
    aiStakeholders.slice(0, 6).forEach(function(sh) {
      const interest = (sh.interest || 'M').charAt(0).toUpperCase();
      const influence = (sh.influence || 'M').charAt(0).toUpperCase();
      addStakeholderRow(
        sh.nameOrGroup || sh.role || '',
        sh.role || '',
        interest,
        influence,
        sh.engagementStrategy || ''
      );
    });
  } else {
    addStakeholderRow('Project Sponsor', 'Sponsor', 'H', 'H', 'Monthly steering committee');
    addStakeholderRow('End Users', 'End User', 'H', 'M', 'Regular demos and feedback sessions');
  }

  // ── Cost: seed with activities from in-scope items ──────────
  if (inScope.length > 0) {
    inScope.slice(0, 4).forEach(function(item) {
      addCostRow(item.length > 35 ? item.slice(0, 33) + '…' : item, '');
    });
  } else {
    addCostRow('Requirements & analysis', '');
    addCostRow('Design & prototyping', '');
    addCostRow('Development', '');
  }
  addCostRow('Testing & QA', '');
  addCostRow('Project Management', '');
  recalcCosts();

  // ── Gantt: seed with PBS phases as tasks ────────────────────
  const today = GANTT_TODAY;
  const d0 = new Date(today);
  function addWeeks(d, w) { const n = new Date(d); n.setDate(n.getDate() + w * 7); return n.toISOString().slice(0, 10); }
  addGanttRow('Initiating', today, 5);
  addGanttRow('Planning', addWeeks(d0, 1), 10);
  addGanttRow('Executing', addWeeks(d0, 3), 30);
  addGanttRow('Monitoring & Control', addWeeks(d0, 3), 35);
  addGanttRow('Closing', addWeeks(d0, 12), 5);
}
