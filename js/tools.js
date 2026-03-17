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
var _ganttDragSrc = null;

var PRIORITY_CONFIG = {
  must:    { label: 'Must',          color: '#ef4444', printColor: '#dc2626' },
  crucial: { label: 'Crucial',       color: '#e2e8f0', printColor: '#111827' },
  nice:    { label: 'Nice to have',  color: '#10b981', printColor: '#059669' },
};

function addGanttRow(name, startDate, duration, priority, importance) {
  ganttRowCount++;
  const tbody = document.getElementById('gantt-tbody');
  if (!tbody) return;
  const rowId = 'gantt-row-' + ganttRowCount;
  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.setAttribute('draggable', 'true');

  const pri = priority || 'must';
  const imp = importance !== undefined ? importance : 5;

  const prioritySelect =
    '<select onchange="_ganttPriChange(this)" style="color:' + PRIORITY_CONFIG[pri].color + ';">' +
    Object.keys(PRIORITY_CONFIG).map(function(k) {
      return '<option value="' + k + '"' + (k === pri ? ' selected' : '') + ' style="color:' + PRIORITY_CONFIG[k].color + ';">' + PRIORITY_CONFIG[k].label + '</option>';
    }).join('') +
    '</select>';

  tr.innerHTML =
    '<td><span class="drag-handle" title="Drag to reorder">⠿</span></td>' +
    '<td><input type="text" value="' + escapeAttr(name || '') + '" placeholder="(e.g. Requirements gathering)" oninput="renderGantt()" /></td>' +
    '<td><input type="date" value="' + escapeAttr(startDate || GANTT_TODAY) + '" oninput="renderGantt()" /></td>' +
    '<td><input type="number" value="' + (duration !== undefined ? duration : 5) + '" min="1" oninput="renderGantt()" /></td>' +
    '<td>' + prioritySelect + '</td>' +
    '<td><input type="number" value="' + imp + '" min="1" max="10" style="width:44px;" oninput="renderGantt()" /></td>' +
    '<td><button class="btn-del-row" onclick="deleteGanttRow(\'' + rowId + '\')" title="Remove">×</button></td>';

  tbody.appendChild(tr);
  _attachGanttDrag(tr);
  renderGantt();
}

function _attachGanttDrag(tr) {
  tr.addEventListener('dragstart', function(e) {
    _ganttDragSrc = tr;
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  tr.addEventListener('dragend', function() {
    tr.classList.remove('dragging');
    document.querySelectorAll('#gantt-tbody tr').forEach(function(r) { r.classList.remove('drag-over'); });
    renderGantt();
  });
  tr.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('#gantt-tbody tr').forEach(function(r) { r.classList.remove('drag-over'); });
    tr.classList.add('drag-over');
  });
  tr.addEventListener('drop', function(e) {
    e.preventDefault();
    if (_ganttDragSrc && _ganttDragSrc !== tr) {
      const tbody = document.getElementById('gantt-tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const srcIdx = rows.indexOf(_ganttDragSrc);
      const tgtIdx = rows.indexOf(tr);
      if (srcIdx < tgtIdx) {
        tbody.insertBefore(_ganttDragSrc, tr.nextSibling);
      } else {
        tbody.insertBefore(_ganttDragSrc, tr);
      }
    }
  });
}

function _ganttPriChange(sel) {
  const cfg = PRIORITY_CONFIG[sel.value];
  if (cfg) sel.style.color = cfg.color;
  renderGantt();
}

function deleteGanttRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
  renderGantt();
}

function _getGanttTasks() {
  const tbody = document.getElementById('gantt-tbody');
  if (!tbody) return [];
  const tasks = [];
  tbody.querySelectorAll('tr').forEach(function(tr) {
    const inputs = tr.querySelectorAll('input');
    const select = tr.querySelector('select');
    if (inputs.length < 3) return;
    const name = inputs[0].value.trim() || 'Task';
    const startStr = inputs[1].value;
    const dur = parseInt(inputs[2].value, 10);
    const imp = parseInt(inputs[3] ? inputs[3].value : 5, 10) || 5;
    const pri = select ? select.value : 'must';
    if (!startStr || isNaN(dur) || dur < 1) return;
    const startMs = new Date(startStr).getTime();
    if (isNaN(startMs)) return;
    tasks.push({ name, startMs, endMs: startMs + (dur - 1) * 86400000, dur, pri, imp, startStr });
  });
  return tasks;
}

function renderGantt() {
  const container = document.getElementById('gantt-chart');
  if (!container) return;
  const tasks = _getGanttTasks();

  if (tasks.length === 0) {
    container.innerHTML = '<div class="gantt-empty">Add tasks above to see the chart.</div>';
    return;
  }

  const projectStart = Math.min.apply(null, tasks.map(function(t) { return t.startMs; }));
  const projectEnd   = Math.max.apply(null, tasks.map(function(t) { return t.endMs; }));
  const totalSpan    = projectEnd - projectStart || 86400000;
  const spanDays     = totalSpan / 86400000;
  const tickInterval = spanDays > 14 ? 7 : 3;

  const ticks = [];
  for (var ms = projectStart; ms <= projectEnd + tickInterval * 86400000; ms += tickInterval * 86400000) {
    ticks.push(ms);
  }

  const pct = function(ms) { return ((ms - projectStart) / totalSpan * 100).toFixed(2) + '%'; };
  const fmtDate = function(ms) {
    const d = new Date(ms);
    return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  };

  let html = '<div class="gantt-wrap"><div class="gantt-header-row"><div class="gantt-label-col"></div><div class="gantt-timeline-header">';
  for (const tick of ticks) {
    html += '<div class="gantt-tick-line" style="left:' + pct(tick) + '"></div>';
    html += '<div class="gantt-tick-label" style="left:' + pct(tick) + '">' + fmtDate(tick) + '</div>';
  }
  html += '</div></div>';

  for (const task of tasks) {
    const offsetPct = ((task.startMs - projectStart) / totalSpan * 100).toFixed(2);
    const widthPct  = Math.max(1, ((task.endMs - task.startMs + 86400000) / totalSpan * 100).toFixed(2));
    const barColor  = PRIORITY_CONFIG[task.pri] ? PRIORITY_CONFIG[task.pri].color : '#0FD9A0';
    const textColor = task.pri === 'crucial' ? '#05080F' : '#05080F';

    html += '<div class="gantt-row">';
    html += '<div class="gantt-row-label" title="' + escapeAttr(task.name) + '">' +
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + barColor + ';margin-right:6px;flex-shrink:0;vertical-align:middle;"></span>' +
      escapeAttr(task.name) + '</div>';
    html += '<div class="gantt-track">';
    for (const tick of ticks) {
      html += '<div style="position:absolute;top:0;bottom:0;left:' + pct(tick) + ';width:1px;background:var(--border-subtle);"></div>';
    }
    html += '<div class="gantt-bar" style="left:' + offsetPct + '%;width:' + widthPct + '%;background:' + barColor + ';">';
    html += '<span class="gantt-bar-label" style="color:' + textColor + ';">' + task.imp + ' · ' + escapeAttr(task.name) + '</span>';
    html += '</div></div></div>';
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
  addGanttRow('Initiating',           today,              5,  'must',    8);
  addGanttRow('Planning',             addWeeks(d0, 1),    10, 'must',    9);
  addGanttRow('Executing',            addWeeks(d0, 3),    30, 'must',    10);
  addGanttRow('Monitoring & Control', addWeeks(d0, 3),    35, 'crucial', 7);
  addGanttRow('Closing',              addWeeks(d0, 12),   5,  'nice',    5);
}

// ── PDF Print System ──────────────────────────────────────────

var _printProjectName = 'My Project';

function setPrintProjectName(name) {
  _printProjectName = name || 'My Project';
}

function printStyles() {
  return `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; padding: 32px; }
      .doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid #0BBF8C; margin-bottom: 24px; }
      .doc-title { font-size: 22px; font-weight: 600; color: #05080F; }
      .doc-subtitle { font-size: 12px; color: #666; margin-top: 4px; font-family: 'Space Mono', monospace; }
      .doc-meta { text-align: right; font-size: 11px; color: #888; font-family: 'Space Mono', monospace; line-height: 1.8; }
      .doc-meta strong { color: #0BBF8C; }
      .doc-footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #aaa; font-family: 'Space Mono', monospace; display: flex; justify-content: space-between; }
      h3 { font-size: 13px; font-family: 'Space Mono', monospace; text-transform: uppercase; letter-spacing: 0.06em; color: #0BBF8C; margin: 20px 0 8px; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      th { text-align: left; padding: 7px 10px; background: #f4f6fa; font-size: 10px; font-family: 'Space Mono', monospace; text-transform: uppercase; letter-spacing: 0.04em; color: #666; border-bottom: 1px solid #ddd; }
      td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 12px; vertical-align: top; }
      tr:last-child td { border-bottom: none; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 100px; font-size: 10px; font-family: 'Space Mono', monospace; font-weight: 700; }
      .pill-h { background: rgba(248,113,113,0.15); color: #dc2626; }
      .pill-m { background: rgba(245,166,35,0.15); color: #b45309; }
      .pill-l { background: rgba(15,217,160,0.15); color: #059669; }
      /* Tree */
      .tree-list { list-style: none; padding-left: 0; }
      .tree-list li { padding: 4px 0; }
      .tree-list li::before { content: '◈ '; color: #0BBF8C; font-size: 10px; }
      .tree-list .tree-l1 { font-weight: 600; font-size: 13px; margin-top: 10px; }
      .tree-list .tree-l2 { padding-left: 20px; color: #444; }
      .tree-list .tree-l2::before { content: '└ '; color: #ccc; }
      .tree-list .tree-l3 { padding-left: 40px; color: #666; font-size: 12px; }
      .tree-list .tree-l3::before { content: '└ '; color: #ddd; }
      /* Cost */
      .cost-table { width: 100%; }
      .cost-row { display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #eee; }
      .cost-row.calc { background: #f9fafb; }
      .cost-row.result { background: rgba(15,217,160,0.08); font-weight: 600; color: #059669; }
      .cost-row.final { background: rgba(245,166,35,0.08); font-weight: 700; font-size: 15px; color: #b45309; }
      .cost-label { font-size: 11px; font-family: 'Space Mono', monospace; text-transform: uppercase; color: #888; }
      .cost-value { font-family: 'Space Mono', monospace; font-weight: 700; }
      /* Gantt */
      .gantt-table { width: 100%; border-collapse: collapse; }
      .gantt-bar-cell { width: 55%; }
      .bar-bg { background: #f0f0f0; border-radius: 3px; height: 14px; position: relative; }
      .bar-fill { background: #0BBF8C; border-radius: 3px; height: 14px; min-width: 4px; }
      @media print {
        body { padding: 20px; }
        @page { margin: 15mm; size: A4; }
      }
    </style>`;
}

function docHeader(title, subtitle) {
  const date = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
  return `
    <div class="doc-header">
      <div>
        <div class="doc-title">${title}</div>
        <div class="doc-subtitle">${subtitle || ''}</div>
      </div>
      <div class="doc-meta">
        <div><strong>Project:</strong> ${escapeAttr(_printProjectName)}</div>
        <div><strong>Date:</strong> ${date}</div>
        <div><strong>Methodology:</strong> PM²</div>
      </div>
    </div>`;
}

function docFooter() {
  return `<div class="doc-footer"><span>PM Brief · pm-brief.com</span><span>Generated ${new Date().toLocaleDateString('en-IE')}</span></div>`;
}

function openPrintWindow(html) {
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PM Brief — Print</title>' + printStyles() + '</head><body>' + html + docFooter() + '</body></html>');
  w.document.close();
  setTimeout(function() { w.focus(); w.print(); }, 800);
}

// ── Print: WBS ───────────────────────────────────────────────

function printWBS() {
  if (!wbsState) return;
  function renderNode(state, nodeId, depth) {
    const node = state.nodes[nodeId];
    if (!node || (node.ghost && !node.label)) return '';
    const label = node.label || '(unnamed)';
    const cls = depth === 0 ? '' : depth === 1 ? 'tree-l1' : depth === 2 ? 'tree-l2' : 'tree-l3';
    let html = '<li class="' + cls + '">' + escapeAttr(label) + '</li>';
    for (const cid of node.children) html += renderNode(state, cid, depth + 1);
    return html;
  }
  const body = docHeader('Work Breakdown Structure', 'PM² Deliverable Decomposition') +
    '<ul class="tree-list">' + renderNode(wbsState, wbsState.rootId, 0) + '</ul>';
  openPrintWindow(body);
}

// ── Print: PBS ───────────────────────────────────────────────

function printPBS() {
  if (!pbsState) return;
  function renderNode(state, nodeId, depth) {
    const node = state.nodes[nodeId];
    if (!node || (node.ghost && !node.label)) return '';
    const label = node.label || '(unnamed)';
    const cls = depth === 0 ? '' : depth === 1 ? 'tree-l1' : depth === 2 ? 'tree-l2' : 'tree-l3';
    let html = '<li class="' + cls + '">' + escapeAttr(label) + '</li>';
    for (const cid of node.children) html += renderNode(state, cid, depth + 1);
    return html;
  }
  const body = docHeader('Project Breakdown Structure', 'PM² Activity Decomposition') +
    '<ul class="tree-list">' + renderNode(pbsState, pbsState.rootId, 0) + '</ul>';
  openPrintWindow(body);
}

// ── Print: Stakeholder Management Plan ───────────────────────

function printStakeholders() {
  const tbody = document.getElementById('sh-tbody');
  if (!tbody) return;
  let rows = '';
  tbody.querySelectorAll('tr').forEach(function(tr) {
    const inputs = tr.querySelectorAll('input');
    const selects = tr.querySelectorAll('select');
    if (!inputs.length) return;
    const name = inputs[0] ? inputs[0].value : '';
    const role = inputs[1] ? inputs[1].value : '';
    const interest = selects[0] ? selects[0].value : '';
    const influence = selects[1] ? selects[1].value : '';
    const strategy = inputs[2] ? inputs[2].value : '';
    const pillClass = function(v) { return v === 'H' ? 'pill-h' : v === 'M' ? 'pill-m' : 'pill-l'; };
    rows += '<tr>' +
      '<td>' + escapeAttr(name) + '</td>' +
      '<td>' + escapeAttr(role) + '</td>' +
      '<td><span class="pill ' + pillClass(interest) + '">' + interest + '</span></td>' +
      '<td><span class="pill ' + pillClass(influence) + '">' + influence + '</span></td>' +
      '<td>' + escapeAttr(strategy) + '</td>' +
      '</tr>';
  });
  const body = docHeader('Stakeholder Management Plan', 'PM² Stakeholder Register') +
    '<table><thead><tr><th>Name / Group</th><th>Role</th><th>Interest</th><th>Influence</th><th>Engagement Strategy</th></tr></thead><tbody>' + rows + '</tbody></table>';
  openPrintWindow(body);
}

// ── Print: Cost Estimation ────────────────────────────────────

function printCost() {
  const container = document.getElementById('cost-activities');
  if (!container) return;
  let actRows = '';
  let total = 0;
  container.querySelectorAll('.cost-activity-row').forEach(function(row) {
    const inputs = row.querySelectorAll('input');
    const name = inputs[0] ? inputs[0].value : '';
    const amt = parseFloat(inputs[1] ? inputs[1].value : 0) || 0;
    total += amt;
    actRows += '<tr><td>' + escapeAttr(name || '—') + '</td><td style="text-align:right;font-family:\'Space Mono\',monospace;">' + (amt ? formatCurrency(amt) : '—') + '</td></tr>';
  });
  const crPct = parseFloat((document.getElementById('cost-cr-pct') || {}).value) || 0;
  const mrPct = parseFloat((document.getElementById('cost-mr-pct') || {}).value) || 0;
  const cr = total * crPct / 100;
  const bac = total + cr;
  const mr = bac * mrPct / 100;
  const budget = bac + mr;

  const row = function(label, value, cls) {
    return '<div class="cost-row ' + (cls || '') + '"><span class="cost-label">' + label + '</span><span class="cost-value">' + value + '</span></div>';
  };

  const body = docHeader('Cost Estimation', 'PM² Bottom-Up Cost Hierarchy') +
    '<h3>Activity Estimates</h3>' +
    '<table><thead><tr><th>Activity</th><th style="text-align:right;">Estimate</th></tr></thead><tbody>' + actRows + '</tbody></table>' +
    '<div style="margin-top:16px;">' +
    row('Work Package Estimate', formatCurrency(total), 'calc') +
    row('Control Account Estimate', formatCurrency(total), 'calc') +
    row('Project Estimate', formatCurrency(total), 'calc') +
    row('Contingency Reserve (' + crPct + '%)', formatCurrency(cr), '') +
    row('Cost Performance Baseline (BAC)', formatCurrency(bac), 'result') +
    row('Management Reserve (' + mrPct + '%)', formatCurrency(mr), '') +
    row('Project Budget', formatCurrency(budget), 'final') +
    '</div>';
  openPrintWindow(body);
}

// ── Print: Gantt / Time Estimation ───────────────────────────

function printGantt() {
  const tasks = _getGanttTasks();
  if (!tasks.length) return;

  const projectStart = Math.min.apply(null, tasks.map(function(t) { return t.startMs; }));
  const projectEnd   = Math.max.apply(null, tasks.map(function(t) { return t.endMs; }));
  const totalSpan    = projectEnd - projectStart || 86400000;
  const fmtDate = function(str) { return new Date(str).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const endDate = function(t) { return new Date(t.endMs).toISOString().slice(0, 10); };

  let rows = '';
  tasks.forEach(function(t) {
    const offsetPct = ((t.startMs - projectStart) / totalSpan * 100).toFixed(1);
    const widthPct  = Math.max(2, ((t.endMs - t.startMs + 86400000) / totalSpan * 100).toFixed(1));
    const priCfg    = PRIORITY_CONFIG[t.pri] || PRIORITY_CONFIG.must;
    const barColor  = priCfg.printColor;
    rows += '<tr>' +
      '<td style="display:flex;align-items:center;gap:6px;">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + barColor + ';flex-shrink:0;"></span>' +
        escapeAttr(t.name) +
      '</td>' +
      '<td style="font-family:\'Space Mono\',monospace;font-size:11px;">' + fmtDate(t.startStr) + '</td>' +
      '<td style="font-family:\'Space Mono\',monospace;font-size:11px;">' + fmtDate(endDate(t)) + '</td>' +
      '<td style="text-align:center;font-family:\'Space Mono\',monospace;">' + t.dur + 'd</td>' +
      '<td style="text-align:center;font-family:\'Space Mono\',monospace;color:' + barColor + ';font-weight:700;">' + priCfg.label + '</td>' +
      '<td style="text-align:center;font-family:\'Space Mono\',monospace;">' + t.imp + '/10</td>' +
      '<td class="gantt-bar-cell"><div class="bar-bg"><div class="bar-fill" style="margin-left:' + offsetPct + '%;width:' + widthPct + '%;background:' + barColor + ';"></div></div></td>' +
      '</tr>';
  });

  const body = docHeader('Time Estimation — Project Schedule', 'PM² Gantt Chart') +
    '<table class="gantt-table"><thead><tr>' +
    '<th style="width:22%;">Task</th>' +
    '<th style="width:12%;">Start</th>' +
    '<th style="width:12%;">End</th>' +
    '<th style="width:6%;">Dur.</th>' +
    '<th style="width:10%;">Priority</th>' +
    '<th style="width:6%;">Imp.</th>' +
    '<th class="gantt-bar-cell">Timeline</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
  openPrintWindow(body);
}
