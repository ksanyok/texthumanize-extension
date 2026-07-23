/**
 * TextHumanize · Aura popup — the orb reflects the real AI score of the
 * current text; modules run engine ops; media tab checks/cleans files.
 */

import { send, t, IS_EXTENSION } from './bridge.js';
import { MODULES } from '../engine/entitlements.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

// ── i18n ──
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
document.title = 'TextHumanize';
if (params.get('page') === '1' || !IS_EXTENSION) document.body.classList.add('page-mode');
// RTL locales (Arabic, Hebrew) — mirror the whole UI.
try { document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr'; } catch { /* web */ }

// ── version (shown in footer; helps confirm which build is loaded) ──
const APP_VERSION = (() => { try { return IS_EXTENSION ? chrome.runtime.getManifest().version : '3.3.0'; } catch { return '3.3.0'; } })();
{ const v = $('#foot-ver'); if (v) v.textContent = `v${APP_VERSION}`; }

// ── support row (promote the library: star / donate / rate) ──
const LIB_URL = 'https://github.com/ksanyok/TextHumanize';
const DONATE_URL = 'https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=ksanyok%40me.com&item_name=TextHumanize&currency_code=USD';
function openUrl(url) { if (IS_EXTENSION && chrome.tabs?.create) chrome.tabs.create({ url }); else window.open(url, '_blank', 'noopener'); }
(function renderSupport() {
  const box = $('#support'); if (!box) return;
  const rateUrl = IS_EXTENSION && chrome.runtime?.id
    ? `https://chrome.google.com/webstore/detail/${chrome.runtime.id}/reviews` : LIB_URL;
  box.innerHTML = `<span class="sup-like">${esc(t('supportLike'))}</span>
    <button class="sup-btn" data-u="${esc(LIB_URL)}">⭐ ${esc(t('supportStar'))}</button>
    <button class="sup-btn sup-donate" data-u="${esc(DONATE_URL)}">💛 ${esc(t('supportDonate'))}</button>
    <button class="sup-btn" data-u="${esc(rateUrl)}">★ ${esc(t('supportRate'))}</button>`;
  box.querySelectorAll('.sup-btn').forEach((b) => b.addEventListener('click', () => openUrl(b.dataset.u)));
})();

// ── line icons ──
const ICON = {
  humanize: '<path d="M12 4l1.5 4.3L18 10l-4.5 1.7L12 16l-1.5-4.3L6 10l4.5-1.7z"/>',
  paraphrase: '<path d="M4 7h11l-2.5-2.5M20 17H9l2.5 2.5"/>',
  tone: '<path d="M4 13c1.5 0 1.5-3 3-3s1.5 6 3 6 1.5-9 3-9 1.5 6 3 6 1.5-3 3-3"/>',
  readability: '<path d="M4 5.5A2 2 0 016 4h5v15H6a2 2 0 00-2 1.5zM20 5.5A2 2 0 0018 4h-5v15h5a2 2 0 012 1.5z"/>',
  health: '<path d="M12 20s-7-4.5-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.5-7 9-7 9z"/>',
  uniqueness: '<path d="M6 9l2-4h8l2 4-6 10z"/><path d="M6 9h12"/>',
  keywords: '<path d="M4 12l7-7h6a1 1 0 011 1v6l-7 7z"/><circle cx="15" cy="9" r="1.1"/>',
  perplexity: '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 018 5M4 16a9 9 0 008 5"/>',
  sentiment: '<circle cx="12" cy="12" r="8"/><path d="M8.5 14c1 1.4 6 1.4 7 0M9 9.5h.01M15 9.5h.01"/>',
  statistics: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  summarize: '<path d="M5 6h14M5 10h14M5 14h9M5 18h9"/>',
  formalize: '<path d="M6 21v-8l6-4 6 4v8M9 21v-4h6v4"/>',
  simplify: '<circle cx="12" cy="6" r="2"/><path d="M12 8v6M8 21l4-7 4 7"/>',
  clean: '<path d="M6 8l1-3h10l1 3M8 8v10a2 2 0 002 2h4a2 2 0 002-2V8"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-4 4 3 3-2 6 4"/><circle cx="8.5" cy="9.5" r="1.2"/>',
  mediaClean: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12l2.5 2.5L16 9"/>',
  site: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17"/>',
};
// Text tools live in the dock; site / text / media are the top switcher tabs.
const DEFAULT_DOCK = ['humanize', 'paraphrase', 'tone', 'readability', 'health', 'uniqueness', 'keywords', 'clean'];
const THEMES = [
  ['mono', '#c9cdda'], ['violet', '#8b7bff'], ['emerald', '#26d17a'],
  ['ember', '#ff8a4c'], ['ice', '#7fd8ff'], ['rose', '#ff7eb6'],
];

let settings = {};
let lastResult = null;
let lastSeed = Date.now() & 0xffff;
let currentHost = '';
let currentTabId = null;

// Current tab (for the per-site block-scan allowlist + icon refresh).
if (IS_EXTENSION && chrome.tabs?.query) {
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    currentTabId = tabs[0]?.id ?? null;
    try { currentHost = new URL(tabs[0]?.url || '').hostname; } catch { /* */ }
  }).catch(() => {});
}

// ── settings + theme ──
send({ type: 'get-settings' }).then((s) => {
  settings = s || {};
  applyTheme(settings.accent || 'mono');
  renderDock();
  maybeOnboard();
}).catch(() => { applyTheme('mono'); renderDock(); });

// First-run welcome — explains the tabs + the icon dot, shown once.
function maybeOnboard() {
  if (!IS_EXTENSION || settings.onboarded || params.get('imgsrc')) return;
  const o = $('#onboard'); if (!o) return;
  o.hidden = false;
  o.innerHTML = `<b>${esc(t('onboardTitle'))}</b><p>${esc(t('onboardText'))}</p>
    <button class="btn solid" id="onboard-ok">${esc(t('onboardOk'))}</button>`;
  o.querySelector('#onboard-ok').addEventListener('click', () => {
    o.hidden = true; settings.onboarded = true;
    send({ type: 'set-settings', patch: { onboarded: true } }).catch(() => {});
  });
}

function applyTheme(accent) {
  document.documentElement.dataset.accent = accent === 'mono' ? '' : accent;
  document.documentElement.dataset.accentName = accent;
}
$('#open-theme').addEventListener('click', () => {
  const row = $('#theme-row');
  row.hidden = !row.hidden;
  if (!row.dataset.built) {
    row.innerHTML = THEMES.map(([id, col]) => `<span class="sw" data-th="${id}" style="background:${id === 'mono' ? 'linear-gradient(145deg,#e7e9f2,#8b90a0)' : col}"></span>`).join('');
    row.dataset.built = '1';
    row.querySelectorAll('.sw').forEach((sw) => sw.addEventListener('click', () => {
      applyTheme(sw.dataset.th);
      row.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === sw));
      send({ type: 'set-settings', patch: { accent: sw.dataset.th } }).catch(() => {});
    }));
  }
  row.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x.dataset.th === (settings.accent || 'mono')));
});

// ── dock ──
function renderDock() {
  const enabled = Array.isArray(settings.dock) ? settings.dock : DEFAULT_DOCK;
  const items = enabled.map((id) => {
    if (id === 'media') return { id: 'media', op: '_media', i18n: 'actMediaWm', desc: 'descMediaWm' };
    if (id === 'site') return { id: 'site', op: 'scan-page', i18n: 'actSiteAi', desc: 'descSiteAi' };
    return MODULES.find((m) => m.id === id);
  }).filter(Boolean);
  $('#dock').innerHTML = items.map((m) => `
    <div class="mod" data-id="${m.id}" title="${esc(t(m.desc) || '')}"><svg viewBox="0 0 24 24">${ICON[m.id] || ICON.humanize}</svg>
    <span class="nm">${esc(t(m.i18n) || m.id)}</span></div>`).join('');
  $('#dock').querySelectorAll('.mod').forEach((el) => el.addEventListener('click', () => onModule(el.dataset.id)));
}
$('#customize').addEventListener('click', () => openOptions());

// ── helpers ──
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Word-level LCS diff → HTML with <del>/<ins>. Whitespace tokens are kept so
// spacing survives; only non-blank tokens get marked.
function wordDiff(a, b) {
  const A = String(a).split(/(\s+)/); const B = String(b).split(/(\s+)/);
  const n = A.length; const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0; let j = 0; let out = '';
  const mark = (tok, tag) => (tok.trim() ? `<${tag}>${esc(tok)}</${tag}>` : esc(tok));
  while (i < n && j < m) {
    if (A[i] === B[j]) { out += esc(A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out += mark(A[i], 'del'); i++; }
    else { out += mark(B[j], 'ins'); j++; }
  }
  while (i < n) { out += mark(A[i], 'del'); i++; }
  while (j < m) { out += mark(B[j], 'ins'); j++; }
  return out;
}
function hueFor(pct) { return Math.max(2, Math.round(130 - pct * 1.7)); }
function verdictText(v) { return t(`verdict_${v}`) || v; }
function verdictColor(pct) { return pct >= 60 ? '#ff9a7a' : pct >= 40 ? '#ffd27a' : '#7ff0b0'; }

// ── orb (shared hero: shows the site score by default, text score in text mode) ──
let countRAF = 0;
function setOrb(pct, verdict, ctx) {
  const wrap = $('#orb-wrap');
  const stage = $('#stage');
  if (ctx) $('#pc').textContent = ctx === 'site' ? t('orbPctSite') : t('orbPctText');
  if (pct == null) { stage.classList.add('empty'); wrap.classList.add('orb-empty'); $('#num').textContent = '–'; $('#verdict').textContent = ''; $('#heat').innerHTML = ''; return; }
  stage.classList.remove('empty');
  wrap.classList.remove('orb-empty');
  const hue = hueFor(pct);
  document.documentElement.style.setProperty('--hue', hue);
  document.documentElement.style.setProperty('--glow', `hsla(${hue},90%,55%,.5)`);
  const num = $('#num');
  cancelAnimationFrame(countRAF);
  const from = parseInt(num.textContent) || 0;
  num.textContent = Math.round(pct); // final value now (animation just prettifies)
  const start = performance.now();
  const step = (now) => { const k = Math.min(1, (now - start) / 600); const e = 1 - Math.pow(1 - k, 3); num.textContent = Math.round(from + (pct - from) * e); if (k < 1) countRAF = requestAnimationFrame(step); };
  if (settings.effects !== false) countRAF = requestAnimationFrame(step);
  const vd = $('#verdict'); vd.textContent = verdictText(verdict); vd.style.color = verdictColor(pct);
}
function setHeat(sentences) {
  $('#heat').innerHTML = (sentences || []).slice(0, 40).map((s) => `<span style="background:hsl(${(1 - s.prob) * 120},72%,52%)"></span>`).join('');
}

// ── input ──
const input = $('#input');
if (params.get('text')) input.value = params.get('text');
let debounce = null;
input.addEventListener('input', () => { updateMeta(); clearTimeout(debounce); debounce = setTimeout(analyzeCurrent, 500); });
function updateMeta() {
  const txt = input.value;
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  $('#count').textContent = txt ? `${words} ${t('words').toLowerCase()}` : '';
  $('#clear-btn').hidden = !txt;
}
$('#paste-btn').addEventListener('click', async () => { try { const x = await navigator.clipboard.readText(); if (x) { input.value = x; updateMeta(); analyzeCurrent(); } } catch { input.focus(); } });
$('#clear-btn').addEventListener('click', () => { input.value = ''; updateMeta(); setOrb(null, null, 'text'); $('#result').hidden = true; $('#lang-badge').hidden = true; input.focus(); });

async function analyzeCurrent() {
  const text = input.value.trim();
  if (text.length < 12) { setOrb(null, null, 'text'); return; }
  try {
    const [a, hm] = await Promise.all([send({ type: 'analyze', text }), send({ type: 'heatmap', text })]);
    const d = a.detection;
    const pct = d.verdict === 'unknown' ? 50 : Math.round(d.aiProbability * 100);
    setOrb(pct, d.verdict === 'unknown' ? 'mixed' : d.verdict, 'text');
    setHeat(hm.sentences);
    if (a.lang) { $('#lang-badge').textContent = a.lang.toUpperCase(); $('#lang-badge').hidden = false; }
  } catch { /* */ }
}

// ── views ──
function busy(on) { $('#busy').hidden = !on; }
$('#humanize-btn').addEventListener('click', () => runOp('humanize', { seed: lastSeed }));

let curView = 'site';
// site score is remembered so the hero orb can restore it when switching back.
let siteScore = null; let siteVerdict = 'human';

function setView(name) {
  curView = name;
  for (const v of ['text', 'media', 'site']) $(`#view-${v}`).hidden = v !== name;
  $('#switcher').querySelectorAll('.sw').forEach((el) => el.classList.toggle('on', el.dataset.view === name));
  // The hero orb belongs to site/text; media has its own preview.
  $('#stage').hidden = name === 'media';
  if (name === 'site') setOrb(siteScore, siteVerdict, 'site');
  else if (name === 'text') { if (input.value.trim()) analyzeCurrent(); else setOrb(null, null, 'text'); }
}
$('#switcher').querySelectorAll('.sw').forEach((el) => el.addEventListener('click', () => onView(el.dataset.view)));

function onView(name) {
  clearActive();
  if (name === 'site') { setView('site'); if (!siteData) runSite(); }
  else if (name === 'media') setView('media');
  else setView('text');
}
function clearActive() { $('#dock').querySelectorAll('.mod').forEach((el) => el.classList.remove('active')); }

function onModule(id) {
  $('#dock').querySelectorAll('.mod').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  if (id === 'media') { setView('media'); return; }
  if (id === 'site') { setView('site'); if (!siteData) runSite(); return; }
  setView('text');
  const mod = MODULES.find((m) => m.id === id);
  if (!mod) return;
  runOp(mod.op, mod.overrides || {}, mod);
}

async function runOp(op, overrides = {}, mod = null) {
  // The main Humanize button calls in without a module; resolve it from the op
  // so the result still gets a proper heading instead of the bare op name.
  if (!mod) mod = MODULES.find((m) => m.op === op) || null;
  const text = input.value.trim();
  if (!text) {
    $('#result').hidden = false;
    $('#result').innerHTML = `<div class="note-warn">${esc(t('needText'))}</div>`;
    input.focus();
    return;
  }
  busy(true);
  try {
    const data = await send({ type: op, text, overrides });
    if (data && data.original == null) data.original = text; // enable before/after diff
    lastResult = { op, mod, data };
    renderResult();
    if ((mod?.transforms || op === 'humanize') && data.text != null) {
      // re-score the transformed text
      const hm = await send({ type: 'heatmap', text: data.text });
      const after = hm.overall ? Math.round(hm.overall.aiProbability * 100) : null;
      if (after != null) setOrb(after, hm.overall.verdict, 'text');
      setHeat(hm.sentences);
    }
  } catch (e) { $('#result').hidden = false; $('#result').innerHTML = `<div class="note-warn">${esc(String(e.message || e))}</div>`; }
  finally { busy(false); }
}

function renderResult() {
  const { op, mod, data } = lastResult;
  const box = $('#result'); box.hidden = false;
  setTimeout(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
  const sub = mod?.desc ? `<p class="res-sub">${esc(t(mod.desc))}</p>` : '';
  const title = `<h4>${esc(t(mod?.i18n) || op)}</h4>${sub}`;

  // transforms → editable output + copy
  if ((mod?.transforms || op === 'humanize') && data.text != null) {
    const canDiff = data.original != null && data.original !== data.text && (data.original.length + data.text.length) < 12000;
    box.innerHTML = `${title}
      <div class="out-text" contenteditable="true" spellcheck="false">${esc(data.text)}</div>
      <div class="row"><span class="hint">${t('changesCount', [String((data.changes || []).length)])}</span><span class="grow"></span>
      ${canDiff ? `<button class="btn" id="diff">⇄ ${t('showDiff')}</button>` : ''}
      ${op === 'humanize' || op === 'paraphrase' ? `<button class="btn" id="reroll">↻ ${t('reroll')}</button>` : ''}
      <button class="btn solid" id="copy">${t('copy')}</button>
      <button class="btn" id="use">${t('useText') || 'Use'}</button></div>`;
    const out = box.querySelector('.out-text');
    if (canDiff) {
      let diffOn = false;
      const diffBtn = box.querySelector('#diff');
      diffBtn.addEventListener('click', () => {
        diffOn = !diffOn;
        if (diffOn) { out.classList.add('diff-view'); out.contentEditable = 'false'; out.innerHTML = wordDiff(data.original, out.innerText); diffBtn.innerHTML = `⇄ ${t('showText')}`; }
        else { out.classList.remove('diff-view'); out.contentEditable = 'true'; out.textContent = data.text; diffBtn.innerHTML = `⇄ ${t('showDiff')}`; }
      });
    }
    box.querySelector('#copy').addEventListener('click', () => copy(out.innerText));
    box.querySelector('#use').addEventListener('click', () => { input.value = out.innerText; updateMeta(); analyzeCurrent(); });
    box.querySelector('#reroll')?.addEventListener('click', () => { lastSeed = (lastSeed * 1103515245 + 12345) & 0x7fffffff; runOp(op, { ...(mod?.overrides || {}), seed: lastSeed }, mod); });
    return;
  }

  // analysis renderers
  if (op === 'readability') {
    box.innerHTML = title + bars([
      ['metric_fleschReadingEase', clamp(data.fleschReadingEase), data.readingLevel],
      ['metric_fleschKincaidGrade', pctOf(data.fleschKincaidGrade, 20), 'grade ' + Math.round(data.fleschKincaidGrade)],
      ['metric_gunningFog', pctOf(data.gunningFog, 20), null],
      ['metric_smog', pctOf(data.smog, 20), null],
    ]);
  } else if (op === 'health') {
    box.innerHTML = title + `<div class="kv"><span class="pill2">${t('grade')}: <b>${esc(data.grade)}</b></span><span class="pill2">${data.score}/100</span></div>`
      + bars((data.components || []).map((c) => [c.name, clamp(c.score), null]), true);
  } else if (op === 'uniqueness') {
    box.innerHTML = title + bars([['actUniqueness', Math.round((data.score || 0) * 100), null]]) +
      `<div class="hint">${(data.repeatedNgrams || []).slice(0, 3).map((r) => esc(r.ngram)).join(' · ')}</div>`;
  } else if (op === 'perplexity') {
    box.innerHTML = title + `<div class="kv"><span class="pill2">perplexity ${Math.round(data.perplexity)}</span><span class="pill2">burstiness ${Math.round((data.burstiness || 0) * 100) / 100}</span><span class="pill2">${t('metric_perplexity')}: ${Math.round((1 - (data.predictability || 0)) * 100)}%</span></div>`;
  } else if (op === 'tone') {
    box.innerHTML = title + bars([['formality', Math.round((data.formalityScore || 0) * 100), t(`tone_${data.level}`) || data.level]]) +
      `<div class="row" style="margin-top:2px"><button class="btn" data-lvl="formal">${t('toneMoreFormal')}</button><button class="btn" data-lvl="casual">${t('toneMoreCasual')}</button></div>`;
    box.querySelectorAll('[data-lvl]').forEach((b) => b.addEventListener('click', () => runOp('tone-adjust', { target: b.dataset.lvl }, { transforms: true, i18n: 'actTone' })));
  } else if (op === 'sentiment') {
    const p = Math.round(((data.polarity + 1) / 2) * 100);
    box.innerHTML = title + bars([['actSentiment', p, data.label]]);
  } else if (op === 'keywords') {
    box.innerHTML = title + `<div class="kv">${(data.keywords || []).slice(0, 8).map((k) => `<span class="pill2">${esc(k.term)} · ${k.count}</span>`).join('')}</div>`;
  } else if (op === 'statistics') {
    box.innerHTML = title + `<div class="kv">
      <span class="pill2">${data.words} ${t('words').toLowerCase()}</span><span class="pill2">${data.sentences} sent.</span>
      <span class="pill2">TTR ${data.lexicalDiversity}</span><span class="pill2">${data.readingTimeSec}s read</span></div>`;
  } else if (op === 'summarize') {
    box.innerHTML = title + `<div class="out-text">${esc(data.summary)}</div>`;
  } else {
    box.innerHTML = title + `<div class="hint">${esc(JSON.stringify(data).slice(0, 200))}</div>`;
  }
  requestAnimationFrame(() => box.querySelectorAll('.bar i').forEach((b) => { b.style.width = b.dataset.w + '%'; }));
}

function bars(rows, animate) {
  return `<div class="bars">${rows.map(([lab, pct, sub]) => `
    <div class="bar-row"><span class="lab">${esc(t(lab) || lab)}</span>
    <div class="bar"><i data-w="${Math.max(0, Math.min(100, Math.round(pct)))}"${animate ? '' : ` style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%"`}></i></div>
    <b>${sub != null ? esc(String(sub)) : Math.round(pct)}</b></div>`).join('')}</div>`;
}
function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }
function pctOf(n, max) { return Math.max(0, Math.min(100, Math.round((n / max) * 100))); }
function copy(text) { navigator.clipboard?.writeText(text).catch(() => {}); }

// ── site check: "is this site built with AI?" (code forensics first) ──
let siteData = null;
function siteColor(v) { return v === 'ai' ? '#ff9a7a' : v === 'mixed' ? '#ffd27a' : '#7ff0b0'; }
function siteHead(v) { return v === 'ai' ? t('siteLikelyAi') : v === 'mixed' ? t('siteSomeAi') : t('siteLikelyHuman'); }
function platformLine(site) {
  if (!site.platform) return t('siteHandcoded');
  const kind = t('kind_' + String(site.kind).replace(/-/g, '_')) || site.kind;
  return `${site.platform} · ${kind}`;
}
function signalHtml(s) {
  if (s.code === 'platform') {
    const kind = t('kind_' + String(s.kind).replace(/-/g, '_')) || s.kind;
    const hits = (s.hits || []).length ? ` <span class="sig-hit">${esc(s.hits.join(', '))}</span>` : '';
    return `<li><b>${esc(s.name)}</b> · ${esc(kind)}${hits}</li>`;
  }
  if (s.code === 'handcoded') return `<li>${esc(t('siteHandcoded'))}</li>`;
  if (s.code === 'heuristic') return `<li>${esc(t('sig_' + s.id) || s.label)}</li>`;
  if (s.code === 'vibeHost') return `<li>${esc(t('sigVibeHost', [s.host]))}</li>`;
  if (s.code === 'aiImages') return `<li>${esc(t('sigAiImages', [`${s.aiImages}/${s.images}`]))}</li>`;
  if (s.code === 'aiText') return `<li>${esc(t('sigAiText', [`${s.aiBlocks}/${s.textBlocks}`]))}</li>`;
  return '';
}

async function runSite() {
  const box = $('#site-result');
  box.innerHTML = `<div class="busy"><span class="spinner"></span><span>${t('scanning')}</span></div>`;
  if (curView === 'site') setOrb(null, null, 'site');
  try {
    const d = siteData || await send({ type: 'scan-page' });
    siteData = d;
    if (d.error) { box.innerHTML = `<div class="note-warn">${esc(t('pageScanUnavailable'))}</div>`; return; }
    renderSite();
  } catch (e) { box.innerHTML = `<div class="note-warn">${esc(String(e.message || e))}</div>`; }
}

function renderSite() {
  const d = siteData; if (!d) return;
  const box = $('#site-result');
  const site = d.site || { aiBuilt: 0, verdict: 'human', signals: [], platform: null, kind: 'unknown' };
  siteScore = Math.round((site.aiBuilt || 0) * 100);
  siteVerdict = site.verdict;
  if (curView === 'site') setOrb(siteScore, siteVerdict, 'site');
  const col = siteColor(site.verdict);
  const aiText = d.textBlocks ? Math.round((d.aiBlocks / Math.max(1, d.textBlocks)) * 100) : 0;
  box.innerHTML = `
    <div class="result">
      <b class="site-head" style="color:${col}">${esc(siteHead(site.verdict))}</b>
      <div class="site-plat">${esc(platformLine(site))}</div>
      <div class="kv" style="margin-top:8px">
        <span class="pill2">🖼 <b>${d.aiImages || 0}${d.imagesNeedPermission ? '?' : ''}</b>/${d.images || 0}</span>
        <span class="pill2">📝 ${t('pageAiTextShort')}: <b>${aiText}%</b> · ${d.aiBlocks || 0}/${d.textBlocks || 0}</span>
        <span class="pill2">${d.words || 0} ${t('words').toLowerCase()}</span>
      </div>
      <div class="hint" style="margin-top:8px">${t('siteEvidence')}</div>
      <ul class="signals">${(site.signals || []).map(signalHtml).join('')}</ul>
      ${feedbackRow(site)}
      ${scanInvite()}
      ${(d.topBlocks || []).length ? `<details class="fold"><summary>${t('pageTopAi')}</summary>${(d.topBlocks || []).slice(0, 3).map((b) => `<div class="out-text" style="max-height:none">${esc(b.text)}</div>`).join('')}</details>` : ''}
    </div>`;
  wireScanToggle(box);
  wireFeedback(box, site);
}

// 👍/👎 feedback — corrects this site now and stores an anonymous label for tuning.
function feedbackRow(site) {
  if (!currentHost) return '';
  if (site.overridden) {
    return `<div class="fb-row done"><span>✓ ${esc(t('siteFbThanks'))}</span><a id="fb-reset" class="fb-reset">${esc(t('siteFbReset'))}</a></div>`;
  }
  return `<div class="fb-row"><span>${esc(t('siteFbQ'))}</span><span class="grow"></span>
    <button class="fb-btn" data-fb="ai">👍 ${esc(t('siteFbAi'))}</button>
    <button class="fb-btn" data-fb="human">👤 ${esc(t('siteFbHuman'))}</button></div>`;
}
function wireFeedback(box, site) {
  const sample = {
    platform: site.platform, platformId: site.platformId, kind: site.kind,
    verdict: site.verdict, aiBuilt: site.aiBuilt,
    sigs: (site.signals || []).map((s) => s.code + (s.id ? ':' + s.id : s.code === 'platform' ? ':' + (s.name || '') : '')),
  };
  box.querySelectorAll('.fb-btn').forEach((b) => b.addEventListener('click', async () => {
    const label = b.dataset.fb;
    await send({ type: 'site-feedback', host: currentHost, label, sample }).catch(() => {});
    if (siteData?.site) { siteData.site = { ...siteData.site, verdict: label, aiBuilt: label === 'ai' ? Math.max(site.aiBuilt, 0.72) : Math.min(site.aiBuilt, 0.22), overridden: true }; }
    renderSite();
  }));
  box.querySelector('#fb-reset')?.addEventListener('click', async () => {
    // Clearing this host's override = re-scan without it.
    await send({ type: 'site-feedback', host: currentHost, label: null, sample }).catch(() => {});
    siteData = null; runSite();
  });
}

// Per-site opt-in for on-page block highlighting — a clear offer when off.
function scanInvite() {
  if (!currentHost) return '';
  const on = Array.isArray(settings.scanSites) && settings.scanSites.includes(currentHost);
  if (on) {
    return `<div class="scan-invite on"><div class="si-txt"><b>${esc(t('scanOnTitle'))}</b><small>${esc(currentHost)}</small></div>
      <button class="btn" id="scan-toggle">${esc(t('scanDisable'))}</button></div>`;
  }
  return `<div class="scan-invite"><div class="si-txt"><b>${esc(t('scanInviteTitle'))}</b><small>${esc(t('scanInviteText'))}</small></div>
    <button class="btn solid" id="scan-toggle">${esc(t('sbScanEnable'))}</button></div>`;
}
function wireScanToggle(box) {
  const btn = box.querySelector('#scan-toggle');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const list = new Set(Array.isArray(settings.scanSites) ? settings.scanSites : []);
    const on = !list.has(currentHost);
    if (on) list.add(currentHost); else list.delete(currentHost);
    settings.scanSites = [...list];
    await send({ type: 'set-settings', patch: { scanSites: settings.scanSites } }).catch(() => {});
    send({ type: 'set-scan-icon', tabId: currentTabId, scanning: on }).catch(() => {});
    renderSite();
  });
}

// ── media ──
const drop = $('#drop'); const fileInput = $('#file-input');
$('#pick-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (ev) => { const f = ev.dataTransfer.files[0]; if (f) handleFile(f); });

async function handleFile(file) {
  const res = $('#media-result'); res.innerHTML = `<div class="busy"><span class="spinner"></span><span>${t('processing')}</span></div>`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detect = await send({ type: 'detect-media', bytes });
    const clean = await send({ type: 'clean-media', bytes });
    const isImg = /^image\//.test(file.type);
    const cleanUrl = URL.createObjectURL(new Blob([clean.cleaned], { type: file.type || 'application/octet-stream' }));
    const verdict = detect.isAiGenerated === true ? 'ai' : detect.provenance === 'authentic' ? 'authentic' : 'none';
    const vCls = verdict === 'ai' ? 'note-warn' : 'note-ok';
    const vText = verdict === 'ai' ? (t('imgAi') + (detect.generator ? ' · ' + detect.generator : '')) : verdict === 'authentic' ? t('imgAuthentic') : t('imgNoMarkers');
    res.innerHTML = `<div class="result">
      ${isImg ? `<img class="media-preview" src="${URL.createObjectURL(file)}" alt="">` : ''}
      <div class="row"><span class="pill2">${esc(detect.format || file.type || 'file')}</span><span class="${vCls}">${esc(vText)}</span></div>
      <div class="${clean.removed ? 'note-ok' : 'hint'}">${clean.removed ? '✓ ' + t('mediaCleaned', [String(clean.removed)]) : t('mediaNothing')}</div>
      <a class="cta" href="${cleanUrl}" download="clean-${esc(file.name || 'file')}" style="text-decoration:none">⬇ ${t('downloadClean')}</a>
      <div class="hint">${t('mediaHonest')}</div></div>`;
  } catch (e) { res.innerHTML = `<div class="note-warn">${esc(String(e.message || e))}</div>`; }
}

async function scanImageUrl(src) {
  onModule('media');
  const res = $('#media-result'); res.innerHTML = `<div class="busy"><span class="spinner"></span><span>${t('imgScanning')}</span></div>`;
  try {
    const detect = await send({ type: 'scan-image', src });
    if (detect.needsPermission) {
      res.innerHTML = `<div class="hint">${t('imgEnableHint')}</div><button class="btn solid" id="grant">${t('optImageHover')}</button>`;
      res.querySelector('#grant').addEventListener('click', async () => { if (chrome.permissions?.request) { const ok = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false); if (ok) scanImageUrl(src); } });
      return;
    }
    if (detect.error) { res.innerHTML = `<div class="note-warn">${esc(detect.error)}</div>`; return; }
    const verdict = detect.isAiGenerated === true ? 'ai' : detect.provenance === 'authentic' ? 'authentic' : 'none';
    const vText = verdict === 'ai' ? (t('imgAi') + (detect.generator ? ' · ' + detect.generator : '')) : verdict === 'authentic' ? t('imgAuthentic') : t('imgNoMarkers');
    res.innerHTML = `<div class="result"><img class="media-preview" src="${esc(src)}" referrerpolicy="no-referrer" alt="">
      <div class="row"><span class="pill2">${esc(detect.format || 'image')}</span><span class="${verdict === 'ai' ? 'note-warn' : 'note-ok'}">${esc(vText)}</span></div>
      <div class="hint">${t('mediaHonest')}</div></div>`;
  } catch (e) { res.innerHTML = `<div class="note-warn">${esc(String(e.message || e))}</div>`; }
}

// ── header nav ──
function openOptions() { if (IS_EXTENSION && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage(); else location.href = '../options/options.html'; }
$('#open-options').addEventListener('click', openOptions);
$('#open-workspace').addEventListener('click', () => {
  if (IS_EXTENSION) { const u = new URL(chrome.runtime.getURL('popup/popup.html')); u.searchParams.set('page', '1'); if (input.value) u.searchParams.set('text', input.value.slice(0, 8000)); chrome.tabs.create({ url: u.toString() }); window.close(); }
  else document.body.classList.toggle('page-mode');
});

// ── init ──
try {
  updateMeta();
  const imgsrc = params.get('imgsrc');
  if (imgsrc) {
    // Dedicated right-click image check: only the media result, nothing else.
    document.body.classList.add('focus-media');
    $('#stage').hidden = true; $('#switcher').hidden = true; $('#drop').hidden = true;
    setView('media');
    scanImageUrl(imgsrc);
  } else if (input.value) {
    // Opened with prefilled text (workspace / selection) → text mode.
    setView('text'); analyzeCurrent(); input.focus();
  } else if (IS_EXTENSION) {
    // Home = the site dashboard, orb shows the site score.
    setView('site'); runSite();
  } else {
    // Web demo: no page to scan → start in text mode.
    $('#sw-site').hidden = true; $('#sw-media').hidden = true;
    setView('text'); setOrb(null, null, 'text'); input.focus();
  }
} catch (e) { console.warn('TextHumanize popup init', e); }
