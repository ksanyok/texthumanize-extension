/**
 * Tool registry + tier gating (single source of truth).
 *
 * Monetization is scaffolded but OFF for v2: every tool is unlocked.
 * Flip MONETIZATION_ENABLED to true (and ship a license check) to gate
 * `tier: 'pro'` tools — the UI already renders PRO badges from this table.
 *
 * @module engine/entitlements
 */

/** Master switch. When false, isUnlocked() always returns true. */
export const MONETIZATION_ENABLED = false;

/**
 * @typedef {Object} ToolDef
 * @property {string} id
 * @property {'free'|'pro'} tier
 * @property {string} icon        emoji glyph used across the UI
 * @property {string} i18n        i18n key for the label
 * @property {'text'|'analysis'|'image'} kind
 * @property {boolean} [inline]   offered inside the in-page editor chip
 * @property {boolean} [transforms] mutates text (vs read-only analysis)
 */

/** @type {ToolDef[]} */
export const TOOLS = [
  { id: 'humanize', tier: 'free', icon: '✨', i18n: 'actHumanize', kind: 'text', inline: true, transforms: true },
  { id: 'check', tier: 'free', icon: '🔍', i18n: 'actCheck', kind: 'analysis', inline: true },
  { id: 'clean', tier: 'free', icon: '🧹', i18n: 'actClean', kind: 'text', inline: true, transforms: true },
  { id: 'tone', tier: 'free', icon: '🎭', i18n: 'actTone', kind: 'analysis', inline: true },
  { id: 'readability', tier: 'free', icon: '📖', i18n: 'actReadability', kind: 'analysis' },
  { id: 'paraphrase', tier: 'pro', icon: '🔀', i18n: 'actParaphrase', kind: 'text', inline: true, transforms: true },
  { id: 'stylometry', tier: 'pro', icon: '🧬', i18n: 'actStylometry', kind: 'analysis' },
  { id: 'image', tier: 'pro', icon: '🖼️', i18n: 'actImage', kind: 'image' },
];

const BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

/** @param {string} id */
export function getTool(id) {
  return BY_ID[id] || null;
}

/**
 * Is a tool available to the current user?
 * @param {string} id
 * @param {{pro?: boolean}} [entitlement] current entitlement state
 */
export function isUnlocked(id, entitlement = {}) {
  if (!MONETIZATION_ENABLED) return true;
  const tool = BY_ID[id];
  if (!tool) return false;
  if (tool.tier === 'free') return true;
  return !!entitlement.pro;
}

/** Tools offered inside the in-page editor chip, in display order. */
export function inlineTools() {
  return TOOLS.filter((t) => t.inline);
}
