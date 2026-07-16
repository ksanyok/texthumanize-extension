/** Options page logic. */

import { send, t } from '../popup/bridge.js';

const $ = (sel) => document.querySelector(sel);

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
const cleanWm = $('#clean-watermarks');
const saveNote = $('#save-note');

send({ type: 'get-settings' }).then((s) => {
  intensity.value = s.intensity;
  intensityVal.textContent = s.intensity;
  profile.value = s.profile;
  langMode.value = s.langMode || 'auto';
  bubble.checked = !!s.selectionBubble;
  cleanWm.checked = !!s.cleanWatermarks;
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
cleanWm.addEventListener('change', () => save({ cleanWatermarks: cleanWm.checked }));
