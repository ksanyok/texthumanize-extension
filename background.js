/**
 * TextHumanize — background service worker.
 *
 * Hosts the offline engine: loads language packs lazily, processes
 * humanize/analyze/clean requests from the popup, content scripts and
 * the workspace page. Owns context menus and keyboard commands.
 *
 * Everything runs locally — no network requests, ever.
 */

import { humanize } from './engine/pipeline.js';
import { AIDetector } from './engine/detector.js';
import { detectLanguage } from './engine/lang-detect.js';
import { WatermarkDetector } from './engine/watermark.js';

const DEFAULT_SETTINGS = {
  intensity: 60,
  profile: 'web',
  langMode: 'auto',
  cleanWatermarks: true,
  selectionBubble: true,
  theme: 'auto',
  maxChangeRatio: 0.4,
};

// ── Language pack loader (lazy, cached) ─────────────────────────

/** @type {Map<string, object|null>} */
const packCache = new Map();
let packIndex = null;

async function loadPackIndex() {
  if (!packIndex) {
    const res = await fetch(chrome.runtime.getURL('data/langs/index.json'));
    packIndex = await res.json();
  }
  return packIndex;
}

/** @param {string} code @returns {Promise<object|null>} */
async function loadLangPack(code) {
  if (packCache.has(code)) return packCache.get(code);
  const index = await loadPackIndex();
  if (!index.languages[code]) {
    packCache.set(code, null);
    return null;
  }
  try {
    const res = await fetch(chrome.runtime.getURL(`data/langs/${code}.json`));
    const pack = await res.json();
    packCache.set(code, pack);
    return pack;
  } catch {
    packCache.set(code, null);
    return null;
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

// ── Engine operations ───────────────────────────────────────────

async function opHumanize(text, overrides = {}) {
  const settings = await getSettings();
  const merged = { ...settings, ...overrides };
  const lang = merged.langMode === 'auto' ? detectLanguage(text) : merged.langMode;
  const langPack = await loadLangPack(lang);
  return humanize(text, {
    lang,
    profile: merged.profile,
    intensity: Number(merged.intensity),
    seed: typeof overrides.seed === 'number' ? overrides.seed : (Date.now() & 0xffff),
    cleanWatermarks: merged.cleanWatermarks,
    maxChangeRatio: merged.maxChangeRatio,
    langPack,
  });
}

async function opAnalyze(text, overrides = {}) {
  const settings = await getSettings();
  const merged = { ...settings, ...overrides };
  const lang = merged.langMode === 'auto' ? detectLanguage(text) : merged.langMode;
  const langPack = await loadLangPack(lang);
  const detector = new AIDetector();
  const detection = detector.detect(text, { lang, langPack });
  const wm = new WatermarkDetector(lang).detect(text);
  return {
    lang,
    detection,
    watermark: {
      hasWatermarks: wm.hasWatermarks,
      types: wm.watermarkTypes,
      removed: wm.charactersRemoved,
      kirchenbauerScore: wm.kirchenbauerScore,
    },
  };
}

async function opClean(text, overrides = {}) {
  const settings = await getSettings();
  const merged = { ...settings, ...overrides };
  const lang = merged.langMode === 'auto' ? detectLanguage(text) : merged.langMode;
  const report = new WatermarkDetector(lang).detect(text);
  return {
    lang,
    text: report.cleanedText,
    hasWatermarks: report.hasWatermarks,
    types: report.watermarkTypes,
    details: report.details,
    removed: report.charactersRemoved,
    homoglyphs: report.homoglyphsFound.length,
    zeroWidth: report.zeroWidthCount,
  };
}

// ── Message hub ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = (promise) => {
    promise
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // async
  };

  switch (message?.type) {
    case 'humanize':
      return respond(opHumanize(message.text, message.overrides));
    case 'analyze':
      return respond(opAnalyze(message.text, message.overrides));
    case 'clean':
      return respond(opClean(message.text, message.overrides));
    case 'detect-language':
      return respond(Promise.resolve(detectLanguage(message.text)));
    case 'get-settings':
      return respond(getSettings());
    case 'set-settings':
      return respond((async () => {
        const current = await getSettings();
        const next = { ...current, ...message.patch };
        await chrome.storage.sync.set({ settings: next });
        return next;
      })());
    case 'get-pack-index':
      return respond(loadPackIndex());
    default:
      return false;
  }
});

// ── Context menus ───────────────────────────────────────────────

const MENU_ITEMS = [
  { id: 'th-humanize', title: chrome.i18n.getMessage('menuHumanize'), contexts: ['selection'] },
  { id: 'th-check', title: chrome.i18n.getMessage('menuCheck'), contexts: ['selection'] },
  { id: 'th-clean', title: chrome.i18n.getMessage('menuClean'), contexts: ['selection'] },
  { id: 'th-workspace', title: chrome.i18n.getMessage('menuWorkspace'), contexts: ['page', 'action'] },
];

chrome.runtime.onInstalled.addListener(() => {
  for (const item of MENU_ITEMS) {
    chrome.contextMenus.create({
      id: item.id,
      title: item.title,
      contexts: item.contexts,
    });
  }
});

/**
 * Make sure the content script is alive in the tab, then send it an action.
 * Falls back to the workspace tab when injection is impossible
 * (chrome:// pages, Web Store, PDF viewer…).
 */
async function sendToContent(tab, action, selectionText) {
  if (!tab?.id) return;
  const message = { type: 'th-action', action, selectionText };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js'],
      });
      await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      openWorkspace(selectionText, action);
    }
  }
}

function openWorkspace(text = '', action = '') {
  const url = new URL(chrome.runtime.getURL('popup/popup.html'));
  url.searchParams.set('page', '1');
  if (text) url.searchParams.set('text', text.slice(0, 8000));
  if (action === 'check') url.searchParams.set('mode', 'check');
  chrome.tabs.create({ url: url.toString() });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const map = {
    'th-humanize': 'humanize',
    'th-check': 'check',
    'th-clean': 'clean',
  };
  if (info.menuItemId === 'th-workspace') {
    openWorkspace(info.selectionText || '');
    return;
  }
  const action = map[info.menuItemId];
  if (action) sendToContent(tab, action, info.selectionText || '');
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const map = {
    'humanize-selection': 'humanize',
    'check-selection': 'check',
  };
  const action = map[command];
  if (!action) return;
  const activeTab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  sendToContent(activeTab, action, '');
});
