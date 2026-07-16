/** Options page logic. */

import { send, t } from '../popup/bridge.js';

const $ = (sel) => document.querySelector(sel);
const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

for (const el of document.querySelectorAll('[data-i18n]')) {
  el.textContent = t(el.dataset.i18n);
}
document.title = t('optTitle');

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
const profile = $('#profile');
const bubble = $('#selection-bubble');
const chip = $('#editor-chip');
const imageHover = $('#image-hover');
const effects = $('#effects');
const cleanWm = $('#clean-watermarks');
const telemetry = $('#telemetry');
const saveNote = $('#save-note');

send({ type: 'get-settings' }).then((s) => {
  intensity.value = s.intensity;
  intensityVal.textContent = s.intensity;
  profile.value = s.profile;
  langMode.value = s.langMode || 'auto';
  bubble.checked = !!s.selectionBubble;
  chip.checked = s.editorChip !== false;
  imageHover.checked = !!s.imageHover;
  effects.checked = s.effects !== false;
  cleanWm.checked = !!s.cleanWatermarks;
  telemetry.checked = s.telemetry !== false;
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
profile.addEventListener('change', () => save({ profile: profile.value }));
langMode.addEventListener('change', () => save({ langMode: langMode.value }));
bubble.addEventListener('change', () => save({ selectionBubble: bubble.checked }));
chip.addEventListener('change', () => save({ editorChip: chip.checked }));
effects.addEventListener('change', () => save({ effects: effects.checked }));
cleanWm.addEventListener('change', () => save({ cleanWatermarks: cleanWm.checked }));
telemetry.addEventListener('change', () => save({ telemetry: telemetry.checked }));

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

// Local, on-device usage summary (never leaves the machine).
send({ type: 'get-usage' }).then((u) => {
  const tools = Object.entries(u.tools || {}).sort((a, b) => b[1] - a[1]);
  const el = $('#usage');
  if (!el) return;
  if (!tools.length) { el.textContent = ''; return; }
  el.innerHTML = '<b>' + t('optTelemetry') + ' · local</b><br>' +
    tools.map(([k, v]) => `${k}: ${v}`).join(' · ');
}).catch(() => {});
