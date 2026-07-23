/**
 * Module registry + per-module gating (single source of truth for v3).
 *
 * Every tool the extension exposes is a MODULE here. Monetization is
 * scaffolded but OFF: all modules are unlocked. To monetize later, set a
 * module's `tier` to 'pro', flip MONETIZATION_ENABLED, and ship a license
 * check — the popup and panel already render lock badges from this table.
 *
 * @module engine/entitlements
 */

/** Master switch. When false, isUnlocked() always returns true. */
export const MONETIZATION_ENABLED = false;

/**
 * @typedef {Object} Module
 * @property {string} id
 * @property {'analyze'|'transform'|'media'} category
 * @property {'free'|'pro'} tier
 * @property {string} icon        emoji glyph
 * @property {string} i18n        label i18n key
 * @property {string} op          service-worker message type it invokes
 * @property {boolean} [transforms] mutates text (offers Replace)
 * @property {boolean} [inline]   offered on the in-page hover panel / editor chip
 * @property {Record<string,string|number|boolean>} [overrides] fixed overrides for op
 */

/** @type {Module[]} */
export const MODULES = [
  // ── Analyze ──
  { id: 'detect', category: 'analyze', tier: 'free', icon: '🔍', i18n: 'actCheck', desc: 'descCheck', op: 'analyze', inline: true },
  { id: 'readability', category: 'analyze', tier: 'free', icon: '📖', i18n: 'actReadability', desc: 'descReadability', op: 'readability' },
  { id: 'tone', category: 'analyze', tier: 'free', icon: '🎭', i18n: 'actTone', desc: 'descTone', op: 'tone', inline: true },
  { id: 'sentiment', category: 'analyze', tier: 'free', icon: '💚', i18n: 'actSentiment', desc: 'descSentiment', op: 'sentiment' },
  { id: 'health', category: 'analyze', tier: 'free', icon: '❤️', i18n: 'actHealth', desc: 'descHealth', op: 'health' },
  { id: 'uniqueness', category: 'analyze', tier: 'free', icon: '💎', i18n: 'actUniqueness', desc: 'descUniqueness', op: 'uniqueness' },
  { id: 'perplexity', category: 'analyze', tier: 'free', icon: '🌀', i18n: 'actPerplexity', desc: 'descPerplexity', op: 'perplexity' },
  { id: 'stylometry', category: 'analyze', tier: 'free', icon: '🧬', i18n: 'actStylometry', desc: 'descStylometry', op: 'stylometry' },
  { id: 'keywords', category: 'analyze', tier: 'free', icon: '🏷️', i18n: 'actKeywords', desc: 'descKeywords', op: 'keywords' },
  { id: 'statistics', category: 'analyze', tier: 'free', icon: '📊', i18n: 'actStatistics', desc: 'descStatistics', op: 'statistics' },

  // ── Transform ──
  { id: 'humanize', category: 'transform', tier: 'free', icon: '✨', i18n: 'actHumanize', desc: 'descHumanize', op: 'humanize', transforms: true, inline: true },
  { id: 'paraphrase', category: 'transform', tier: 'free', icon: '🔀', i18n: 'actParaphrase', desc: 'descParaphrase', op: 'paraphrase', transforms: true, inline: true },
  { id: 'summarize', category: 'transform', tier: 'free', icon: '📝', i18n: 'actSummarize', desc: 'descSummarize', op: 'summarize', transforms: true },
  { id: 'formalize', category: 'transform', tier: 'free', icon: '👔', i18n: 'actFormalize', desc: 'descFormalize', op: 'tone-adjust', transforms: true, overrides: { target: 'formal' } },
  { id: 'simplify', category: 'transform', tier: 'free', icon: '🎈', i18n: 'actSimplify', desc: 'descSimplify', op: 'tone-adjust', transforms: true, overrides: { target: 'casual' } },
  { id: 'clean', category: 'transform', tier: 'free', icon: '🧹', i18n: 'actClean', desc: 'descClean', op: 'clean', transforms: true, inline: true },

  // ── Media ──
  { id: 'image', category: 'media', tier: 'free', icon: '🖼️', i18n: 'actImage', desc: 'descImage', op: 'detect-media' },
  { id: 'mediaClean', category: 'media', tier: 'free', icon: '🧼', i18n: 'actMediaClean', desc: 'descMediaClean', op: 'clean-media', transforms: true },
];

const BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m]));
const BY_OP = Object.fromEntries(MODULES.map((m) => [m.op, m]));

/** @param {string} id */
export function getModule(id) { return BY_ID[id] || null; }

/** @param {string} op */
export function moduleForOp(op) { return BY_OP[op] || null; }

/** @param {'analyze'|'transform'|'media'} category */
export function modulesIn(category) { return MODULES.filter((m) => m.category === category); }

/** Modules offered on the in-page hover panel / editor chip. */
export function inlineModules() { return MODULES.filter((m) => m.inline); }

/**
 * Is a module available to the current user?
 * @param {string} id
 * @param {{pro?: boolean}} [entitlement]
 */
export function isUnlocked(id, entitlement = {}) {
  if (!MONETIZATION_ENABLED) return true;
  const m = BY_ID[id];
  if (!m) return false;
  return m.tier === 'free' || !!entitlement.pro;
}

// Back-compat aliases (v2 used TOOLS / getTool / inlineTools).
export const TOOLS = MODULES;
export const getTool = getModule;
export const inlineTools = inlineModules;
