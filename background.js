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
import { AIDetector } from './engine/detector.js';
import { detectLanguage } from './engine/lang-detect.js';
import { WatermarkDetector } from './engine/watermark.js';
import { analyzeTone, adjustTone } from './engine/tone.js';
import { analyzeReadability } from './engine/readability.js';
import { paraphrase } from './engine/paraphrase.js';
import { fingerprint } from './engine/stylometry.js';
import { classifyContent } from './engine/content-type.js';
import { detectMediaWatermarks } from './engine/media-forensics.js';
import * as telemetry from './engine/telemetry.js';

telemetry.setVersion(chrome.runtime.getManifest().version);

const DEFAULT_SETTINGS = {
  intensity: 60,
  profile: 'web',
  langMode: 'auto',
  cleanWatermarks: true,
  selectionBubble: true,
  editorChip: true,
  imageHover: false,
  effects: true,
  theme: 'auto',
  maxChangeRatio: 0.4,
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
    case 'classify': return respond(opClassify(message.text, message.overrides));
    case 'scan-image': return respond(scanImage(message.src));
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
        files: ['content/shared.js', 'content/panel.js', 'content/editors.js', 'content/images.js', 'content/content.js'] });
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
