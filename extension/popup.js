'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let rules = [];
let globalEnabled = true;
let focusMode = false;
let selectedDelay = 10;
let editingId = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const globalToggle    = $('globalToggle');
const focusModeToggle = $('focusModeToggle');
const urlInput        = $('urlInput');
const customDelayInput = $('customDelay');
const addBtn          = $('addBtn');
const cancelBtn       = $('cancelBtn');
const rulesList       = $('rulesList');
const ruleCount       = $('ruleCount');
const presets         = document.querySelectorAll('.preset');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const data = await chrome.storage.local.get([
    'blockedSites',
    'globalEnabled',
    'focusMode',
  ]);

  rules         = data.blockedSites   || [];
  globalEnabled = data.globalEnabled !== false;
  focusMode     = !!data.focusMode;

  globalToggle.checked    = globalEnabled;
  focusModeToggle.checked = focusMode;

  renderRules();
}

// ─── Global toggles ───────────────────────────────────────────────────────────
globalToggle.addEventListener('change', async () => {
  globalEnabled = globalToggle.checked;
  await chrome.storage.local.set({ globalEnabled });
});

focusModeToggle.addEventListener('change', async () => {
  focusMode = focusModeToggle.checked;
  await chrome.storage.local.set({ focusMode });
});

// ─── Delay preset buttons ─────────────────────────────────────────────────────
presets.forEach((btn) => {
  btn.addEventListener('click', () => {
    presets.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    if (btn.dataset.seconds === 'custom') {
      customDelayInput.classList.remove('hidden');
      customDelayInput.focus();
      selectedDelay = 0;
    } else {
      customDelayInput.classList.add('hidden');
      selectedDelay = parseInt(btn.dataset.seconds, 10);
    }
  });
});

customDelayInput.addEventListener('input', () => {
  selectedDelay = parseInt(customDelayInput.value, 10) || 0;
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBtn.click();
});

cancelBtn.addEventListener('click', exitEditMode);

// ─── Add / Update ─────────────────────────────────────────────────────────────
addBtn.addEventListener('click', async () => {
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) {
    shake(urlInput);
    return;
  }

  const delay = selectedDelay > 0
    ? selectedDelay
    : parseInt(customDelayInput.value, 10);

  if (!delay || delay < 1) {
    shake(customDelayInput.classList.contains('hidden')
      ? document.querySelector('.presets')
      : customDelayInput);
    return;
  }

  const normalized = normalizeSiteInput(rawUrl);

  if (editingId !== null) {
    const idx = rules.findIndex((r) => r.id === editingId);
    if (idx !== -1) {
      rules[idx] = { ...rules[idx], url: normalized, delay };
    }
    exitEditMode();
  } else {
    const duplicate = rules.some((r) => normalizeSiteInput(r.url) === normalized);
    if (duplicate) {
      urlInput.classList.add('error');
      shake(urlInput);
      setTimeout(() => urlInput.classList.remove('error'), 1500);
      return;
    }

    rules.push({
      id: Date.now(),
      url: normalized,
      delay,
      enabled: true,
    });

    urlInput.value = '';
    resetDelayUI();
  }

  await chrome.storage.local.set({ blockedSites: rules });
  renderRules();
});

// ─── Rule operations ──────────────────────────────────────────────────────────
async function deleteRule(id) {
  rules = rules.filter((r) => r.id !== id);
  if (editingId === id) exitEditMode();
  await chrome.storage.local.set({ blockedSites: rules });
  renderRules();
}

async function toggleRule(id) {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return;
  rule.enabled = !rule.enabled;
  await chrome.storage.local.set({ blockedSites: rules });
  // Update DOM class without full re-render to avoid losing focus
  const item = document.querySelector(`.rule-item[data-id="${id}"]`);
  if (item) item.classList.toggle('disabled', !rule.enabled);
}

function editRule(id) {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return;

  editingId = id;
  urlInput.value = rule.url;
  addBtn.textContent = 'Update Rule';
  cancelBtn.classList.remove('hidden');

  // Highlight the currently-editing item
  document.querySelectorAll('.rule-item').forEach((el) => el.classList.remove('editing'));
  const item = document.querySelector(`.rule-item[data-id="${id}"]`);
  if (item) item.classList.add('editing');

  // Sync delay UI
  presets.forEach((b) => b.classList.remove('active'));
  const matchedPreset = [...presets].find((b) => b.dataset.seconds === String(rule.delay));
  if (matchedPreset) {
    matchedPreset.classList.add('active');
    customDelayInput.classList.add('hidden');
    selectedDelay = rule.delay;
  } else {
    const customBtn = [...presets].find((b) => b.dataset.seconds === 'custom');
    customBtn?.classList.add('active');
    customDelayInput.classList.remove('hidden');
    customDelayInput.value = rule.delay;
    selectedDelay = 0;
  }

  urlInput.focus();
  document.querySelector('.add-rule').scrollIntoView({ behavior: 'smooth' });
}

function exitEditMode() {
  editingId = null;
  urlInput.value = '';
  addBtn.textContent = 'Add Rule';
  cancelBtn.classList.add('hidden');
  document.querySelectorAll('.rule-item').forEach((el) => el.classList.remove('editing'));
  resetDelayUI();
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderRules() {
  ruleCount.textContent = rules.length;
  rulesList.innerHTML = '';

  if (rules.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = 'No sites blocked yet.<br>Add a website above to get started.';
    rulesList.appendChild(empty);
    return;
  }

  rules.forEach((rule) => rulesList.appendChild(createRuleItem(rule)));
}

function createRuleItem(rule) {
  const item = document.createElement('div');
  item.className = `rule-item${rule.enabled === false ? ' disabled' : ''}${editingId === rule.id ? ' editing' : ''}`;
  item.dataset.id = String(rule.id);

  item.innerHTML = `
    <div class="rule-info">
      <span class="rule-url">${escapeHtml(rule.url)}</span>
      <span class="rule-delay">${rule.delay}s delay</span>
    </div>
    <div class="rule-actions">
      <label class="toggle" title="${rule.enabled !== false ? 'Disable' : 'Enable'} rule">
        <input type="checkbox" class="rule-toggle"${rule.enabled !== false ? ' checked' : ''}>
        <span class="slider"></span>
      </label>
      <button class="btn-icon edit-btn"   title="Edit rule"   aria-label="Edit">✎</button>
      <button class="btn-icon delete-btn" title="Delete rule" aria-label="Delete">✕</button>
    </div>
  `;

  item.querySelector('.rule-toggle').addEventListener('change', () => toggleRule(rule.id));
  item.querySelector('.edit-btn').addEventListener('click',    () => editRule(rule.id));
  item.querySelector('.delete-btn').addEventListener('click',  () => deleteRule(rule.id));

  return item;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalizeSiteInput(raw) {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
}

function resetDelayUI() {
  presets.forEach((b) => b.classList.remove('active'));
  presets[0].classList.add('active');
  selectedDelay = 10;
  customDelayInput.classList.add('hidden');
  customDelayInput.value = '';
}

function shake(el) {
  if (!el || !el.classList) return;
  el.classList.remove('shake');
  void el.offsetWidth; // Force reflow to restart animation
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
init();
