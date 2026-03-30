/* ============================================================
   PM Helper — Wizard Logic
   Sprint 0 · Vanilla JS · Claude API Integration
   ============================================================ */

'use strict';

// ── Config ──────────────────────────────────────────────────
const CONFIG = {
  API_ENDPOINT: 'https://api.anthropic.com/v1/messages',
  MODEL: 'claude-haiku-4-5-20251001',   // Fast model for Sprint 0 — swap to sonnet for richer output
  MAX_TOKENS: 4096,
  API_KEY_STORAGE: 'pmhelper_api_key',
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
    id: 'riskAttitude',
    label: 'What is your organisation\'s risk attitude?',
    hint: 'This shapes how the Risk Log is structured — how many risks are identified, how detailed mitigations are, and how large contingency buffers should be.',
    type: 'select',
    required: true,
    options: [
      { value: 'averse', label: '🛡 Risk Averse — We minimise risk at all costs. More risks identified, detailed mitigations, larger contingency buffers.' },
      { value: 'neutral', label: '⚖ Risk Neutral — Balanced approach. Standard risk management, proportionate responses.' },
      { value: 'seeker', label: '🚀 Risk Seeker — We accept risk for reward. Leaner log, opportunity-focused, smaller buffers.' },
    ],
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
  // Modal
  apiModal: $('api-key-modal'),
  apiKeyInput: $('api-key-input'),
  saveKeyBtn: $('save-api-key-btn'),
  changeKeyBtn: $('change-key-btn'),

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
  exportBtn: $('export-btn'),
  coachingNudge: $('coaching-nudge'),
};

// ── API Key Management ────────────────────────────────────────
function getApiKey() {
  return localStorage.getItem(CONFIG.API_KEY_STORAGE) || '';
}

function saveApiKey(key) {
  localStorage.setItem(CONFIG.API_KEY_STORAGE, key.trim());
}

function showApiModal() {
  dom.apiModal.classList.remove('hidden');
  dom.apiKeyInput.value = getApiKey();
  dom.apiKeyInput.focus();
}

function hideApiModal() {
  dom.apiModal.classList.add('hidden');
}

dom.saveKeyBtn.addEventListener('click', () => {
  const key = dom.apiKeyInput.value.trim();
  if (!key.startsWith('sk-ant-')) {
    dom.apiKeyInput.style.borderColor = 'var(--danger)';
    dom.apiKeyInput.placeholder = 'Must start with sk-ant-...';
    return;
  }
  dom.apiKeyInput.style.borderColor = '';
  saveApiKey(key);
  hideApiModal();
});

dom.apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') dom.saveKeyBtn.click();
});

dom.changeKeyBtn.addEventListener('click', showApiModal);

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
  } else if (q.type === 'select') {
    const opts = q.options.map(o =>
      `<label class="select-option ${saved === o.value ? 'selected' : ''}" data-value="${o.value}">
        <input type="radio" name="q-select" value="${o.value}" ${saved === o.value ? 'checked' : ''} />
        <span class="select-option-text">${o.label}</span>
      </label>`
    ).join('');
    inputHtml = `<div id="q-input" class="select-options">${opts}</div>`;
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

  // Allow Enter to advance (not for textarea or select)
  if (q.type === 'text') {
    $('q-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') advanceWizard();
    });
  }

  // Select option click handlers
  if (q.type === 'select') {
    document.querySelectorAll('.select-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.select-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        opt.querySelector('input').checked = true;
      });
    });
  }

  // Update nav buttons
  dom.backBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
  dom.nextBtn.textContent = index === QUESTIONS.length - 1 ? 'Generate artefacts →' : 'Next →';
  updateProgress();
}

// ── Wizard Navigation ─────────────────────────────────────────
function getCurrentAnswer() {
  const q = QUESTIONS[state.currentStep];
  if (q.type === 'select') {
    const checked = document.querySelector('input[name="q-select"]:checked');
    return checked ? checked.value : '';
  }
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
function getRiskAttitudeInstructions(attitude) {
  switch (attitude) {
    case 'averse':
      return `RISK ATTITUDE: Risk Averse. Identify at least 6 risks. Include detailed mitigation actions. Use conservative language. Recommend larger contingency buffers (15-20%). Flag even low-probability risks if impact is high. Frame risks as threats to be minimised.`;
    case 'seeker':
      return `RISK ATTITUDE: Risk Seeker. Identify 3-4 primary risks only. Keep mitigations lean. Include at least 1-2 opportunities (positive risks) alongside threats. Recommend smaller contingency buffers (5-10%). Frame risks in terms of risk/reward balance.`;
    default:
      return `RISK ATTITUDE: Risk Neutral. Identify 4-5 balanced risks. Standard mitigation detail. Recommend standard contingency buffers (10-15%). Balance threat and opportunity framing.`;
  }
}

function buildPrompt(answers) {
  const riskInstructions = getRiskAttitudeInstructions(answers.riskAttitude);
  return `You are a senior PM² project management expert. Given the following project information, generate four PM²-compliant artefacts.

PROJECT INFORMATION:
- Name: ${answers.projectName}
- Objective: ${answers.objective}
- Project Owner: ${answers.projectOwner}
- Users/Beneficiaries: ${answers.userReps}
- Target Completion: ${answers.deadline}
- Budget/Resources: ${answers.budget || 'Not specified'}
- Key Risks identified by PM: ${answers.risks}
- Risk Attitude: ${answers.riskAttitude}
- Success Criteria: ${answers.successCriteria}

${riskInstructions}

Generate the following four PM² artefacts. Return ONLY valid JSON — no markdown, no preamble, no explanation. The JSON must exactly match this structure:

{
  "charter": {
    "projectName": "string",
    "phase": "Initiating",
    "objective": "string — 2-3 sentences, clear and measurable",
    "scope": {
      "inScope": ["array", "of", "in-scope", "items"],
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
    "escalation": {
      "level1": { "authority": "Project Manager", "threshold": "Decisions with cost impact up to €5,000 or schedule impact up to 3 days", "action": "PM decides independently and informs Business Manager" },
      "level2": { "authority": "Project Steering Committee", "threshold": "Decisions with cost impact €5,001–€25,000 or schedule impact 4–14 days", "action": "PSC decides and informs the Appropriate Governance Body (AGB)" },
      "level3": { "authority": "Appropriate Governance Body (AGB)", "threshold": "Decisions exceeding €25,000 cost impact or 14+ days schedule impact", "action": "AGB approval required before action is taken" }
    },
    "approvalNote": "This Project Charter is to be reviewed and approved by the Project Steering Committee at the Initiating Phase Gate."
  },
  "pbs": {
    "projectName": "string",
    "description": "string — one sentence describing what the PBS represents",
    "nodes": [
      {
        "id": "1.0",
        "label": "Final Product / Top-Level Deliverable",
        "description": "Brief description",
        "children": [
          {
            "id": "1.1",
            "label": "Sub-product or component name",
            "description": "Brief description",
            "children": [
              { "id": "1.1.1", "label": "Leaf-level deliverable", "description": "Brief description", "children": [] },
              { "id": "1.1.2", "label": "Leaf-level deliverable", "description": "Brief description", "children": [] }
            ]
          }
        ]
      }
    ]
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
  ]
}

Generate the PBS with at least 3 top-level sub-products and at least 2 children per sub-product. Generate at least 5 stakeholders across different PM² layers. Generate risks according to the risk attitude instructions above. Make all content specific to this project — no generic placeholder text.`;
}

// ── API Call ──────────────────────────────────────────────────
async function callClaudeAPI(prompt) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key set');

  const response = await fetch(CONFIG.API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `API error ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

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

dom.exportBtn.addEventListener('click', () => {
  alert('Export to PDF and DOCX is available in PM Helper Pro.\n\nUpgrade coming soon — contact us to join the waitlist.');
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

    ${charter.escalation ? `
    <div class="charter-section">
      <div class="cs-header">
        <span class="cs-title">Escalation Matrix</span>
        <span class="cs-badge">Decision Authority</span>
      </div>
      <div class="cs-body">
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${Object.entries(charter.escalation).map(([key, lvl], i) => `
            <div style="display:grid;grid-template-columns:120px 1fr 1fr;gap:12px;padding:12px;background:var(--bg-3);border-radius:var(--r-md);border:1px solid var(--border-subtle);">
              <div>
                <p style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);margin-bottom:4px;">LEVEL ${i+1}</p>
                <p style="font-size:13px;font-weight:500;color:var(--accent-text);">${lvl.authority}</p>
              </div>
              <div>
                <p style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);margin-bottom:4px;">THRESHOLD</p>
                <p style="font-size:13px;color:var(--text-primary);">${lvl.threshold}</p>
              </div>
              <div>
                <p style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);margin-bottom:4px;">ACTION</p>
                <p style="font-size:13px;color:var(--text-secondary);">${lvl.action}</p>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>` : ''}
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

function renderPBS(pbs) {
  const el = $('pbs-content');
  if (!el) return;

  function renderNode(node, depth) {
    const indent = depth * 20;
    const hasChildren = node.children && node.children.length > 0;
    const isLeaf = !hasChildren;
    const color = depth === 0 ? 'var(--accent)' : depth === 1 ? 'var(--text-secondary)' : 'var(--text-muted)';
    const fontWeight = depth === 0 ? '600' : depth === 1 ? '500' : '400';
    const fontSize = depth === 0 ? '15px' : depth === 1 ? '14px' : '13px';

    return `
      <div class="pbs-node" style="margin-left:${indent}px; border-left: ${depth > 0 ? '1px solid var(--border-subtle)' : 'none'}; padding-left: ${depth > 0 ? '16px' : '0'};">
        <div class="pbs-node-row">
          <span class="pbs-node-id">${node.id}</span>
          <div class="pbs-node-content">
            <span class="pbs-node-label" style="font-size:${fontSize};font-weight:${fontWeight};color:${color};">${node.label}</span>
            ${node.description ? `<span class="pbs-node-desc">${node.description}</span>` : ''}
          </div>
          ${isLeaf ? '<span class="pbs-leaf-badge">Deliverable</span>' : ''}
        </div>
        ${hasChildren ? node.children.map(child => renderNode(child, depth + 1)).join('') : ''}
      </div>`;
  }

  el.innerHTML = `
    <div class="pbs-intro">
      <p>${pbs.description || 'The PBS defines what the project will produce — its deliverables and sub-deliverables. The PBS precedes the WBS: PBS defines where you want to go, WBS tells you how to get there.'}</p>
    </div>
    <div class="pbs-tree">
      ${(pbs.nodes || []).map(node => renderNode(node, 0)).join('')}
    </div>
  `;
}

function renderResults(artefacts) {
  dom.resultsProjectName.textContent = artefacts.charter?.projectName || state.answers.projectName || 'Your Project';

  renderCharter(artefacts.charter);
  renderPBS(artefacts.pbs);
  renderStakeholders(artefacts.stakeholders);
  renderRisks(artefacts.risks);

  // Update coaching nudge with correct PM² sequence
  const nudgeEl = $('nudge-text');
  if (nudgeEl) {
    nudgeEl.textContent = 'Charter approved? Next: hold your Planning Kick-off Meeting, then build your PBS → WBS → Schedule → Cost Estimate in that order. Each feeds the next.';
  }
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
  // Check for API key
  if (!getApiKey()) {
    showApiModal();
  }

  // Render first question
  renderQuestion(0);
}

init();
