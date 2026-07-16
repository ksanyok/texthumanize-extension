/**
 * TextHumanize popup / workspace — Text · Page · Media hub.
 */

import { send, t, IS_EXTENSION } from './bridge.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

// i18n
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
document.title = 'TextHumanize';

if (params.get('page') === '1' || !IS_EXTENSION) document.body.classList.add('page-mode');

// ── helpers ──
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function band(pct) { return pct >= 60 ? 'red' : pct >= 35 ? 'yellow' : 'green'; }
function easeBand(pct) { return pct >= 60 ? 'green' : pct >= 35 ? 'yellow' : 'red'; }

function gauge(pct, cap, sub, colorBand) {
  const r = 40, C = 2 * Math.PI * r;
  const off = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const cb = colorBand || band(pct);
  return `<div class="gauge">
    <svg viewBox="0 0 100 100">
      <circle class="g-track" cx="50" cy="50" r="${r}" fill="none" stroke-width="9"/>
      <circle class="g-val s-${cb}" cx="50" cy="50" r="${r}" fill="none" stroke-width="9"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-off="${off.toFixed(1)}"
        transform="rotate(-90 50 50)"/>
      <text class="g-num" x="50" y="50" text-anchor="middle" dominant-baseline="central">${Math.round(pct)}</text>
    </svg>
    <div class="g-cap">${esc(cap)}</div>
    ${sub ? `<div class="g-sub c-${cb}">${esc(sub)}</div>` : ''}
  </div>`;
}

function animateGauges(root) {
  root.querySelectorAll('.g-val').forEach((el) => requestAnimationFrame(() => { el.style.strokeDashoffset = el.dataset.off; }));
  root.querySelectorAll('.meter-fill').forEach((el) => requestAnimationFrame(() => { el.style.width = el.dataset.w + '%'; }));
}

function meter(label, prob) {
  const pct = Math.round(prob * 100), b = band(pct);
  return `<div class="meter-row"><span class="meter-label">${esc(label)}</span>
    <div class="meter"><div class="meter-fill b-${b}" data-w="${pct}"></div></div>
    <b class="meter-num c-${b}">${pct}%</b></div>`;
}

function heatColor(prob) {
  // green (0) → yellow (.5) → red (1)
  const p = Math.max(0, Math.min(1, prob));
  const hue = (1 - p) * 120; // 120=green, 0=red
  return `hsl(${hue}, 70%, ${matchMedia('(prefers-color-scheme: dark)').matches ? 26 : 84}%)`;
}

function heatmap(sentences) {
  if (!sentences.length) return '';
  const spans = sentences.map((s) => `<span class="sent" style="background:${heatColor(s.prob)}" title="${Math.round(s.prob * 100)}% AI">${esc(s.text)} </span>`).join('');
  return `<div><div class="heat-title">${t('heatTitle')}</div>
    <div class="heat">${spans}</div>
    <div class="heat-legend"><i style="background:${heatColor(0.05)}"></i>${t('human')} <i style="background:${heatColor(0.5)}"></i> <i style="background:${heatColor(0.95)}"></i>${t('aiLike')}</div></div>`;
}

// ── Tabs ──
for (const tab of $('#main-tabs').querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t2 of $('#main-tabs').querySelectorAll('.tab')) t2.classList.toggle('active', t2 === tab);
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.dataset.panel === tab.dataset.tab);
  });
}

// ═══ TEXT TAB ═══
const input = $('#input');
const langBadge = $('#lang-badge');
const countEl = $('#count');
const resultEl = $('#result');
const busy = $('#busy');
let lastSeed = Date.now() & 0xffff;

if (params.get('text')) input.value = params.get('text');

let detectTimer = null;
input.addEventListener('input', () => { updateCount(); clearTimeout(detectTimer); detectTimer = setTimeout(updateLang, 350); });
function updateCount() {
  const txt = input.value;
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  countEl.textContent = txt ? `${words} ${t('words').toLowerCase()}` : '';
  $('#clear-btn').hidden = !txt;
}
async function updateLang() {
  const txt = input.value.trim();
  if (txt.length < 12) { langBadge.hidden = true; return; }
  try { const lang = await send({ type: 'detect-language', text: txt }); langBadge.textContent = lang.toUpperCase(); langBadge.hidden = false; }
  catch { langBadge.hidden = true; }
}
$('#paste-btn').addEventListener('click', async () => {
  try { const txt = await navigator.clipboard.readText(); if (txt) { input.value = txt; updateCount(); updateLang(); } } catch { input.focus(); }
});
$('#clear-btn').addEventListener('click', () => { input.value = ''; updateCount(); langBadge.hidden = true; resultEl.hidden = true; input.focus(); });

const TOOLS = [
  { action: 'check', i18n: 'actCheck', icon: '🔍' },
  { action: 'tone', i18n: 'actTone', icon: '🎭' },
  { action: 'readability', i18n: 'actReadability', icon: '📖' },
  { action: 'paraphrase', i18n: 'actParaphrase', icon: '🔀' },
];
for (const tool of TOOLS) {
  const b = document.createElement('button');
  b.className = 'tool-btn'; b.dataset.action = tool.action;
  b.innerHTML = `<span>${tool.icon}</span>${t(tool.i18n)}`;
  b.addEventListener('click', () => runText(tool.action));
  $('#tool-row').appendChild(b);
}
$('#humanize-btn').addEventListener('click', () => runText('humanize'));

function textBusy(on) { busy.hidden = !on; $('#humanize-btn').disabled = on; for (const b of $('#tool-row').querySelectorAll('.tool-btn')) b.disabled = on; }

async function runText(action, extra = {}) {
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  textBusy(true);
  try {
    if (action === 'check') {
      const [data, hm] = await Promise.all([
        send({ type: 'analyze', text }),
        send({ type: 'heatmap', text }),
      ]);
      renderCheck(data, hm);
    } else {
      const data = await send({ type: action, text, overrides: extra });
      RENDER[action](data);
    }
  } catch (e) {
    resultEl.hidden = false;
    resultEl.innerHTML = `<div class="note-warn">${esc(String(e.message || e))}</div>`;
  } finally { textBusy(false); }
}

const RENDER = {
  humanize(d) {
    const before = d.before ? Math.round(d.before.aiProbability * 100) : 0;
    const after = d.after ? Math.round(d.after.aiProbability * 100) : 0;
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <div class="gauges">
        ${gauge(before, t('beforeLabel'), t(`verdict_${d.before?.verdict}`), band(before))}
        ${gauge(after, t('afterLabel'), t(`verdict_${d.after?.verdict}`), band(after))}
      </div>
      ${after < before ? `<div class="note-ok">▼ ${t('improvedBy', [String(before - after)])}</div>` : ''}
      <div class="out-text" contenteditable="true" spellcheck="false">${esc(d.text)}</div>
      <div class="row"><span class="hint">${t('changesCount', [String(d.changes.length)])}${d.watermark?.removed ? ' · ' + t('hiddenRemoved', [String(d.watermark.removed)]) : ''}</span>
        <span class="grow"></span>
        <button class="btn" id="reroll">↻ ${t('reroll')}</button>
        <button class="btn primary" id="copy">${t('copy')}</button></div>`;
    const out = resultEl.querySelector('.out-text');
    resultEl.querySelector('#copy').addEventListener('click', () => copyText(out.innerText, resultEl.querySelector('#copy')));
    resultEl.querySelector('#reroll').addEventListener('click', () => { lastSeed = (lastSeed * 1103515245 + 12345) & 0x7fffffff; runText('humanize', { seed: lastSeed }); });
    animateGauges(resultEl);
  },

  paraphrase(d) {
    resultEl.hidden = false;
    resultEl.innerHTML = `<div class="heat-title">${t('actParaphrase')}</div>
      <div class="out-text" contenteditable="true" spellcheck="false">${esc(d.text)}</div>
      <div class="row"><span class="hint">${t('changesCount', [String((d.changes || []).length)])}</span><span class="grow"></span>
        <button class="btn" id="reroll">↻ ${t('reroll')}</button>
        <button class="btn primary" id="copy">${t('copy')}</button></div>`;
    const out = resultEl.querySelector('.out-text');
    resultEl.querySelector('#copy').addEventListener('click', () => copyText(out.innerText, resultEl.querySelector('#copy')));
    resultEl.querySelector('#reroll').addEventListener('click', () => { lastSeed = (lastSeed * 1103515245 + 12345) & 0x7fffffff; runText('paraphrase', { seed: lastSeed }); });
  },

  tone(d) {
    const pct = Math.round((d.formalityScore ?? 0.5) * 100);
    const inds = (d.indicators || []).slice(0, 6);
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <div class="gauges">${gauge(pct, t('formality'), t(`tone_${d.level}`) || d.level, 'yellow')}</div>
      ${inds.length ? `<div class="chips">${inds.map((x) => `<span class="chip">${esc(String(x))}</span>`).join('')}</div>` : ''}
      <div class="row"><span class="hint">${t('toneAdjust')}</span><span class="grow"></span>
        <button class="btn" data-lvl="formal">${t('toneMoreFormal')}</button>
        <button class="btn" data-lvl="casual">${t('toneMoreCasual')}</button></div>`;
    resultEl.querySelectorAll('[data-lvl]').forEach((b) => b.addEventListener('click', async () => {
      textBusy(true);
      try { const r = await send({ type: 'tone-adjust', text: input.value.trim(), overrides: { target: b.dataset.lvl } });
        input.value = r.text; updateCount(); RENDER.tone(await send({ type: 'tone', text: r.text })); }
      catch (e) { /* */ } finally { textBusy(false); }
    }));
    animateGauges(resultEl);
  },

  readability(d) {
    const ease = Math.max(0, Math.min(100, Math.round(d.fleschReadingEase)));
    const rows = [['fleschKincaidGrade', d.fleschKincaidGrade], ['gunningFog', d.gunningFog], ['smog', d.smog], ['colemanLiau', d.colemanLiau]];
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <div class="gauges">
        ${gauge(ease, t('metric_fleschReadingEase'), d.readingLevel || '', easeBand(ease))}
        ${gauge(Math.min(100, (d.gradeLevel || 0) / 20 * 100), t('grade'), String(Math.round(d.gradeLevel || 0)), easeBand(100 - Math.min(100, (d.gradeLevel || 0) / 20 * 100)))}
      </div>
      <ul class="sig-list">${rows.map(([k, v]) => `<li>${esc(t(`metric_${k}`) || k)}: <b>${v != null ? Math.round(v * 10) / 10 : '—'}</b></li>`).join('')}</ul>`;
    animateGauges(resultEl);
  },
};

function renderCheck(data, hm) {
  const d = data.detection, wm = data.watermark;
  const pct = Math.round(d.aiProbability * 100);
  const top = Object.entries(d.scores || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `<span class="chip">${esc(t(`metric_${k}`) || k)} ${Math.round(v * 100)}%</span>`).join('');
  resultEl.hidden = false;
  resultEl.innerHTML = `
    <div class="gauges">${gauge(pct, t('aiScore'), t(`verdict_${d.verdict}`), band(pct))}</div>
    ${top ? `<div class="chips">${top}</div>` : ''}
    ${heatmap(hm.sentences || [])}
    ${wm.hasWatermarks ? `<div class="note-warn">⚠ ${t('watermarksFound', [String(wm.removed)])}</div>` : `<div class="note-ok">✓ ${t('noWatermarks')}</div>`}
    ${pct >= 40 ? `<button class="cta" id="humanize-now">✨ ${t('humanizeCta')}</button>` : ''}`;
  resultEl.querySelector('#humanize-now')?.addEventListener('click', () => runText('humanize'));
  animateGauges(resultEl);
}

function copyText(text, btn) {
  navigator.clipboard?.writeText(text).then(() => { const old = btn.textContent; btn.textContent = `✓ ${t('copied')}`; setTimeout(() => { btn.textContent = old; }, 1400); }).catch(() => {});
}

// ═══ PAGE TAB ═══
$('#scan-page-btn').addEventListener('click', scanPage);
async function scanPage() {
  const res = $('#page-result'), pb = $('#page-busy');
  res.hidden = true; pb.hidden = false; $('#scan-page-btn').disabled = true;
  try {
    const data = await send({ type: 'scan-page' });
    if (data.error) { res.hidden = false; res.innerHTML = `<div class="note-warn">${esc(t('pageScanUnavailable'))}</div>`; return; }
    renderPage(data);
  } catch (e) { res.hidden = false; res.innerHTML = `<div class="note-warn">${esc(String(e.message || e))}</div>`; }
  finally { pb.hidden = true; $('#scan-page-btn').disabled = false; }
}
function renderPage(d) {
  const res = $('#page-result');
  const aiText = d.textBlocks ? Math.round((d.aiBlocks / Math.max(1, d.textBlocks)) * 100) : 0;
  const aiImg = d.aiImages || 0;
  res.hidden = false;
  res.innerHTML = `
    <div class="stats">
      <div class="stat"><span class="n c-${band(aiText)}">${aiText}%</span><span class="k">${t('pageAiText', [String(d.textBlocks || 0)])}</span></div>
      <div class="stat"><span class="n ${aiImg ? 'c-red' : 'c-green'}">${aiImg}${d.imagesNeedPermission ? '?' : ''}</span><span class="k">${t('pageAiImages', [String(d.images || 0)])}</span></div>
      <div class="stat"><span class="n">${d.readability != null ? Math.round(d.readability) : '—'}</span><span class="k">${t('metric_fleschReadingEase')}</span></div>
      <div class="stat"><span class="n">${d.words || 0}</span><span class="k">${t('words')}</span></div>
    </div>
    ${d.imagesNeedPermission ? `<button class="btn" id="grant-img">${t('imgEnableHint')}</button>` : ''}
    ${(d.topBlocks || []).length ? `<div class="heat-title">${t('pageTopAi')}</div><div class="item-list">${d.topBlocks.map((b, i) => `
      <div class="item"><span class="dot b-${band(Math.round(b.prob * 100))}"></span>
        <span class="txt">${esc(b.text)}</span>
        <button class="act" data-i="${i}">✨</button></div>`).join('')}</div>` : ''}`;
  res.querySelectorAll('.act').forEach((btn) => btn.addEventListener('click', () => {
    const b = d.topBlocks[Number(btn.dataset.i)];
    input.value = b.text;
    for (const t2 of $('#main-tabs').querySelectorAll('.tab')) t2.classList.toggle('active', t2.dataset.tab === 'text');
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.dataset.panel === 'text');
    updateCount(); runText('humanize');
  }));
  res.querySelector('#grant-img')?.addEventListener('click', async () => {
    if (IS_EXTENSION && chrome.permissions?.request) {
      const ok = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
      if (ok) scanPage();
    }
  });
}

// ═══ MEDIA TAB ═══
const drop = $('#drop');
const fileInput = $('#file-input');
$('#pick-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (ev) => { const f = ev.dataTransfer.files[0]; if (f) handleFile(f); });

async function handleFile(file) {
  const res = $('#media-result');
  res.hidden = false;
  res.innerHTML = `<div class="busy"><span class="spinner"></span><span>${t('processing')}</span></div>`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detect = await send({ type: 'detect-media', bytes });
    const clean = await send({ type: 'clean-media', bytes });
    const isImg = /^image\//.test(file.type);
    const previewUrl = isImg ? URL.createObjectURL(file) : null;
    const cleanBlob = new Blob([clean.cleaned], { type: file.type || 'application/octet-stream' });
    const cleanUrl = URL.createObjectURL(cleanBlob);
    const verdict = detect.isAiGenerated === true ? 'ai' : detect.provenance === 'authentic' ? 'authentic' : 'none';
    const vCls = verdict === 'ai' ? 'red' : verdict === 'authentic' ? 'green' : 'yellow';
    const vText = verdict === 'ai' ? (t('imgAi') + (detect.generator ? ' · ' + detect.generator : '')) : verdict === 'authentic' ? t('imgAuthentic') : t('imgNoMarkers');
    res.innerHTML = `
      ${previewUrl ? `<img class="media-preview" src="${previewUrl}" alt="">` : ''}
      <div class="row"><span class="pill">${esc(detect.format || file.type || '')}</span>
        <span class="c-${vCls}" style="font-weight:650">${esc(vText)}</span></div>
      ${(detect.signals || []).length ? `<ul class="sig-list">${detect.signals.slice(0, 4).map((s) => `<li>${esc(s.label || s)}</li>`).join('')}</ul>` : ''}
      <div class="note-${clean.removed ? 'ok' : 'warn'}">${clean.removed ? '✓ ' + t('mediaCleaned', [String(clean.removed)]) : t('mediaNothing')}</div>
      <a class="cta" href="${cleanUrl}" download="clean-${esc(file.name || 'file')}" style="text-align:center;text-decoration:none;display:block">⬇ ${t('downloadClean')}</a>
      <div class="hint">${t('mediaHonest')}</div>`;
  } catch (e) {
    res.innerHTML = `<div class="note-warn">${esc(String(e.message || e))}</div>`;
  }
}

// ── Header actions ──
$('#open-workspace').addEventListener('click', () => {
  if (IS_EXTENSION) { const url = new URL(chrome.runtime.getURL('popup/popup.html')); url.searchParams.set('page', '1'); if (input.value) url.searchParams.set('text', input.value.slice(0, 8000)); chrome.tabs.create({ url: url.toString() }); window.close(); }
  else document.body.classList.toggle('page-mode');
});
$('#open-options').addEventListener('click', () => {
  if (IS_EXTENSION && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else location.href = '../options/options.html';
});

// ── init ──
updateCount();
if (input.value) { updateLang(); }
const mode = params.get('mode');
if (['humanize', 'check', 'tone', 'readability', 'paraphrase'].includes(mode) && input.value) {
  runText(mode);
  if (params.get('shot')) {
    setTimeout(() => document.querySelector('#result')?.scrollIntoView({ block: 'center' }), 1400);
  }
}
if (params.get('imgsrc')) { /* image via context menu handled by media tab in future */ }
input.focus();
