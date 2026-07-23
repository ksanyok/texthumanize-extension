/** Options page logic. */

import { send, t } from '../popup/bridge.js';

const $ = (sel) => document.querySelector(sel);
const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

for (const el of document.querySelectorAll('[data-i18n]')) {
  el.textContent = t(el.dataset.i18n);
}
document.title = t('optTitle');
try { document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr'; } catch { /* web */ }
{ const v = $('#opt-ver'); if (v) { try { v.textContent = `v${IS_EXTENSION ? chrome.runtime.getManifest().version : '3.3.0'}`; } catch { v.textContent = 'v3.3.0'; } } }
{ const r = $('#opt-rate'); if (r && IS_EXTENSION && chrome.runtime?.id) r.href = `https://chrome.google.com/webstore/detail/${chrome.runtime.id}/reviews`; }

const LANGS = [
  ['auto', ''], ['en', 'English'], ['ru', 'Русский'], ['uk', 'Українська'],
  ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['pl', 'Polski'],
  ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['sv', 'Svenska'],
  ['cs', 'Čeština'], ['ro', 'Română'], ['hu', 'Magyar'], ['da', 'Dansk'],
  ['tr', 'Türkçe'], ['ar', 'العربية'], ['zh', '中文'], ['ja', '日本語'],
  ['ko', '한국어'], ['hi', 'हिन्दी'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'],
  ['id', 'Bahasa Indonesia'], ['he', 'עברית'],
];

const langMode = $('#lang-mode');
for (const [code, name] of LANGS) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = code === 'auto' ? t('optLangAuto') : `${name} (${code})`;
  langMode.appendChild(opt);
}

const intensity = $('#intensity');
const intensityVal = $('#intensity-val');
const bubble = $('#selection-bubble');
const chip = $('#editor-chip');
const imageHover = $('#image-hover');
const siteBadge = $('#site-badge');
const effects = $('#effects');
const cleanWm = $('#clean-watermarks');
const telemetry = $('#telemetry');
const saveNote = $('#save-note');

send({ type: 'get-settings' }).then((s) => {
  intensity.value = s.intensity;
  intensityVal.textContent = s.intensity;
  langMode.value = s.langMode || 'auto';
  bubble.checked = !!s.selectionBubble;
  chip.checked = s.editorChip !== false;
  imageHover.checked = !!s.imageHover;
  siteBadge.checked = s.siteBadge !== false;
  effects.checked = s.effects !== false;
  cleanWm.checked = !!s.cleanWatermarks;
  telemetry.checked = s.telemetry !== false;
  renderScanSites(Array.isArray(s.scanSites) ? s.scanSites : []);
}).catch(() => {});

intensity.addEventListener('input', () => { intensityVal.textContent = intensity.value; });

let noteTimer = null;
function save(patch) {
  send({ type: 'set-settings', patch }).then(() => {
    saveNote.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { saveNote.hidden = true; }, 1600);
  }).catch(() => {});
}

intensity.addEventListener('change', () => save({ intensity: Number(intensity.value) }));
langMode.addEventListener('change', () => save({ langMode: langMode.value }));
bubble.addEventListener('change', () => save({ selectionBubble: bubble.checked }));
chip.addEventListener('change', () => save({ editorChip: chip.checked }));
effects.addEventListener('change', () => save({ effects: effects.checked }));
cleanWm.addEventListener('change', () => save({ cleanWatermarks: cleanWm.checked }));
telemetry.addEventListener('change', () => save({ telemetry: telemetry.checked }));
siteBadge.addEventListener('change', () => save({ siteBadge: siteBadge.checked }));

// ── Allowed sites for on-page block scanning (view / remove / clear) ──
const scanCard = $('#scan-sites-card');
const scanList = $('#scan-sites-list');
function renderScanSites(sites) {
  if (!scanCard || !scanList) return;
  scanCard.hidden = false;
  if (!sites.length) {
    scanList.innerHTML = `<p class="dim site-empty">${t('siteListEmpty')}</p>`;
    return;
  }
  scanList.innerHTML = sites.map((h) =>
    `<div class="site-item"><span class="site-host">${escapeHtml(h)}</span><button class="site-remove" data-host="${escapeHtml(h)}" title="${t('siteRemove')}">✕</button></div>`).join('');
  scanList.querySelectorAll('.site-remove').forEach((b) => b.addEventListener('click', () => removeSite(b.dataset.host)));
}
function removeSite(host) {
  send({ type: 'get-settings' }).then((s) => {
    const next = (Array.isArray(s.scanSites) ? s.scanSites : []).filter((h) => h !== host);
    save({ scanSites: next });
    renderScanSites(next);
  }).catch(() => {});
}
$('#scan-clear')?.addEventListener('click', () => { save({ scanSites: [] }); renderScanSites([]); });
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Image hover needs host permission to read image bytes — request on enable.
imageHover.addEventListener('change', async () => {
  if (imageHover.checked && IS_EXTENSION && chrome.permissions?.request) {
    try {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
      if (!granted) { imageHover.checked = false; return; }
    } catch { imageHover.checked = false; return; }
  }
  save({ imageHover: imageHover.checked });
});

// ── Detection feedback (on-device labels for offline model tuning) ──
function loadFeedback() {
  send({ type: 'get-feedback' }).then((r) => {
    const samples = r?.samples || [];
    const c = $('#fb-count'); if (c) c.textContent = t('optFeedbackCount', [String(samples.length)]);
    const copyBtn = $('#fb-copy');
    if (copyBtn) copyBtn.onclick = () => {
      navigator.clipboard?.writeText(JSON.stringify(samples, null, 2)).then(() => {
        const old = copyBtn.textContent; copyBtn.textContent = t('copied');
        setTimeout(() => { copyBtn.textContent = old; }, 1400);
      }).catch(() => {});
    };
  }).catch(() => {});
}
$('#fb-clear')?.addEventListener('click', () => { send({ type: 'clear-feedback' }).then(loadFeedback).catch(() => {}); });
loadFeedback();

// Local, on-device usage summary (never leaves the machine).
send({ type: 'get-usage' }).then((u) => {
  const tools = Object.entries(u.tools || {}).sort((a, b) => b[1] - a[1]);
  const el = $('#usage');
  if (!el) return;
  if (!tools.length) { el.textContent = ''; return; }
  el.innerHTML = '<b>' + t('optTelemetry') + ' · local</b><br>' +
    tools.map(([k, v]) => `${k}: ${v}`).join(' · ');
}).catch(() => {});
