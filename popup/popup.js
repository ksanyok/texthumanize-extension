/**
 * TextHumanize popup / workspace page logic.
 */

import { send, t, IS_EXTENSION } from './bridge.js';

const $ = (sel) => document.querySelector(sel);

const input = $('#input');
const langBadge = $('#lang-badge');
const charCount = $('#char-count');
const intensity = $('#intensity');
const intensityVal = $('#intensity-val');
const profile = $('#profile');
const resultZone = $('#result-zone');
const scoreZone = $('#score-zone');
const resultText = $('#result-text');
const resultMeta = $('#result-meta');
const viewTabs = $('#view-tabs');
const busy = $('#busy');
const copyBtn = $('#copy-btn');
const rerollBtn = $('#reroll-btn');

let lastResult = null;
let lastAction = null;
let lastSeed = Date.now() & 0xffff;
let view = 'result';

// ── i18n ────────────────────────────────────────────────────────

for (const el of document.querySelectorAll('[data-i18n]')) {
  el.textContent = t(el.dataset.i18n);
}
for (const el of document.querySelectorAll('[data-i18n-title]')) {
  el.title = t(el.dataset.i18nTitle);
}
for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
  el.placeholder = t(el.dataset.i18nPlaceholder);
}
document.title = 'TextHumanize';

// ── Page mode (workspace tab) ───────────────────────────────────

const params = new URLSearchParams(location.search);
if (params.get('page') === '1' || !IS_EXTENSION) {
  document.body.classList.add('page-mode');
}
if (params.get('text')) {
  input.value = params.get('text');
}

// ── Settings ────────────────────────────────────────────────────

const settingsReady = send({ type: 'get-settings' }).then((s) => {
  intensity.value = params.get('intensity') ?? s.intensity;
  intensityVal.textContent = intensity.value;
  profile.value = s.profile;
}).catch(() => {});

intensity.addEventListener('input', () => { intensityVal.textContent = intensity.value; });
intensity.addEventListener('change', persistSettings);
profile.addEventListener('change', persistSettings);

function persistSettings() {
  send({
    type: 'set-settings',
    patch: { intensity: Number(intensity.value), profile: profile.value },
  }).catch(() => {});
}

// ── Input metadata (live) ───────────────────────────────────────

let detectTimer = null;
input.addEventListener('input', () => {
  updateCounts();
  clearTimeout(detectTimer);
  detectTimer = setTimeout(updateLang, 350);
});

function updateCounts() {
  const text = input.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  charCount.textContent = text ? `${text.length} · ${words} ${t('words').toLowerCase()}` : '';
  $('#clear-btn').hidden = !text;
}

async function updateLang() {
  const text = input.value.trim();
  if (text.length < 12) { langBadge.hidden = true; return; }
  try {
    const lang = await send({ type: 'detect-language', text });
    langBadge.textContent = lang.toUpperCase();
    langBadge.hidden = false;
  } catch { langBadge.hidden = true; }
}

$('#paste-btn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      input.value = text;
      updateCounts();
      updateLang();
    }
  } catch { input.focus(); }
});

$('#clear-btn').addEventListener('click', () => {
  input.value = '';
  updateCounts();
  langBadge.hidden = true;
  resultZone.hidden = true;
  input.focus();
});

// ── Actions ─────────────────────────────────────────────────────

$('#humanize-btn').addEventListener('click', () => run('humanize'));
$('#check-btn').addEventListener('click', () => run('check'));
$('#clean-btn').addEventListener('click', () => run('clean'));

// Secondary tool row (analysis + transforms).
const SECONDARY_TOOLS = [
  { action: 'tone', i18n: 'actTone', icon: '🎭' },
  { action: 'readability', i18n: 'actReadability', icon: '📖' },
  { action: 'paraphrase', i18n: 'actParaphrase', icon: '🔀', pro: true },
  { action: 'stylometry', i18n: 'actStylometry', icon: '🧬', pro: true },
];
const toolRow = $('#tool-row');
for (const tool of SECONDARY_TOOLS) {
  const b = document.createElement('button');
  b.className = 'tool-btn';
  b.dataset.action = tool.action;
  b.innerHTML = `${tool.icon} ${t(tool.i18n)}${tool.pro ? ' <span class="pro">PRO</span>' : ''}`;
  b.addEventListener('click', () => run(tool.action));
  toolRow.appendChild(b);
}

rerollBtn.addEventListener('click', () => {
  lastSeed = (lastSeed * 1103515245 + 12345) & 0x7fffffff;
  run(lastAction === 'paraphrase' ? 'paraphrase' : 'humanize', { seed: lastSeed });
});

copyBtn.addEventListener('click', async () => {
  const text = resultText.innerText;
  try {
    await navigator.clipboard.writeText(text);
    const old = copyBtn.textContent;
    copyBtn.textContent = `✓ ${t('copied')}`;
    setTimeout(() => { copyBtn.textContent = old; }, 1400);
  } catch { /* ignore */ }
});

for (const tab of viewTabs.querySelectorAll('.view-tab')) {
  tab.addEventListener('click', () => {
    view = tab.dataset.view;
    for (const other of viewTabs.querySelectorAll('.view-tab')) {
      other.classList.toggle('active', other === tab);
    }
    renderHumanize();
  });
}

function setBusy(on) {
  busy.hidden = !on;
  for (const btn of document.querySelectorAll('.action-row .btn, .tool-row .tool-btn')) btn.disabled = on;
}

async function run(action, extra = {}) {
  const text = input.value.trim();
  if (!text) { input.focus(); return; }

  setBusy(true);
  const typeMap = {
    humanize: 'humanize', check: 'analyze', clean: 'clean',
    tone: 'tone', readability: 'readability', paraphrase: 'paraphrase', stylometry: 'stylometry',
  };
  const overrides = { intensity: Number(intensity.value), profile: profile.value, ...extra };
  if (params.get('seed') !== null && overrides.seed === undefined) {
    overrides.seed = Number(params.get('seed'));
  }

  try {
    const data = await send({ type: typeMap[action], text, overrides });
    lastResult = data;
    lastAction = action;
    render();
  } catch (err) {
    scoreZone.innerHTML = `<div class="note-warn">${escapeHtml(String(err.message || err))}</div>`;
    resultZone.hidden = false;
    resultText.hidden = true;
    resultMeta.textContent = '';
  } finally {
    setBusy(false);
  }
}

// ── Rendering ───────────────────────────────────────────────────

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function meterRow(label, prob, verdict) {
  const pct = Math.round(prob * 100);
  const cls = pct >= 60 ? 'red' : pct >= 35 ? 'yellow' : 'green';
  return `
    <div class="meter-row">
      <span class="meter-label">${escapeHtml(label)}</span>
      <div class="meter"><div class="meter-fill ${cls}" style="width:${pct}%"></div></div>
      <b class="meter-num ${cls}">${pct}%</b>
      <span class="verdict ${cls}">${escapeHtml(t(`verdict_${verdict}`))}</span>
    </div>`;
}

function updateBadge(lang) {
  if (lang) {
    langBadge.textContent = lang.toUpperCase();
    langBadge.hidden = false;
  }
}

function render() {
  resultZone.hidden = false;
  resultText.hidden = false;

  if (lastAction === 'check') {
    const d = lastResult.detection;
    const wm = lastResult.watermark;
    updateBadge(lastResult.lang);
    const signals = Object.entries(d.scores || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `<li>${escapeHtml(t(`metric_${k}`))} — <b>${Math.round(v * 100)}%</b></li>`)
      .join('');
    scoreZone.innerHTML = `
      ${meterRow(t('aiScore'), d.aiProbability, d.verdict)}
      <div class="dim small">${t('confidence')}: <b>${Math.round(d.confidence * 100)}%</b>
        &nbsp;·&nbsp; ${t('words')}: <b>${d.wordCount}</b></div>
      ${signals ? `<ul class="sig-list">${signals}</ul>` : ''}
      ${wm.hasWatermarks
        ? `<div class="note-warn">⚠ ${t('watermarksFound', [String(wm.removed)])}</div>`
        : `<div class="note-ok">✓ ${t('noWatermarks')}</div>`}`;
    resultText.hidden = true;
    resultMeta.textContent = '';
    viewTabs.hidden = true;
    copyBtn.hidden = true;
    rerollBtn.hidden = true;
    return;
  }

  if (lastAction === 'clean') {
    updateBadge(lastResult.lang);
    scoreZone.innerHTML = lastResult.hasWatermarks
      ? `<div class="note-warn">⚠ ${t('watermarksFound', [String(lastResult.removed)])}</div>
         <ul class="sig-list">${lastResult.details.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : `<div class="note-ok">✓ ${t('noWatermarks')}</div>`;
    resultText.textContent = lastResult.text;
    resultMeta.textContent = '';
    viewTabs.hidden = true;
    copyBtn.hidden = false;
    rerollBtn.hidden = true;
    return;
  }

  if (lastAction === 'tone') {
    updateBadge(lastResult.lang);
    const pct = Math.round((lastResult.formalityScore ?? lastResult.score ?? 0.5) * 100);
    const cls = pct >= 60 ? 'red' : pct >= 35 ? 'yellow' : 'green';
    const levelName = t(`tone_${lastResult.level}`) || lastResult.level;
    const inds = (lastResult.indicators || []).slice(0, 6);
    scoreZone.innerHTML = `
      <div class="meter-row"><span class="meter-label">${t('formality')}</span>
        <div class="meter"><div class="meter-fill ${cls}" style="width:${pct}%"></div></div>
        <b class="meter-num ${cls}">${pct}%</b></div>
      <div class="dim small">${t('toneLevel')}: <b>${escapeHtml(String(levelName))}</b></div>
      ${inds.length ? `<ul class="sig-list">${inds.map((x) => `<li>${escapeHtml(String(x))}</li>`).join('')}</ul>` : ''}`;
    resultText.hidden = true;
    resultMeta.textContent = '';
    viewTabs.hidden = copyBtn.hidden = rerollBtn.hidden = true;
    return;
  }

  if (lastAction === 'readability') {
    updateBadge(lastResult.lang);
    const rows = [
      ['fleschReadingEase', lastResult.fleschReadingEase],
      ['fleschKincaidGrade', lastResult.fleschKincaidGrade],
      ['gunningFog', lastResult.gunningFog],
      ['smog', lastResult.smog],
      ['colemanLiau', lastResult.colemanLiau],
    ];
    scoreZone.innerHTML = `
      <div class="dim small">${t('readingLevel')}: <b>${escapeHtml(String(lastResult.readingLevel || ''))}</b>
        &nbsp;·&nbsp; ${t('grade')}: <b>${lastResult.gradeLevel != null ? Math.round(lastResult.gradeLevel) : '—'}</b></div>
      <ul class="sig-list">${rows.map(([k, v]) => `<li>${escapeHtml(t(`metric_${k}`) || k)}: <b>${v != null ? Math.round(v * 10) / 10 : '—'}</b></li>`).join('')}</ul>`;
    resultText.hidden = true;
    resultMeta.textContent = '';
    viewTabs.hidden = copyBtn.hidden = rerollBtn.hidden = true;
    return;
  }

  if (lastAction === 'stylometry') {
    updateBadge(lastResult.lang);
    const p = lastResult.profile || lastResult;
    const entries = Object.entries(p).filter(([, v]) => typeof v === 'number').slice(0, 10);
    scoreZone.innerHTML = `
      ${lastResult.summary ? `<div class="dim small">${escapeHtml(String(lastResult.summary))}</div>` : ''}
      <ul class="sig-list">${entries.map(([k, v]) => `<li>${escapeHtml(k)}: <b>${Math.round(v * 100) / 100}</b></li>`).join('')}</ul>`;
    resultText.hidden = true;
    resultMeta.textContent = '';
    viewTabs.hidden = copyBtn.hidden = rerollBtn.hidden = true;
    return;
  }

  if (lastAction === 'paraphrase') {
    updateBadge(lastResult.lang);
    scoreZone.innerHTML = `<div class="dim small">${t('changesCount', [String((lastResult.changes || []).length)])}</div>`;
    resultText.hidden = false;
    resultText.textContent = lastResult.text;
    resultText.contentEditable = 'true';
    resultMeta.textContent = '';
    viewTabs.hidden = true;
    copyBtn.hidden = false;
    rerollBtn.hidden = false;
    return;
  }

  // humanize
  renderHumanize();
}

function renderHumanize() {
  const data = lastResult;
  if (!data || lastAction !== 'humanize') return;
  updateBadge(data.lang);

  const before = data.before ? Math.round(data.before.aiProbability * 100) : null;
  const after = data.after ? Math.round(data.after.aiProbability * 100) : null;
  const delta = before !== null && after !== null ? after - before : null;

  scoreZone.innerHTML = `
    ${data.before ? meterRow(t('beforeLabel'), data.before.aiProbability, data.before.verdict) : ''}
    ${data.after ? meterRow(t('afterLabel'), data.after.aiProbability, data.after.verdict) : ''}
    ${delta !== null && delta < 0 ? `<div class="note-ok">▼ ${t('improvedBy', [String(-delta)])}</div>` : ''}`;

  if (view === 'diff') {
    resultText.innerHTML = renderDiff(data.original, data.text);
    resultText.contentEditable = 'false';
  } else {
    resultText.textContent = data.text;
    resultText.contentEditable = 'true';
  }

  const bits = [t('changesCount', [String(data.changes.length)])];
  if (data.watermark?.removed) bits.push(t('hiddenRemoved', [String(data.watermark.removed)]));
  resultMeta.textContent = bits.join(' · ');

  viewTabs.hidden = false;
  copyBtn.hidden = false;
  rerollBtn.hidden = false;
}

/**
 * Word-level diff via LCS (capped for perf).
 * @param {string} a @param {string} b
 */
function renderDiff(a, b) {
  const aw = a.split(/(\s+)/);
  const bw = b.split(/(\s+)/);
  if (aw.length * bw.length > 400000) {
    return escapeHtml(b);
  }
  const n = aw.length;
  const m = bw.length;
  // LCS table (uint16 is enough for capped sizes)
  const dp = new Uint16Array((n + 1) * (m + 1));
  const idx = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[idx(i, j)] = aw[i] === bw[j]
        ? dp[idx(i + 1, j + 1)] + 1
        : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
    }
  }
  let i = 0;
  let j = 0;
  const out = [];
  while (i < n && j < m) {
    if (aw[i] === bw[j]) {
      out.push(escapeHtml(aw[i]));
      i++; j++;
    } else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) {
      if (aw[i].trim()) out.push(`<del>${escapeHtml(aw[i])}</del>`);
      i++;
    } else {
      if (bw[j].trim()) out.push(`<ins>${escapeHtml(bw[j])}</ins>`);
      else out.push(escapeHtml(bw[j]));
      j++;
    }
  }
  while (i < n) { if (aw[i].trim()) out.push(`<del>${escapeHtml(aw[i])}</del>`); i++; }
  while (j < m) { out.push(j < m && bw[j].trim() ? `<ins>${escapeHtml(bw[j])}</ins>` : escapeHtml(bw[j])); j++; }
  return out.join('');
}

// ── Header buttons ──────────────────────────────────────────────

$('#open-workspace').addEventListener('click', () => {
  if (IS_EXTENSION) {
    const url = new URL(chrome.runtime.getURL('popup/popup.html'));
    url.searchParams.set('page', '1');
    if (input.value) url.searchParams.set('text', input.value.slice(0, 8000));
    chrome.tabs.create({ url: url.toString() });
    window.close();
  } else {
    document.body.classList.toggle('page-mode');
  }
});

$('#open-options').addEventListener('click', () => {
  if (IS_EXTENSION && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    location.href = '../options/options.html';
  }
});

// Autofocus & init
updateCounts();
if (input.value) updateLang();
const autoMode = params.get('mode');
const AUTO_ACTIONS = ['check', 'humanize', 'clean', 'tone', 'readability', 'paraphrase', 'stylometry'];
if (AUTO_ACTIONS.includes(autoMode) && input.value) {
  settingsReady.then(() => run(autoMode));
}
input.focus();
