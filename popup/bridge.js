/**
 * Bridge — the popup/workspace runs all *compute* tools locally (direct
 * engine import, no message round-trips, works identically as an extension
 * page or a plain web preview). Settings, telemetry and page scanning are
 * routed to the service worker when running as an extension.
 * @module popup/bridge
 */

import { FALLBACK_MESSAGES } from './messages.fallback.js';

const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

// Ops computed locally in this page (fast, no serialization limits).
const COMPUTE_OPS = new Set([
  'humanize', 'analyze', 'clean', 'tone', 'tone-adjust', 'readability',
  'paraphrase', 'stylometry', 'classify', 'heatmap', 'detect-language',
  'detect-media', 'clean-media',
  'health', 'uniqueness', 'perplexity', 'sentiment', 'statistics', 'keywords', 'summarize',
]);

let enginePromise = null;
const packCache = new Map();
let localSettings = {
  intensity: 65,
  langMode: 'auto',
  cleanWatermarks: true,
  selectionBubble: true,
  editorChip: true,
  imageHover: false,
  effects: true,
  telemetry: true,
};

function loadEngine() {
  if (!enginePromise) enginePromise = import('../engine/index.js');
  return enginePromise;
}

function assetUrl(path) {
  return IS_EXTENSION ? chrome.runtime.getURL(path) : `../${path}`;
}

async function loadPack(code) {
  if (packCache.has(code)) return packCache.get(code);
  try {
    const res = await fetch(assetUrl(`data/langs/${code}.json`));
    const pack = res.ok ? await res.json() : null;
    packCache.set(code, pack);
    return pack;
  } catch { packCache.set(code, null); return null; }
}

async function getSettings() {
  if (IS_EXTENSION) {
    return sendToWorker({ type: 'get-settings' }).catch(() => ({ ...localSettings }));
  }
  return { ...localSettings };
}

async function resolve(text, overrides) {
  const engine = await loadEngine();
  const s = await getSettings();
  const merged = { ...s, ...overrides };
  const lang = (merged.langMode && merged.langMode !== 'auto') ? merged.langMode : engine.detectLanguage(text);
  const langPack = await loadPack(lang);
  return { engine, merged, lang, langPack };
}

/** @param {object} message */
async function computeLocally(message) {
  const o = message.overrides || {};
  switch (message.type) {
    case 'detect-language': {
      const engine = await loadEngine();
      return message.text ? engine.detectLanguage(message.text) : 'en';
    }
    case 'humanize': {
      const { engine, merged, lang, langPack } = await resolve(message.text, o);
      return engine.humanize(message.text, {
        lang, intensity: Number(merged.intensity), profile: 'web',
        seed: typeof o.seed === 'number' ? o.seed : (Date.now() & 0xffff),
        cleanWatermarks: merged.cleanWatermarks, langPack,
      });
    }
    case 'analyze': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      const detection = new engine.AIDetector().detect(message.text, { lang, langPack });
      const wm = new engine.WatermarkDetector(lang).detect(message.text);
      return { lang, detection, watermark: { hasWatermarks: wm.hasWatermarks, types: wm.watermarkTypes, removed: wm.charactersRemoved } };
    }
    case 'heatmap': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      const doc = new engine.AIDetector().detect(message.text, { lang, langPack });
      const overallProb = doc.verdict === 'unknown' ? 0.5 : doc.aiProbability;
      const hm = engine.sentenceScores(message.text, { lang, langPack, overall: overallProb });
      return { lang, sentences: hm.sentences.slice(0, 120), overall: { aiProbability: doc.aiProbability, verdict: doc.verdict } };
    }
    case 'clean': {
      const { engine, lang } = await resolve(message.text, o);
      const r = new engine.WatermarkDetector(lang).detect(message.text);
      return { lang, text: r.cleanedText, hasWatermarks: r.hasWatermarks, types: r.watermarkTypes, details: r.details, removed: r.charactersRemoved };
    }
    case 'tone': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      return { lang, ...engine.analyzeTone(message.text, { lang, langPack }) };
    }
    case 'tone-adjust': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      const r = engine.adjustTone(message.text, o.target || 'neutral', { lang, langPack, seed: o.seed || 0 });
      return { lang, text: r.text, changes: r.changes || [] };
    }
    case 'readability': {
      const { engine, lang } = await resolve(message.text, o);
      return { lang, ...engine.analyzeReadability(message.text, lang) };
    }
    case 'paraphrase': {
      const { engine, merged, lang, langPack } = await resolve(message.text, o);
      const r = engine.paraphrase(message.text, { lang, langPack, intensity: Number(merged.intensity), seed: typeof o.seed === 'number' ? o.seed : (Date.now() & 0xffff) });
      return { lang, text: r.text, changes: r.changes || [] };
    }
    case 'stylometry': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      return { lang, ...engine.fingerprint(message.text, { lang, langPack }) };
    }
    case 'classify': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      return { lang, ...engine.classifyContent(message.text, { lang, langPack }) };
    }
    case 'health': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      return { lang, ...engine.contentHealth(message.text, { lang, langPack }) };
    }
    case 'uniqueness': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      return { lang, ...engine.uniquenessScore(message.text, { lang, langPack }) };
    }
    case 'perplexity': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      return { lang, ...engine.perplexityScore(message.text, { lang, langPack }) };
    }
    case 'sentiment': {
      const { engine, lang } = await resolve(message.text, o);
      return { lang, ...engine.analyzeSentiment(message.text, { lang }) };
    }
    case 'statistics': {
      const engine = await loadEngine();
      return engine.textStatistics(message.text);
    }
    case 'keywords': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      return { lang, ...engine.extractKeywords(message.text, { lang, langPack }) };
    }
    case 'summarize': {
      const { engine, lang, langPack } = await resolve(message.text, o);
      return { lang, ...engine.summarize(message.text, { lang, langPack, sentences: o.sentences || 3 }) };
    }
    case 'detect-media': {
      const engine = await loadEngine();
      return engine.detectMediaWatermarks(message.bytes, {});
    }
    case 'clean-media': {
      const engine = await loadEngine();
      return engine.cleanMediaWatermarks(message.bytes);
    }
    default:
      throw new Error(`unknown compute op ${message.type}`);
  }
}

function sendToWorker(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error || 'Engine error'));
      resolve(res.data);
    });
  });
}

/**
 * @param {object} message
 * @returns {Promise<any>}
 */
export function send(message) {
  if (COMPUTE_OPS.has(message.type)) return computeLocally(message);

  if (IS_EXTENSION) return sendToWorker(message);

  // Web-preview fallbacks for non-compute ops.
  switch (message.type) {
    case 'get-settings': return Promise.resolve({ ...localSettings });
    case 'set-settings':
      localSettings = { ...localSettings, ...message.patch };
      try { localStorage.setItem('th-settings', JSON.stringify(localSettings)); } catch { /* */ }
      return Promise.resolve({ ...localSettings });
    case 'get-usage': return Promise.resolve({ events: {}, tools: {} });
    case 'track': return Promise.resolve({ ok: true });
    case 'scan-page': return Promise.resolve({ error: 'page scan needs the extension' });
    default: return Promise.reject(new Error(`unknown op ${message.type}`));
  }
}

if (!IS_EXTENSION) {
  try {
    const saved = localStorage.getItem('th-settings');
    if (saved) localSettings = { ...localSettings, ...JSON.parse(saved) };
  } catch { /* */ }
}

// ── i18n ────────────────────────────────────────────────────────
let webLocale = 'en';
if (!IS_EXTENSION) {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (FALLBACK_MESSAGES[nav]) webLocale = nav;
  const forced = new URLSearchParams(location.search).get('uiLang');
  if (forced && FALLBACK_MESSAGES[forced]) webLocale = forced;
}

/**
 * Look up a UI string.
 *
 * chrome.i18n.getMessage throws "No matching signature" on a non-string key or
 * non-string substitutions, and an optional chain upstream (`t(mod?.i18n)`)
 * easily hands it `undefined`. The web fallback path silently tolerates that,
 * so such a call only ever blows up in a real extension — which is how a broken
 * Humanize button reached store review. Normalize the arguments here so a bad
 * key degrades to a missing string instead of taking a feature down.
 *
 * @param {string} key @param {(string|number)[]} [subs]
 */
export function t(key, subs) {
  if (typeof key !== 'string' || !key) return '';
  const args = Array.isArray(subs) ? subs.map((s) => String(s)) : undefined;
  let msg = '';
  if (IS_EXTENSION) {
    try { msg = args ? chrome.i18n.getMessage(key, args) : chrome.i18n.getMessage(key); } catch { msg = ''; }
  } else {
    msg = FALLBACK_MESSAGES[webLocale]?.[key] ?? FALLBACK_MESSAGES.en[key] ?? '';
    if (msg && args) args.forEach((s, i) => { msg = msg.replace(`$${i + 1}`, s); });
  }
  return msg || key;
}

export { IS_EXTENSION };
