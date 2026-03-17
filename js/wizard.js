/* ============================================================
   PM Helper — Wizard Logic
   Sprint 0 · Vanilla JS · Claude API Integration
   ============================================================ */

'use strict';

// ── Config ──────────────────────────────────────────────────
const CONFIG = {
  // Replace this with your deployed Cloudflare Worker URL after running: wrangler deploy
  WORKER_ENDPOINT: 'https://pm-helper-api.mindarvokn.workers.dev',
};

// ── Wizard Questions ─────────────────────────────────────────
const QUESTIONS = [
  {
    id: 'projectName',
    label: 'What is the name of your project?',
    hint: 'A clear, memorable name used consistently across all artefacts.',
    placeholder: 'e.g. Customer Portal Redesign',
    type: 'text',
    required: true,
  },
  {
    id: 'objective',
    label: 'What is the objective of this project?',
    hint: 'Describe the problem you\'re solving and the desired outcome. Be specific.',
    placeholder: 'e.g. Redesign the customer portal to reduce support ticket volume by 40% and improve NPS by 15 points by Q3 2026.',
    type: 'textarea',
    required: true,
  },
  {
    id: 'projectOwner',
    label: 'Who is the Project Owner (sponsor)?',
    hint: 'The person who funds and has ultimate decision authority over this project.',
    placeholder: 'e.g. Sarah Chen, VP of Product',
    type: 'text',
    required: true,
  },
  {
    id: 'userReps',
    label: 'Who are the main users or beneficiaries?',
    hint: 'Who will use or be directly affected by the project deliverables?',
    placeholder: 'e.g. Customer support team (primary), end customers (secondary), marketing department',
    type: 'textarea',
    required: true,
  },
  {
    id: 'deadline',
    label: 'What is the target completion date?',
    hint: 'When does this project need to be delivered?',
    placeholder: 'e.g. 30 September 2026',
    type: 'text',
    required: true,
  },
  {
    id: 'budget',
    label: 'What is the estimated budget or resource level?',
    hint: 'Include headcount, budget range, or available resources. Leave blank if unknown.',
    placeholder: 'e.g. €150,000 budget · 4 developers + 1 designer',
    type: 'text',
    required: false,
  },
  {
    id: 'risks',
    label: 'What are the biggest risks you foresee?',
    hint: 'List 2–4 things that could go wrong, cause delays, or derail the project.',
    placeholder: 'e.g.\n1. Key stakeholder unavailability during UAT phase\n2. Third-party API integration delays\n3. Scope creep from marketing requests\n4. Team capacity conflicts with other projects',
    type: 'textarea',
    required: true,
  },
  {
    id: 'successCriteria',
    label: 'What does success look like?',
    hint: 'Define measurable criteria. How will you know the project succeeded?',
    placeholder: 'e.g. Support tickets reduced by 40%, NPS +15 points, 90% user adoption within 60 days of launch, zero critical bugs at go-live.',
    type: 'textarea',
    required: true,
  },
];

// ── State ────────────────────────────────────────────────────
const state = {
  currentStep: 0,
  answers: {},
  artefacts: null,
};

// ── DOM References ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dom = {
  // Views
  wizardView: $('wizard-view'),
  loadingView: $('loading-view'),
  resultsView: $('results-view'),
  errorView: $('error-view'),

  // Wizard
  progressBar: $('progress-bar'),
  progressLabel: $('progress-label'),
  questionArea: $('question-area'),
  backBtn: $('back-btn'),
  nextBtn: $('next-btn'),

  // Loading
  loadingSub: $('loading-sub'),
  ls1: $('ls-1'),
  ls2: $('ls-2'),
  ls3: $('ls-3'),

  // Results
  resultsProjectName: $('results-project-name'),
  retryBtn: $('retry-btn'),
  errorMessage: $('error-message'),
  newProjectBtn: $('new-project-btn'),
  coachingNudge: $('coaching-nudge'),
};

// ── API Key Management (removed — key is server-side) ─────────

// ── View Switching ────────────────────────────────────────────
function showView(viewId) {
  ['wizard-view', 'loading-view', 'results-view', 'error-view'].forEach((id) => {
    $(id).classList.add('hidden');
  });
  $(viewId).classList.remove('hidden');
}

// ── Progress ──────────────────────────────────────────────────
function updateProgress() {
  const pct = ((state.currentStep + 1) / QUESTIONS.length) * 100;
  dom.progressBar.style.width = pct + '%';
  dom.progressLabel.textContent = `Step ${state.currentStep + 1} of ${QUESTIONS.length}`;
}

// ── Question Rendering ────────────────────────────────────────
function renderQuestion(index) {
  const q = QUESTIONS[index];
  const saved = state.answers[q.id] || '';

  let inputHtml = '';
  if (q.type === 'textarea') {
    inputHtml = `<textarea
      id="q-input"
      class="field-textarea"
      placeholder="${q.placeholder}"
      rows="5"
      ${q.required ? 'required' : ''}
    >${saved}</textarea>`;
  } else {
    inputHtml = `<input
      type="text"
      id="q-input"
      class="field-input"
      placeholder="${q.placeholder}"
      value="${saved}"
      ${q.required ? 'required' : ''}
    />`;
  }

  dom.questionArea.innerHTML = `
    <div class="question-slide">
      <p class="q-step">${String(index + 1).padStart(2, '0')} / ${String(QUESTIONS.length).padStart(2, '0')}</p>
      <h2 class="q-label">${q.label}${!q.required ? '<span class="q-optional">optional</span>' : ''}</h2>
      <p class="q-hint">${q.hint}</p>
      ${inputHtml}
    </div>
  `;

  // Focus the input
  setTimeout(() => {
    const input = $('q-input');
    if (input) {
      input.focus();
      // Move cursor to end for textarea
      if (q.type === 'textarea' && saved) {
        input.setSelectionRange(saved.length, saved.length);
      }
    }
  }, 50);

  // Allow Enter to advance (not for textarea)
  if (q.type === 'text') {
    $('q-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') advanceWizard();
    });
  }

  // Update nav buttons
  dom.backBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
  dom.nextBtn.textContent = index === QUESTIONS.length - 1 ? 'Generate artefacts →' : 'Next →';
  updateProgress();
}

// ── Wizard Navigation ─────────────────────────────────────────
function getCurrentAnswer() {
  const input = $('q-input');
  return input ? input.value.trim() : '';
}

function advanceWizard() {
  const q = QUESTIONS[state.currentStep];
  const answer = getCurrentAnswer();

  if (q.required && !answer) {
    const input = $('q-input');
    if (input) {
      input.style.borderColor = 'var(--danger)';
      input.style.boxShadow = '0 0 0 3px var(--danger-dim)';
      setTimeout(() => {
        input.style.borderColor = '';
        input.style.boxShadow = '';
      }, 1500);
    }
    return;
  }

  state.answers[q.id] = answer;

  if (state.currentStep < QUESTIONS.length - 1) {
    state.currentStep++;
    renderQuestion(state.currentStep);
  } else {
    startGeneration();
  }
}

dom.nextBtn.addEventListener('click', advanceWizard);

dom.backBtn.addEventListener('click', () => {
  // Save current answer before going back
  const q = QUESTIONS[state.currentStep];
  state.answers[q.id] = getCurrentAnswer();

  if (state.currentStep > 0) {
    state.currentStep--;
    renderQuestion(state.currentStep);
  }
});

// ── Prompt Builder ────────────────────────────────────────────
function buildPrompt(answers) {
  return `You are a senior PM² project management expert. Given the following project information, generate five PM²-compliant artefacts.

PROJECT INFORMATION:
- Name: ${answers.projectName}
- Objective: ${answers.objective}
- Project Owner: ${answers.projectOwner}
- Users/Beneficiaries: ${answers.userReps}
- Target Completion: ${answers.deadline}
- Budget/Resources: ${answers.budget || 'Not specified'}
- Key Risks identified by PM: ${answers.risks}
- Success Criteria: ${answers.successCriteria}

Return ONLY valid JSON — no markdown, no preamble, no explanation. The JSON must exactly match this structure:

{
  "charter": {
    "projectName": "string",
    "phase": "Initiating",
    "objective": "string — 2-3 sentences, clear and measurable",
    "scope": {
      "inScope": ["array", "of", "in-scope", "deliverables"],
      "outOfScope": ["array", "of", "explicitly", "excluded", "items"]
    },
    "roles": {
      "projectOwner": "string",
      "businessManager": "string — infer from context or state TBD",
      "projectManager": "TBD",
      "userRepresentatives": ["array", "of", "user", "rep", "groups"],
      "solutionProvider": "TBD"
    },
    "timeline": "string",
    "budget": "string",
    "constraints": ["array", "of", "project", "constraints"],
    "assumptions": ["array", "of", "project", "assumptions"],
    "successCriteria": ["array", "of", "measurable", "success", "criteria"],
    "approvalNote": "This Project Charter is to be reviewed and approved by the Project Steering Committee at the Initiating Phase Gate."
  },
  "stakeholders": [
    {
      "role": "PM² role name",
      "nameOrGroup": "Person or group name",
      "pmLayer": "Steering | Managing | Support | Operational",
      "interest": "High | Medium | Low",
      "influence": "High | Medium | Low",
      "rating": "High | Medium | Low",
      "keyConcern": "Their primary concern in 1 sentence",
      "engagementStrategy": "Manage closely | Keep informed | Keep satisfied | Monitor"
    }
  ],
  "risks": [
    {
      "id": "R001",
      "cause": "The root cause that creates the risk condition",
      "risk": "The risk event itself — what might happen",
      "effect": "The consequence if this risk materialises",
      "likelihood": "High | Medium | Low",
      "impact": "High | Medium | Low",
      "rating": "High | Medium | Low",
      "owner": "Role responsible for managing this risk",
      "responseStrategy": "Avoid | Mitigate | Transfer | Accept",
      "responseAction": "Specific action to address this risk"
    }
  ],
  "wbs": {
    "children": [
      {
        "label": "Level-1 deliverable group (noun phrase, e.g. Project Management, System Design)",
        "children": [
          {"label": "Level-2 sub-deliverable (noun, e.g. Project Charter)"},
          {"label": "Level-2 sub-deliverable"}
        ]
      }
    ]
  },
  "pbs": [
    {
      "phase": "Initiating",
      "activities": ["Verb-phrase activity specific to this project", "e.g. Conduct stakeholder identification workshop"]
    },
    {
      "phase": "Planning",
      "activities": ["Verb-phrase activity", "e.g. Develop detailed WBS and cost estimates"]
    },
    {
      "phase": "Executing",
      "activities": ["Verb-phrase activity specific to delivering this project's outputs"]
    },
    {
      "phase": "Monitoring & Control",
      "activities": ["Verb-phrase activity", "e.g. Review progress against baseline weekly"]
    },
    {
      "phase": "Closing",
      "activities": ["Verb-phrase activity", "e.g. Conduct lessons-learned review session"]
    }
  ]
}

Rules:
- WBS = WHAT will be produced (deliverables, nouns). Include 4-6 Level-1 groups. Always include a "Project Management" group. Each group should have 2-4 Level-2 sub-deliverables specific to this project.
- PBS = HOW work gets done (activities, verb phrases) organised by PM² phase. Each phase must have 3-5 activities that are specific to THIS project — not generic boilerplate.
- Generate at least 5 stakeholders across different PM² layers and at least 4 risks.
- All content must be specific to this project — no generic placeholder text.`;
}

// ── API Call ──────────────────────────────────────────────────
async function callClaudeAPI(prompt) {
  const response = await fetch(CONFIG.WORKER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `API error ${response.status}`);
  }

  const data = await response.json();
  const text = data.text || '';

  // Strip any accidental markdown fences
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    console.error('Raw API response:', text);
    throw new Error('The AI returned an unexpected format. Please try again.');
  }
}

// ── Generation Flow ───────────────────────────────────────────
async function startGeneration() {
  showView('loading-view');

  // Animate loading steps
  const loadingMessages = [
    'Analysing your project details…',
    'Applying PM² methodology…',
    'Structuring your artefacts…',
  ];

  const steps = [dom.ls1, dom.ls2, dom.ls3];
  steps.forEach((s) => s.classList.remove('active', 'done'));

  steps[0].classList.add('active');
  dom.loadingSub.textContent = loadingMessages[0];

  const stepTimer1 = setTimeout(() => {
    steps[0].classList.remove('active');
    steps[0].classList.add('done');
    steps[1].classList.add('active');
    dom.loadingSub.textContent = loadingMessages[1];
  }, 1800);

  const stepTimer2 = setTimeout(() => {
    steps[1].classList.remove('active');
    steps[1].classList.add('done');
    steps[2].classList.add('active');
    dom.loadingSub.textContent = loadingMessages[2];
  }, 3600);

  try {
    const prompt = buildPrompt(state.answers);
    const artefacts = await callClaudeAPI(prompt);

    clearTimeout(stepTimer1);
    clearTimeout(stepTimer2);

    // Mark all done
    steps.forEach((s) => { s.classList.remove('active'); s.classList.add('done'); });

    state.artefacts = artefacts;

    setTimeout(() => {
      renderResults(artefacts);
      showView('results-view');
    }, 500);

  } catch (err) {
    clearTimeout(stepTimer1);
    clearTimeout(stepTimer2);

    dom.errorMessage.textContent = err.message || 'An unexpected error occurred.';
    showView('error-view');
    console.error('Generation error:', err);
  }
}

dom.retryBtn.addEventListener('click', () => {
  state.currentStep = 0;
  renderQuestion(0);
  showView('wizard-view');
});

dom.newProjectBtn.addEventListener('click', () => {
  state.currentStep = 0;
  state.answers = {};
  state.artefacts = null;
  renderQuestion(0);
  showView('wizard-view');
});


// ── Result Rendering ──────────────────────────────────────────
function pill(value) {
  const v = (value || '').toLowerCase();
  const cls = v === 'high' ? 'pill--high' : v === 'medium' || v === 'med' ? 'pill--med' : 'pill--low';
  return `<span class="pill ${cls}">${value}</span>`;
}

function renderCharter(charter) {
  const el = $('charter-content');
  if (!el) return;

  const inScope = (charter.scope?.inScope || []).map((i) => `<li>${i}</li>`).join('');
  const outScope = (charter.scope?.outOfScope || []).map((i) => `<li>${i}</li>`).join('');
  const criteria = (charter.successCriteria || []).map((i) => `<li>${i}</li>`).join('');
  const constraints = (charter.constraints || []).map((i) => `<li>${i}</li>`).join('');
  const assumptions = (charter.assumptions || []).map((i) => `<li>${i}</li>`).join('');
  const ureps = (charter.roles?.userRepresentatives || []).join(', ');

  el.innerHTML = `
    <div class="charter-section">
      <div class="cs-header">
        <span class="cs-title">Project Charter</span>
        <span class="cs-badge">Phase: ${charter.phase}</span>
      </div>
      <div class="cs-body">
        <div class="cs-value">
          <h2 style="font-family: var(--font-display); font-size: 22px; margin-bottom: 8px;">${charter.projectName}</h2>
        </div>
      </div>
    </div>

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Project Objective</span></div>
      <div class="cs-body"><div class="cs-value">${charter.objective}</div></div>
    </div>

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Scope</span></div>
      <div class="cs-body">
        <div class="cs-grid">
          <div>
            <p style="font-size:12px;font-family:var(--font-mono);color:var(--accent-text);margin-bottom:8px;">IN SCOPE</p>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--text-primary);">
              ${inScope || '<li style="color:var(--text-muted)">—</li>'}
            </ul>
          </div>
          <div>
            <p style="font-size:12px;font-family:var(--font-mono);color:var(--danger);margin-bottom:8px;">OUT OF SCOPE</p>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--text-primary);">
              ${outScope || '<li style="color:var(--text-muted)">—</li>'}
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">PM² Governance Roles</span></div>
      <div class="cs-body">
        <div class="cs-grid">
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${roleRow('Project Owner', charter.roles?.projectOwner)}
            ${roleRow('Business Manager', charter.roles?.businessManager)}
            ${roleRow('Project Manager', charter.roles?.projectManager)}
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${roleRow('User Representatives', ureps || 'TBD')}
            ${roleRow('Solution Provider', charter.roles?.solutionProvider)}
            ${roleRow('Target Completion', charter.timeline)}
            ${charter.budget ? roleRow('Budget / Resources', charter.budget) : ''}
          </div>
        </div>
      </div>
    </div>

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Success Criteria</span></div>
      <div class="cs-body">
        <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;">
          ${criteria || '<li style="color:var(--text-muted)">—</li>'}
        </ul>
      </div>
    </div>

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Constraints & Assumptions</span></div>
      <div class="cs-body">
        <div class="cs-grid">
          <div>
            <p style="font-size:12px;font-family:var(--font-mono);color:var(--text-muted);margin-bottom:8px;">CONSTRAINTS</p>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;font-size:14px;">
              ${constraints || '<li style="color:var(--text-muted)">—</li>'}
            </ul>
          </div>
          <div>
            <p style="font-size:12px;font-family:var(--font-mono);color:var(--text-muted);margin-bottom:8px;">ASSUMPTIONS</p>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;font-size:14px;">
              ${assumptions || '<li style="color:var(--text-muted)">—</li>'}
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div class="charter-section" style="border-color: var(--accent-border); background: var(--accent-dim);">
      <div class="cs-body">
        <p style="font-size:13px;color:var(--accent-text);font-family:var(--font-mono);">
          ${charter.approvalNote || 'This Project Charter is to be reviewed and approved by the Project Steering Committee at the Initiating Phase Gate.'}
        </p>
      </div>
    </div>
  `;
}

function roleRow(label, value) {
  return `
    <div>
      <p style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted);margin-bottom:2px;">${label.toUpperCase()}</p>
      <p style="font-size:14px;color:var(--text-primary);">${value || 'TBD'}</p>
    </div>`;
}

function renderStakeholders(stakeholders) {
  const el = $('stakeholders-content');
  if (!el) return;

  const rows = (stakeholders || []).map((sh) => `
    <tr>
      <td><strong>${sh.role}</strong></td>
      <td>${sh.nameOrGroup}</td>
      <td><span class="pill pill--neutral">${sh.pmLayer}</span></td>
      <td>${pill(sh.interest)}</td>
      <td>${pill(sh.influence)}</td>
      <td style="color:var(--text-secondary);font-size:13px;">${sh.keyConcern}</td>
      <td style="font-size:12px;font-family:var(--font-mono);color:var(--text-muted);">${sh.engagementStrategy}</td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div class="sh-table-wrap">
      <table class="sh-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Name / Group</th>
            <th>PM² Layer</th>
            <th>Interest</th>
            <th>Influence</th>
            <th>Key Concern</th>
            <th>Strategy</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderRisks(risks) {
  const el = $('risks-content');
  if (!el) return;

  const cards = (risks || []).map((r) => `
    <div class="risk-card">
      <div class="risk-card-head">
        <span class="risk-card-id">${r.id}</span>
        <span class="risk-card-title">${r.risk}</span>
        ${pill(r.rating)}
      </div>
      <div class="risk-card-body">
        <div class="risk-cre-row">
          <span class="risk-cre-label">Cause</span>
          <span class="risk-cre-value">${r.cause}</span>
        </div>
        <div class="risk-cre-row">
          <span class="risk-cre-label">Risk</span>
          <span class="risk-cre-value">${r.risk}</span>
        </div>
        <div class="risk-cre-row">
          <span class="risk-cre-label">Effect</span>
          <span class="risk-cre-value">${r.effect}</span>
        </div>
        <div class="risk-footer">
          <span class="pill pill--neutral">Likelihood: ${r.likelihood}</span>
          <span class="pill pill--neutral">Impact: ${r.impact}</span>
          ${pill(r.rating)}
          <span class="pill pill--neutral">Owner: ${r.owner}</span>
          <span class="pill pill--neutral">${r.responseStrategy}</span>
        </div>
        ${r.responseAction ? `
          <div class="risk-cre-row" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--border-subtle);">
            <span class="risk-cre-label">Action</span>
            <span class="risk-cre-value" style="color:var(--text-secondary);font-size:13px;">${r.responseAction}</span>
          </div>` : ''}
      </div>
    </div>
  `).join('');

  el.innerHTML = cards;
}

function renderResults(artefacts) {
  dom.resultsProjectName.textContent = artefacts.charter?.projectName || state.answers.projectName || 'Your Project';

  renderCharter(artefacts.charter);
  renderStakeholders(artefacts.stakeholders);
  renderRisks(artefacts.risks);

  // Init planning tools with project context pre-filled
  const projectName = artefacts.charter?.projectName || state.answers.projectName || 'My Project';
  if (typeof initTools === 'function') {
    initTools(projectName, artefacts, state.answers);
  }
  if (typeof setPrintProjectName === 'function') {
    setPrintProjectName(projectName);
  }

  // Show coaching nudge
  dom.coachingNudge.classList.remove('hidden');

  // Tab switching
  document.querySelectorAll('.rtab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.rtab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      tab.classList.add('active');
      $(`tab-${target}`).classList.remove('hidden');
    });
  });

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const el = $(targetId);
      if (!el) return;
      const text = el.innerText;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✓ Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy text';
          btn.classList.remove('copied');
        }, 2000);
      });
    });
  });
}

// ── Init ──────────────────────────────────────────────────────
function init() {
  renderQuestion(0);
}

init();
