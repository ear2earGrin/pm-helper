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

// ── Language Handling ─────────────────────────────────────────
function handleLangChange(lang) {
  setLanguage(lang);
  applyTranslations();
  // Re-render current question with new language
  renderQuestion(state.currentStep);
}

function applyTranslations() {
  // Nav
  var toolsLink = document.getElementById('nav-tools-link');
  if (toolsLink) toolsLink.textContent = t('tools');
  // Loading
  var lt = document.getElementById('loading-title');
  if (lt) lt.textContent = t('loadingTitle');
  var ls1 = document.getElementById('ls-1');
  if (ls1) { var sp = ls1.querySelector('span'); if (sp) sp.textContent = t('loadingStep1'); }
  var ls2 = document.getElementById('ls-2');
  if (ls2) { var sp2 = ls2.querySelector('span'); if (sp2) sp2.textContent = t('loadingStep2'); }
  var ls3 = document.getElementById('ls-3');
  if (ls3) { var sp3 = ls3.querySelector('span'); if (sp3) sp3.textContent = t('loadingStep3'); }
  // Nav buttons
  var backBtn = document.getElementById('back-btn');
  if (backBtn) backBtn.textContent = t('back');
  var nextBtn = document.getElementById('next-btn');
  if (nextBtn) {
    var isLast = state.currentStep === QUESTIONS.length - 1;
    nextBtn.textContent = isLast ? t('generate') : t('next');
  }
  // New project button
  var npBtn = document.getElementById('new-project-btn');
  if (npBtn) npBtn.textContent = t('newProject');
  // Tabs
  var tabMap = { 'charter': 'tabCharter', 'stakeholders': 'tabStakeholders', 'risks': 'tabRisks', 'wbs': 'tabWbs', 'pbs': 'tabPbs', 'sh-register': 'tabShRegister', 'cost': 'tabCost', 'gantt': 'tabGantt' };
  document.querySelectorAll('.rtab').forEach(function(tab) {
    var key = tabMap[tab.dataset.tab];
    if (key) {
      var icon = tab.querySelector('.rtab-icon');
      tab.textContent = t(key);
      if (icon) tab.insertBefore(icon, tab.firstChild);
    }
  });
  // Retry button
  var retryBtn = document.getElementById('retry-btn');
  if (retryBtn) retryBtn.textContent = t('tryAgain');
  // Error title
  var et = document.querySelector('.error-title');
  if (et) et.textContent = t('errorTitle');
  // Coaching nudge
  var nudge = document.getElementById('nudge-text');
  if (nudge) nudge.textContent = t('nudgeText');
}

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
  dom.progressLabel.textContent = t('stepOf')(state.currentStep + 1, QUESTIONS.length);
}

// ── Question Rendering ────────────────────────────────────────
function renderQuestion(index) {
  const q = QUESTIONS[index];
  const qLang = (t('questions') || [])[index] || {};
  const label = qLang.label || q.label;
  const hint = qLang.hint || q.hint;
  const placeholder = qLang.placeholder || q.placeholder;
  const saved = state.answers[q.id] || '';

  let inputHtml = '';
  if (q.type === 'textarea') {
    inputHtml = `<textarea
      id="q-input"
      class="field-textarea"
      placeholder="${placeholder}"
      rows="5"
      ${q.required ? 'required' : ''}
    >${saved}</textarea>`;
  } else {
    inputHtml = `<input
      type="text"
      id="q-input"
      class="field-input"
      placeholder="${placeholder}"
      value="${saved}"
      ${q.required ? 'required' : ''}
    />`;
  }

  dom.questionArea.innerHTML = `
    <div class="question-slide">
      <p class="q-step">${String(index + 1).padStart(2, '0')} / ${String(QUESTIONS.length).padStart(2, '0')}</p>
      <h2 class="q-label">${label}${!q.required ? '<span class="q-optional">optional</span>' : ''}</h2>
      <p class="q-hint">${hint}</p>
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
  dom.backBtn.textContent = t('back');
  dom.nextBtn.textContent = index === QUESTIONS.length - 1 ? t('generate') : t('next');
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
  const langName = getLanguageName();
  const langInstruction = getLangCode() !== 'en' ? '\nIMPORTANT: Generate ALL content (text, labels, descriptions) in ' + langName + '. Only keep field names/keys in English.' : '';
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
    "background": "1-2 sentences: business context and why this project is needed now",
    "objective": "string — 2-3 sentences, SMART, clear and measurable",
    "deliverables": ["key output/deliverable 1", "key output/deliverable 2"],
    "scope": {
      "inScope": ["in-scope item 1", "in-scope item 2"],
      "outOfScope": ["explicitly excluded item 1", "explicitly excluded item 2"]
    },
    "roles": {
      "projectOwner": "string",
      "businessManager": "string — infer from context or state TBD",
      "projectManager": "TBD",
      "userRepresentatives": ["user group 1", "user group 2"],
      "solutionProvider": "TBD"
    },
    "milestones": [
      {"milestone": "milestone name", "target": "date or period e.g. Week 2"}
    ],
    "timeline": "string",
    "budget": "string",
    "constraints": ["constraint 1", "constraint 2"],
    "assumptions": ["assumption 1", "assumption 2"],
    "successCriteria": ["measurable criterion 1", "measurable criterion 2"],
    "governance": "Brief statement on steering committee, phase gates, and escalation path",
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
        "label": "PM² Phase (Initiating | Planning | Executing | Monitoring & Control | Closing)",
        "children": [
          {"label": "Work package or activity — verb phrase specific to this project"},
          {"label": "Another work package for this phase"}
        ]
      }
    ]
  },
  "pbs": {
    "children": [
      {
        "label": "Top-level product component (noun, e.g. Web Application, Database, Documentation)",
        "children": [
          {"label": "Sub-component or feature (noun, e.g. User Authentication Module)"},
          {"label": "Another sub-component"}
        ]
      }
    ]
  }
}

Critical rules — read carefully:
- WBS = Work Breakdown Structure = WHAT WORK must be done. Organise by PM² phases (Initiating, Planning, Executing, Monitoring & Control, Closing). Each phase has 3-5 specific work packages/activities (verb phrases) for THIS project.
- PBS = Product Breakdown Structure = WHAT PRODUCT will be built. Decompose the solution/product into its components (nouns). 3-5 top-level components, each with 2-4 sub-components. Do NOT use PM² phase names here — these are product traits, not project management activities.
- Charter: milestones array must have at least 4 entries covering key project phases.
- Generate at least 5 stakeholders across different PM² layers and at least 4 risks.
- All content must be specific to this project — no generic placeholder text.` + langInstruction;
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

  // Apply translations to loading screen
  applyTranslations();

  // Animate loading steps
  const loadingMessages = [
    t('loadingSub'),
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

  const inScope    = (charter.scope?.inScope || []).map((i) => `<li>◈ ${i}</li>`).join('');
  const outScope   = (charter.scope?.outOfScope || []).map((i) => `<li>✕ ${i}</li>`).join('');
  const deliverables = (charter.deliverables || []).map((i) => `<li>${i}</li>`).join('');
  const criteria   = (charter.successCriteria || []).map((i) => `<li>${i}</li>`).join('');
  const constraints = (charter.constraints || []).map((i) => `<li>${i}</li>`).join('');
  const assumptions = (charter.assumptions || []).map((i) => `<li>${i}</li>`).join('');
  const ureps      = (charter.roles?.userRepresentatives || []).join(', ');
  const milestones = (charter.milestones || []).map((m) =>
    `<tr><td style="padding:7px 12px;border-bottom:1px solid var(--border-subtle);font-size:13px;">${m.milestone}</td><td style="padding:7px 12px;border-bottom:1px solid var(--border-subtle);font-size:13px;font-family:var(--font-mono);color:var(--accent-text);">${m.target}</td></tr>`
  ).join('');

  el.innerHTML = `
    <div class="charter-section">
      <div class="cs-header">
        <span class="cs-title">Project Charter</span>
        <span class="cs-badge">PM² · ${charter.phase || 'Initiating'} Phase</span>
      </div>
      <div class="cs-body">
        <h2 style="font-family:var(--font-display);font-size:22px;margin-bottom:${charter.background ? '12px' : '0'};">${charter.projectName}</h2>
        ${charter.background ? `<p style="font-size:14px;color:var(--text-secondary);line-height:1.7;">${charter.background}</p>` : ''}
      </div>
    </div>

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Project Objective</span></div>
      <div class="cs-body"><p style="font-size:14px;line-height:1.75;color:var(--text-primary);">${charter.objective}</p></div>
    </div>

    ${deliverables ? `
    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Key Deliverables</span></div>
      <div class="cs-body">
        <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--text-primary);">
          ${deliverables}
        </ul>
      </div>
    </div>` : ''}

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Project Scope</span></div>
      <div class="cs-body">
        <div class="cs-grid">
          <div>
            <p style="font-size:11px;font-family:var(--font-mono);color:var(--accent-text);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">In Scope</p>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:7px;font-size:14px;color:var(--text-primary);">
              ${inScope || '<li style="color:var(--text-muted)">—</li>'}
            </ul>
          </div>
          <div>
            <p style="font-size:11px;font-family:var(--font-mono);color:var(--danger);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Out of Scope</p>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:7px;font-size:14px;color:var(--text-primary);">
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
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${roleRow('Project Owner (Sponsor)', charter.roles?.projectOwner)}
            ${roleRow('Business Manager', charter.roles?.businessManager)}
            ${roleRow('Project Manager', charter.roles?.projectManager)}
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${roleRow('User Representatives', ureps || 'TBD')}
            ${roleRow('Solution Provider', charter.roles?.solutionProvider)}
          </div>
        </div>
        ${charter.governance ? `<p style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-subtle);font-size:13px;color:var(--text-secondary);line-height:1.7;"><strong style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px;">Governance</strong>${charter.governance}</p>` : ''}
      </div>
    </div>

    ${milestones ? `
    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">High-Level Milestone Plan</span></div>
      <div class="cs-body" style="padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="text-align:left;padding:7px 12px;background:var(--bg-3);font-size:10px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);border-bottom:1px solid var(--border-default);">Milestone</th>
            <th style="text-align:left;padding:7px 12px;background:var(--bg-3);font-size:10px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);border-bottom:1px solid var(--border-default);">Target</th>
          </tr></thead>
          <tbody>${milestones}</tbody>
        </table>
      </div>
    </div>` : `
    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Timeline &amp; Budget</span></div>
      <div class="cs-body">
        <div class="cs-grid">
          ${roleRow('Target Completion', charter.timeline)}
          ${charter.budget ? roleRow('Budget / Resources', charter.budget) : ''}
        </div>
      </div>
    </div>`}

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Success Criteria</span></div>
      <div class="cs-body">
        <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;font-size:14px;">
          ${criteria || '<li style="color:var(--text-muted)">—</li>'}
        </ul>
      </div>
    </div>

    <div class="charter-section">
      <div class="cs-header"><span class="cs-title">Constraints &amp; Assumptions</span></div>
      <div class="cs-body">
        <div class="cs-grid">
          <div>
            <p style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Constraints</p>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;font-size:14px;">
              ${constraints || '<li style="color:var(--text-muted)">—</li>'}
            </ul>
          </div>
          <div>
            <p style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Assumptions</p>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;font-size:14px;">
              ${assumptions || '<li style="color:var(--text-muted)">—</li>'}
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div class="charter-section" style="border-color:var(--accent-border);background:var(--accent-dim);">
      <div class="cs-header"><span class="cs-title">Approval</span></div>
      <div class="cs-body">
        <p style="font-size:13px;color:var(--accent-text);font-family:var(--font-mono);margin-bottom:20px;">
          ${charter.approvalNote || 'This Project Charter is to be reviewed and approved by the Project Steering Committee at the Initiating Phase Gate.'}
        </p>
        <div class="cs-grid" style="gap:32px;">
          ${approvalBlock('Project Owner', charter.roles?.projectOwner)}
          ${approvalBlock('Business Manager', charter.roles?.businessManager)}
          ${approvalBlock('Project Manager', charter.roles?.projectManager)}
        </div>
      </div>
    </div>
  `;
}

function approvalBlock(role, name) {
  return `
    <div style="border-top:1px solid var(--border-default);padding-top:12px;">
      <p style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">${role}</p>
      <p style="font-size:13px;color:var(--text-primary);margin-bottom:16px;">${name || 'TBD'}</p>
      <p style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted);">Signature: ________________________</p>
      <p style="font-size:11px;font-family:var(--font-mono);color:var(--text-muted);margin-top:8px;">Date: ____________________________</p>
    </div>`;
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
    btn.textContent = t('copyText');
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const el = $(targetId);
      if (!el) return;
      const text = el.innerText;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = t('copied');
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = t('copyText');
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
