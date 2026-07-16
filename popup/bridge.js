/**
 * Bridge — routes engine calls to the extension service worker when
 * running as an extension page, or straight to the engine when the
 * popup is opened as a plain web page (dev preview / web demo).
 * @module popup/bridge
 */

const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

let enginePromise = null;
const packCache = new Map();
let localSettings = {
  intensity: 60,
  profile: 'web',
  langMode: 'auto',
  cleanWatermarks: true,
  selectionBubble: true,
  theme: 'auto',
  maxChangeRatio: 0.4,
};

function loadEngine() {
  if (!enginePromise) enginePromise = import('../engine/index.js');
  return enginePromise;
}

async function loadPack(code) {
  if (packCache.has(code)) return packCache.get(code);
  try {
    const res = await fetch(`../data/langs/${code}.json`);
    if (!res.ok) throw new Error('no pack');
    const pack = await res.json();
    packCache.set(code, pack);
    return pack;
  } catch {
    packCache.set(code, null);
    return null;
  }
}

async function localHandle(message) {
  const engine = await loadEngine();
  const overrides = message.overrides || {};
  const merged = { ...localSettings, ...overrides };

  switch (message.type) {
    case 'humanize': {
      const lang = merged.langMode === 'auto'
        ? engine.detectLanguage(message.text) : merged.langMode;
      const langPack = await loadPack(lang);
      return engine.humanize(message.text, {
        lang,
        profile: merged.profile,
        intensity: Number(merged.intensity),
        seed: typeof overrides.seed === 'number' ? overrides.seed : (Date.now() & 0xffff),
        cleanWatermarks: merged.cleanWatermarks,
        maxChangeRatio: merged.maxChangeRatio,
        langPack,
      });
    }
    case 'analyze': {
      const lang = merged.langMode === 'auto'
        ? engine.detectLanguage(message.text) : merged.langMode;
      const langPack = await loadPack(lang);
      const detector = new engine.AIDetector();
      const detection = detector.detect(message.text, { lang, langPack });
      const wm = new engine.WatermarkDetector(lang).detect(message.text);
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
    case 'clean': {
      const lang = merged.langMode === 'auto'
        ? engine.detectLanguage(message.text) : merged.langMode;
      const report = new engine.WatermarkDetector(lang).detect(message.text);
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
    case 'tone': {
      const lang = merged.langMode === 'auto' ? engine.detectLanguage(message.text) : merged.langMode;
      const langPack = await loadPack(lang);
      return { lang, ...engine.analyzeTone(message.text, { lang, langPack }) };
    }
    case 'tone-adjust': {
      const lang = merged.langMode === 'auto' ? engine.detectLanguage(message.text) : merged.langMode;
      const langPack = await loadPack(lang);
      const r = engine.adjustTone(message.text, overrides.target || 'neutral', { lang, langPack, seed: overrides.seed || 0 });
      return { lang, text: r.text, changes: r.changes || [] };
    }
    case 'readability': {
      const lang = merged.langMode === 'auto' ? engine.detectLanguage(message.text) : merged.langMode;
      return { lang, ...engine.analyzeReadability(message.text, lang) };
    }
    case 'paraphrase': {
      const lang = merged.langMode === 'auto' ? engine.detectLanguage(message.text) : merged.langMode;
      const langPack = await loadPack(lang);
      const r = engine.paraphrase(message.text, { lang, langPack, intensity: Number(merged.intensity),
        seed: typeof overrides.seed === 'number' ? overrides.seed : (Date.now() & 0xffff) });
      return { lang, text: r.text, changes: r.changes || [] };
    }
    case 'stylometry': {
      const lang = merged.langMode === 'auto' ? engine.detectLanguage(message.text) : merged.langMode;
      const langPack = await loadPack(lang);
      return { lang, ...engine.fingerprint(message.text, { lang, langPack }) };
    }
    case 'classify': {
      const lang = merged.langMode === 'auto' ? engine.detectLanguage(message.text) : merged.langMode;
      const langPack = await loadPack(lang);
      return { lang, ...engine.classifyContent(message.text, { lang, langPack }) };
    }
    case 'scan-image': {
      if (!message.src?.startsWith('data:')) return { needsPermission: true };
      const comma = message.src.indexOf(',');
      const body = message.src.slice(comma + 1);
      const bytes = /;base64/i.test(message.src.slice(5, comma))
        ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(body));
      return engine.detectMediaWatermarks(bytes, {});
    }
    case 'detect-language': {
      return engine.detectLanguage(message.text);
    }
    case 'get-usage':
      return { events: {}, tools: {}, firstSeen: null };
    case 'track':
      return { ok: true };
    case 'get-settings':
      return { ...localSettings };
    case 'set-settings':
      localSettings = { ...localSettings, ...message.patch };
      try { localStorage.setItem('th-settings', JSON.stringify(localSettings)); } catch { /* ignore */ }
      return { ...localSettings };
    default:
      throw new Error(`Unknown message: ${message.type}`);
  }
}

if (!IS_EXTENSION) {
  try {
    const saved = localStorage.getItem('th-settings');
    if (saved) localSettings = { ...localSettings, ...JSON.parse(saved) };
  } catch { /* ignore */ }
}

/**
 * @param {object} message
 * @returns {Promise<any>}
 */
export function send(message) {
  if (IS_EXTENSION) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || 'Engine error'));
        resolve(res.data);
      });
    });
  }
  return localHandle(message);
}

/** i18n with graceful web fallback. */
import { FALLBACK_MESSAGES } from './messages.fallback.js';

let webLocale = 'en';
if (!IS_EXTENSION) {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (FALLBACK_MESSAGES[nav]) webLocale = nav;
  const forced = new URLSearchParams(location.search).get('uiLang');
  if (forced && FALLBACK_MESSAGES[forced]) webLocale = forced;
}

/**
 * @param {string} key
 * @param {string[]} [subs]
 */
export function t(key, subs) {
  let msg = '';
  if (IS_EXTENSION) {
    msg = chrome.i18n.getMessage(key, subs);
  } else {
    msg = FALLBACK_MESSAGES[webLocale]?.[key] ?? FALLBACK_MESSAGES.en[key] ?? '';
    if (msg && subs) subs.forEach((s, i) => { msg = msg.replace(`$${i + 1}`, s); });
  }
  return msg || key;
}

export { IS_EXTENSION };
