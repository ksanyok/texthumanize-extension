/**
 * TextHumanize — background service worker (v2).
 *
 * Hosts the full offline engine: humanize, AI-style detection, watermark
 * cleaning, tone, readability, paraphrase, stylometry, content typing, and
 * image provenance forensics. Lazy-loads language packs. Owns context menus,
 * commands and anonymous (content-free) usage telemetry.
 *
 * Every text operation runs locally. The only network call the worker can
 * make is fetching image *bytes* for provenance scanning, and only after the
 * user grants the optional host permission.
 */

import { humanize } from './engine/pipeline.js';
import { AIDetector, sentenceScores, quickScore } from './engine/detector.js';
import { detectLanguage } from './engine/lang-detect.js';
import { WatermarkDetector } from './engine/watermark.js';
import { analyzeTone, adjustTone } from './engine/tone.js';
import { analyzeReadability } from './engine/readability.js';
import { paraphrase } from './engine/paraphrase.js';
import { fingerprint } from './engine/stylometry.js';
import { classifyContent } from './engine/content-type.js';
import { contentHealth } from './engine/health.js';
import { uniquenessScore } from './engine/uniqueness.js';
import { perplexityScore } from './engine/perplexity.js';
import { textStatistics } from './engine/statistics.js';
import { extractKeywords } from './engine/keywords.js';
import { analyzeSentiment } from './engine/sentiment.js';
import { summarize } from './engine/summarize.js';
import { detectMediaWatermarks, cleanMediaWatermarks } from './engine/media-forensics.js';
import { siteForensics } from './engine/site-forensics.js';
import { splitSentences } from './engine/util.js';
import * as telemetry from './engine/telemetry.js';

telemetry.setVersion(chrome.runtime.getManifest().version);

const DEFAULT_SETTINGS = {
  intensity: 60,
  profile: 'web',
  langMode: 'auto',
  cleanWatermarks: true,
  selectionBubble: true,
  editorChip: true,
  imageHover: true,
  scanSites: [],           // hostnames where block hover-scan is enabled (per-site opt-in only)
  siteBadge: true,         // show the "site built by AI?" score on the toolbar icon
  effects: true,
  theme: 'auto',
  accent: 'mono',
  maxChangeRatio: 0.5,
  telemetry: true,
};

// ── Language packs (lazy, cached) ───────────────────────────────
const packCache = new Map();
let packIndex = null;

async function loadPackIndex() {
  if (!packIndex) {
    const res = await fetch(chrome.runtime.getURL('data/langs/index.json'));
    packIndex = await res.json();
  }
  return packIndex;
}

async function loadLangPack(code) {
  if (packCache.has(code)) return packCache.get(code);
  const index = await loadPackIndex();
  if (!index.languages[code]) { packCache.set(code, null); return null; }
  try {
    const res = await fetch(chrome.runtime.getURL(`data/langs/${code}.json`));
    const pack = await res.json();
    packCache.set(code, pack);
    return pack;
  } catch { packCache.set(code, null); return null; }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

async function resolve(text, overrides = {}) {
  const settings = await getSettings();
  const merged = { ...settings, ...overrides };
  const lang = merged.langMode === 'auto' ? detectLanguage(text) : merged.langMode;
  const langPack = await loadLangPack(lang);
  return { settings, merged, lang, langPack };
}

// ── Engine operations ───────────────────────────────────────────
async function opHumanize(text, overrides = {}) {
  const { merged, lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'humanize', lang });
  return humanize(text, {
    lang, profile: merged.profile, intensity: Number(merged.intensity),
    seed: typeof overrides.seed === 'number' ? overrides.seed : (Date.now() & 0xffff),
    cleanWatermarks: merged.cleanWatermarks, maxChangeRatio: merged.maxChangeRatio, langPack,
  });
}

async function opAnalyze(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'check', lang });
  const detection = new AIDetector().detect(text, { lang, langPack });
  const wm = new WatermarkDetector(lang).detect(text);
  return {
    lang, detection,
    watermark: { hasWatermarks: wm.hasWatermarks, types: wm.watermarkTypes, removed: wm.charactersRemoved, kirchenbauerScore: wm.kirchenbauerScore },
  };
}

async function opClean(text, overrides = {}) {
  const { lang } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'clean', lang });
  const r = new WatermarkDetector(lang).detect(text);
  return { lang, text: r.cleanedText, hasWatermarks: r.hasWatermarks, types: r.watermarkTypes,
    details: r.details, removed: r.charactersRemoved, homoglyphs: r.homoglyphsFound.length, zeroWidth: r.zeroWidthCount };
}

async function opTone(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'tone', lang });
  const r = analyzeTone(text, { lang, langPack });
  return { lang, ...r };
}

async function opToneAdjust(text, overrides = {}) {
  const { lang, langPack, merged } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'tone_adjust', lang });
  const r = adjustTone(text, overrides.target || 'neutral', { lang, langPack, seed: overrides.seed || 0, intensity: merged.intensity });
  return { lang, text: r.text, changes: r.changes || [] };
}

async function opReadability(text, overrides = {}) {
  const { lang } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'readability', lang });
  return { lang, ...analyzeReadability(text, lang) };
}

async function opParaphrase(text, overrides = {}) {
  const { lang, langPack, merged } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'paraphrase', lang });
  const r = paraphrase(text, { lang, langPack, intensity: merged.intensity,
    seed: typeof overrides.seed === 'number' ? overrides.seed : (Date.now() & 0xffff) });
  return { lang, text: r.text, changes: r.changes || [] };
}

async function opStylometry(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'stylometry', lang });
  return { lang, ...fingerprint(text, { lang, langPack }) };
}

async function opClassify(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  return { lang, ...classifyContent(text, { lang, langPack }) };
}

async function opHealth(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'health', lang });
  return { lang, ...contentHealth(text, { lang, langPack }) };
}

async function opUniqueness(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'uniqueness', lang });
  return { lang, ...uniquenessScore(text, { lang, langPack }) };
}

async function opPerplexity(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'perplexity', lang });
  return { lang, ...perplexityScore(text, { lang, langPack }) };
}

async function opSentiment(text, overrides = {}) {
  const { lang } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'sentiment', lang });
  return { lang, ...analyzeSentiment(text, { lang }) };
}

async function opStatistics(text) {
  telemetry.track('tool_used', { tool: 'statistics' });
  return textStatistics(text);
}

async function opKeywords(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'keywords', lang });
  return { lang, ...extractKeywords(text, { lang, langPack }) };
}

async function opSummarize(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  telemetry.track('tool_used', { tool: 'summarize', lang });
  return { lang, ...summarize(text, { lang, langPack, sentences: overrides.sentences || 3 }) };
}

async function opHeatmap(text, overrides = {}) {
  const { lang, langPack } = await resolve(text, overrides);
  const doc = new AIDetector().detect(text, { lang, langPack });
  const overallProb = doc.verdict === 'unknown' ? 0.5 : doc.aiProbability;
  const hm = sentenceScores(text, { lang, langPack, overall: overallProb });
  return { lang, sentences: hm.sentences.slice(0, 120), overall: { aiProbability: doc.aiProbability, verdict: doc.verdict } };
}

// ── Image provenance scan ───────────────────────────────────────
function bytesFromDataUrl(src) {
  const comma = src.indexOf(',');
  const meta = src.slice(5, comma);
  const body = src.slice(comma + 1);
  if (/;base64/i.test(meta)) return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(decodeURIComponent(body));
}

async function scanImage(src) {
  try {
    let bytes;
    if (src.startsWith('data:')) {
      bytes = bytesFromDataUrl(src);
    } else {
      const has = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
      if (!has) return { needsPermission: true };
      const res = await fetch(src);
      if (!res.ok) return { error: `http ${res.status}` };
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 25 * 1024 * 1024) return { error: 'too large' };
      bytes = new Uint8Array(buf);
    }
    const report = detectMediaWatermarks(bytes, {});
    telemetry.track('image_scan', { verdict: report.isAiGenerated === true ? 'ai' : report.provenance || 'none' });
    return report;
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

// ── Page scan ───────────────────────────────────────────────────
// `light` skips the (network-heavy) per-image forensics — used for the
// auto verdict banner so opening the popup stays instant. The full ИИ-сайт
// module runs the complete scan, images included.
async function scanPage(light = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { error: 'no-tab' };
  let collected;
  try {
    collected = await chrome.tabs.sendMessage(tab.id, { type: 'collect-page' });
  } catch {
    return { error: 'no-content' };
  }
  if (!collected) return { error: 'empty' };
  if (!light) telemetry.track('tool_used', { tool: 'scan_page' });

  const detector = new AIDetector();
  const blocks = (collected.blocks || []).slice(0, 40);
  let aiBlocks = 0;
  const scored = [];
  for (const text of blocks) {
    const lang = detectLanguage(text);
    const langPack = await loadLangPack(lang);
    const prob = detector.detect(text, { lang, langPack }).aiProbability;
    if (prob >= 0.55) aiBlocks++;
    scored.push({ text: text.slice(0, 140), prob });
  }
  const topBlocks = scored.slice().sort((a, b) => b.prob - a.prob).slice(0, 6).filter((b) => b.prob >= 0.4);

  const sample = blocks.join(' ').slice(0, 4000);
  const readability = sample ? analyzeReadability(sample, detectLanguage(sample)).fleschReadingEase : null;

  const imgs = (collected.images || []).slice(0, 12);
  const hasPerm = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
  let aiImages = 0;
  let imagesNeedPermission = false;
  if (light) {
    imagesNeedPermission = imgs.length > 0 && !hasPerm; // not scanned in light mode
  } else if (imgs.length && !hasPerm) {
    imagesNeedPermission = true;
  } else {
    for (const src of imgs) {
      try { const r = await scanImage(src); if (r.isAiGenerated === true) aiImages++; } catch { /* */ }
    }
  }

  let host = ''; try { host = new URL(tab.url).hostname; } catch { /* */ }
  const site = await withOverride(siteForensics(collected.site || {}, {
    aiTextShare: blocks.length ? aiBlocks / blocks.length : 0,
    aiImages, images: imgs.length, textBlocks: blocks.length,
  }), host);

  // A full scan sees the images, so upgrade the toolbar badge to match
  // (the on-load badge is code-only and can't fetch images).
  if (!light && tab.id != null) setSiteBadge(tab.id, site, host);

  return {
    textBlocks: blocks.length, aiBlocks, topBlocks,
    readability, images: imgs.length, aiImages, imagesNeedPermission,
    words: collected.words || 0, site, host,
  };
}

// ── Site feedback (anonymous, on-device) — user 👍/👎 tunes detection ──
// siteOverrides: {host: 'ai'|'human'} — per-site verdict correction (local).
// siteFeedback: content-free feature vectors (no host/URL) for offline tuning.
let overridesCache = null;
async function getOverrides() {
  if (overridesCache) return overridesCache;
  try { overridesCache = (await chrome.storage.local.get('siteOverrides')).siteOverrides || {}; }
  catch { overridesCache = {}; }
  return overridesCache;
}
function applyOverride(site, verdict) {
  if (!verdict) return site;
  const aiBuilt = verdict === 'ai' ? Math.max(site.aiBuilt || 0, 0.72) : Math.min(site.aiBuilt || 0, 0.22);
  return { ...site, verdict, aiBuilt, overridden: true };
}
async function withOverride(site, host) {
  if (!host) return site;
  const ov = await getOverrides();
  return ov[host] ? applyOverride(site, ov[host]) : site;
}
async function recordFeedback(host, label, sample) {
  const valid = label === 'ai' || label === 'human';
  try {
    const st = await chrome.storage.local.get(['siteOverrides', 'siteFeedback']);
    const overrides = st.siteOverrides || {};
    if (host) { if (valid) overrides[host] = label; else delete overrides[host]; }
    overridesCache = overrides;
    const feedback = Array.isArray(st.siteFeedback) ? st.siteFeedback : [];
    if (valid) {
      feedback.push({
        platformId: sample?.platformId || null, kind: sample?.kind || null,
        verdict: sample?.verdict || null, aiBuilt: Math.round((sample?.aiBuilt || 0) * 100) / 100,
        sigs: Array.isArray(sample?.sigs) ? sample.sigs.slice(0, 12) : [], label, ts: Date.now(),
      });
      if (feedback.length > 800) feedback.splice(0, feedback.length - 800);
    }
    await chrome.storage.local.set({ siteOverrides: overrides, siteFeedback: feedback });
    return feedback.length;
  } catch { return 0; }
}

// ── Toolbar badge + dynamic icon dot ────────────────────────────
const BADGE_COLORS = { ai: '#e5484d', mixed: '#e0a020', human: '#3a3f4b' };
const SCAN_OFF_DOT = '#ff3b30'; // red marker = block detector OFF here

// The icon carries a small dot: red when the on-page block detector is OFF for
// this site (tap the extension to enable it), none when it's ON.
const ICON_SIZES = [16, 32, 48];
let baseIcons = null;
const iconCache = {};

async function loadBaseIcons() {
  if (baseIcons) return baseIcons;
  baseIcons = {};
  for (const s of ICON_SIZES) {
    try { baseIcons[s] = await createImageBitmap(await (await fetch(chrome.runtime.getURL(`icons/icon${s}.png`))).blob()); }
    catch { baseIcons[s] = null; }
  }
  return baseIcons;
}

async function iconVariant(dotColor) {
  const key = dotColor || 'none';
  if (iconCache[key]) return iconCache[key];
  const bases = await loadBaseIcons();
  const imageData = {};
  for (const s of ICON_SIZES) {
    const ctx = new OffscreenCanvas(s, s).getContext('2d');
    if (bases[s]) ctx.drawImage(bases[s], 0, 0, s, s);
    if (dotColor) {
      const r = Math.max(2, Math.round(s * 0.24));
      const cx = s - r - Math.max(1, Math.round(s * 0.03));
      const cy = r + Math.max(1, Math.round(s * 0.03));
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = dotColor; ctx.fill();
      ctx.lineWidth = Math.max(1, Math.round(s * 0.07));
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke();
    }
    imageData[s] = ctx.getImageData(0, 0, s, s);
  }
  iconCache[key] = imageData;
  return imageData;
}

async function setScanIcon(tabId, scanning) {
  if (tabId == null) return;
  try { await chrome.action.setIcon({ tabId, imageData: await iconVariant(scanning ? null : SCAN_OFF_DOT) }); } catch { /* */ }
}

async function setSiteBadge(tabId, site, hostname) {
  if (tabId == null) return;
  site = await withOverride(site, hostname); // respect the user's 👍/👎 correction
  const settings = await getSettings();
  const scanning = !!(hostname && Array.isArray(settings.scanSites) && settings.scanSites.includes(hostname));
  setScanIcon(tabId, scanning); // red dot when the block detector is off here
  if (settings.siteBadge === false) { try { await chrome.action.setBadgeText({ tabId, text: '' }); } catch { /* */ } return; }
  const pct = Math.round((site.aiBuilt || 0) * 100);
  const text = pct >= 5 ? String(pct) : '';
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS[site.verdict] || BADGE_COLORS.human });
    await chrome.action.setBadgeText({ tabId, text });
    const base = site.platform ? `${site.platform} · ${pct}% AI-built` : `${pct}% AI-built (no builder fingerprint)`;
    const scanLbl = chrome.i18n.getMessage(scanning ? 'badgeScanOn' : 'badgeScanOff') || (scanning ? 'scan on' : 'scan off');
    await chrome.action.setTitle({ tabId, title: `TextHumanize — ${base} · ${scanLbl}` });
  } catch { /* tab gone */ }
}

// ── Message hub ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = (promise) => {
    Promise.resolve(promise)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  };

  switch (message?.type) {
    case 'humanize': return respond(opHumanize(message.text, message.overrides));
    case 'analyze': return respond(opAnalyze(message.text, message.overrides));
    case 'clean': return respond(opClean(message.text, message.overrides));
    case 'tone': return respond(opTone(message.text, message.overrides));
    case 'tone-adjust': return respond(opToneAdjust(message.text, message.overrides));
    case 'readability': return respond(opReadability(message.text, message.overrides));
    case 'paraphrase': return respond(opParaphrase(message.text, message.overrides));
    case 'stylometry': return respond(opStylometry(message.text, message.overrides));
    case 'health': return respond(opHealth(message.text, message.overrides));
    case 'uniqueness': return respond(opUniqueness(message.text, message.overrides));
    case 'perplexity': return respond(opPerplexity(message.text, message.overrides));
    case 'sentiment': return respond(opSentiment(message.text, message.overrides));
    case 'statistics': return respond(opStatistics(message.text));
    case 'keywords': return respond(opKeywords(message.text, message.overrides));
    case 'summarize': return respond(opSummarize(message.text, message.overrides));
    case 'classify': return respond(opClassify(message.text, message.overrides));
    case 'scan-image': return respond(scanImage(message.src));
    case 'scan-page': return respond(scanPage(!!message.light));
    case 'site-badge': {
      // Content script reports page code on load → set the toolbar badge and
      // hand the verdict back so the page can show its floating score orb.
      const site = siteForensics(message.site || {});
      if (sender.tab?.id != null) setSiteBadge(sender.tab.id, site, message.site?.hostname);
      sendResponse?.({ ok: true, data: site });
      return false;
    }
    case 'set-scan-icon': {
      // Popup toggled per-site scanning → flip the icon dot right away.
      const tabId = sender.tab?.id ?? message.tabId;
      if (tabId != null) setScanIcon(tabId, !!message.scanning);
      sendResponse?.({ ok: true });
      return false;
    }
    case 'site-feedback': return respond((async () => {
      const count = await recordFeedback(message.host, message.label, message.sample);
      // Re-badge the tab right away — setSiteBadge reads the fresh override.
      if (sender.tab?.id != null && message.host) {
        const base = { aiBuilt: message.sample?.aiBuilt || 0, verdict: message.sample?.verdict || 'human', platform: message.sample?.platform || null };
        setSiteBadge(sender.tab.id, base, message.host);
      }
      return { count };
    })());
    case 'get-feedback': return respond((async () => {
      const st = await chrome.storage.local.get('siteFeedback');
      return { samples: Array.isArray(st.siteFeedback) ? st.siteFeedback : [] };
    })());
    case 'clear-feedback': return respond((async () => {
      overridesCache = {};
      await chrome.storage.local.set({ siteFeedback: [], siteOverrides: {} });
      return { ok: true };
    })());
    case 'clean-media': return respond(Promise.resolve(cleanMediaWatermarks(message.bytes)));
    case 'detect-media': return respond(Promise.resolve(detectMediaWatermarks(message.bytes)));
    case 'heatmap': return respond(opHeatmap(message.text, message.overrides));
    case 'quick-score': return respond((async () => {
      const lang = detectLanguage(message.text);
      const langPack = await loadLangPack(lang);
      return { lang, ...quickScore(message.text, { lang, langPack }) };
    })());
    case 'detect-language': return respond(Promise.resolve(detectLanguage(message.text)));
    case 'get-settings': return respond(getSettings());
    case 'set-settings': return respond((async () => {
      const current = await getSettings();
      const next = { ...current, ...message.patch };
      await chrome.storage.sync.set({ settings: next });
      return next;
    })());
    case 'get-pack-index': return respond(loadPackIndex());
    case 'get-usage': return respond(telemetry.getUsage());
    case 'track': telemetry.track(message.event || 'event', message.params || {}); sendResponse?.({ ok: true }); return false;
    case 'open-workspace': openWorkspace(message.text || ''); sendResponse?.({ ok: true }); return false;
    default: return false;
  }
});

// ── Context menus & commands ────────────────────────────────────
const MENU_ITEMS = [
  { id: 'th-humanize', key: 'menuHumanize', contexts: ['selection'] },
  { id: 'th-check', key: 'menuCheck', contexts: ['selection'] },
  { id: 'th-tone', key: 'menuTone', contexts: ['selection'] },
  { id: 'th-clean', key: 'menuClean', contexts: ['selection'] },
  { id: 'th-image', key: 'menuImage', contexts: ['image'] },
  { id: 'th-workspace', key: 'menuWorkspace', contexts: ['action'] },
];

chrome.runtime.onInstalled.addListener((details) => {
  for (const item of MENU_ITEMS) {
    chrome.contextMenus.create({ id: item.id, title: chrome.i18n.getMessage(item.key), contexts: item.contexts });
  }
  if (details.reason === 'install') {
    telemetry.track('install');
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?page=1&welcome=1') });
  }
});

function openWorkspace(text = '', extra = {}) {
  const url = new URL(chrome.runtime.getURL('popup/popup.html'));
  url.searchParams.set('page', '1');
  if (text) url.searchParams.set('text', text.slice(0, 8000));
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  chrome.tabs.create({ url: url.toString() });
}

async function sendToContent(tab, action, selectionText) {
  if (!tab?.id) return;
  const message = { type: 'th-action', action, selectionText };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id },
        files: ['content/shared.js', 'content/panel.js', 'content/editors.js', 'content/images.js', 'content/hover.js', 'content/content.js'] });
      await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      openWorkspace(selectionText, action === 'check' ? { mode: 'check' } : {});
    }
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const map = { 'th-humanize': 'humanize', 'th-check': 'check', 'th-tone': 'tone', 'th-clean': 'clean' };
  if (info.menuItemId === 'th-workspace') { openWorkspace(info.selectionText || ''); return; }
  if (info.menuItemId === 'th-image') { openWorkspace('', { imgsrc: (info.srcUrl || '').slice(0, 1500) }); return; }
  const action = map[info.menuItemId];
  if (action) sendToContent(tab, action, info.selectionText || '');
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const map = { 'humanize-selection': 'humanize', 'check-selection': 'check' };
  const action = map[command];
  if (!action) return;
  const activeTab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  sendToContent(activeTab, action, '');
});
