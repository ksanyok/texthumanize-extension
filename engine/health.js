/**
 * Content Health Score — composite content-quality grade (0-100).
 *
 * Ported from the TextHumanize library (`texthumanize/health_score.py`).
 * Combines several offline signals into one "health" score with a letter grade:
 *
 *   - readability      (weight 0.20) — reuses {@link analyzeReadability}
 *   - grammar          (weight 0.25) — surface-mechanics heuristic
 *   - uniqueness       (weight 0.20) — reuses {@link uniquenessScore}
 *   - ai_naturalness   (weight 0.20) — reuses {@link detectAi}: 100 - aiProbability*100
 *   - diversity        (weight 0.15) — lexical + sentence-length variety
 *
 * The composite formula (weight re-normalization over the components that could
 * be computed) and the letter-grade thresholds match the Python original.
 * Two Python components have no offline JS equivalent and were adapted:
 * `grammar` (Python called an external checker) is a rule-based mechanics proxy,
 * and `coherence` was replaced by `diversity` (разнообразие) at the same 0.15
 * weight — both fully offline.
 *
 * Pure ES module, zero dependencies (beyond sibling engine modules).
 * @module engine/health
 */

import { splitSentences } from './util.js';
import { analyzeReadability } from './readability.js';
import { detectAi } from './detector.js';
import { uniquenessScore } from './uniqueness.js';

/** @param {number} x @returns {number} finite value or 0. */
const fin = (x) => (Number.isFinite(x) ? x : 0);

/** @param {number} x @param {number} [d] @returns {number} rounded to d decimals. */
const round = (x, d = 1) => {
  const f = 10 ** d;
  return Math.round(fin(x) * f) / f;
};

/** @param {number} x @returns {number} clamped to 0..100. */
const clamp100 = (x) => Math.min(100, Math.max(0, fin(x)));

/**
 * Map a composite 0-100 score to a letter grade (same bands as health_score.py).
 * @param {number} score
 * @returns {'A+'|'A'|'B'|'C'|'D'|'F'}
 */
export function gradeFromScore(score) {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Map a readability grade level to a 0-100 score (ideal band 8..12).
 * Mirrors the readability mapping in health_score.py.
 * @param {number} gradeLevel
 * @returns {number} 0..100
 */
function readabilityToScore(gradeLevel) {
  const gl = fin(gradeLevel);
  if (gl >= 8 && gl <= 12) return 100;
  if (gl < 8) return Math.max(50, 100 - (8 - gl) * 10);
  return Math.max(30, 100 - (gl - 12) * 8);
}

/**
 * Surface-mechanics grammar proxy (0-100). Not a full grammar engine — it
 * penalizes common, language-agnostic surface errors (mis-capitalized sentence
 * starts, double spaces, space-before-punctuation, repeated punctuation,
 * doubled words, unbalanced brackets). Clean prose scores ~100.
 * @param {string} text
 * @param {string} lang
 * @returns {number} 0..100
 */
function grammarScore(text, lang = 'en') {
  const src = String(text || '');
  if (!src.trim()) return 100;

  const sentences = splitSentences(src);
  const words = src.match(/[\p{L}\p{N}]+/gu) || [];
  let penalty = 0;

  // Sentence should start with an uppercase letter (only for cased scripts).
  if (sentences.length) {
    let badStart = 0;
    for (const s of sentences) {
      const first = (s.match(/\p{L}/u) || [])[0];
      // Cased script → lower- and upper-case differ; flag when first isn't upper.
      if (first && first.toLowerCase() !== first.toUpperCase() && first !== first.toUpperCase()) {
        badStart++;
      }
    }
    penalty += (badStart / sentences.length) * 25;
  }

  // Double (or more) spaces.
  penalty += Math.min((src.match(/ {2,}/g) || []).length * 2, 10);

  // Whitespace before sentence punctuation (" ,", " .").
  penalty += Math.min((src.match(/\s[,.;:!?]/g) || []).length * 2, 10);

  // Repeated sentence punctuation (",,", "..", ";;") — ellipsis/interrobang excluded.
  penalty += Math.min((src.match(/([,;:])\1+/g) || []).length * 3, 12);

  // Doubled consecutive words ("the the").
  let doubled = 0;
  const low = words.map((w) => w.toLowerCase());
  for (let i = 1; i < low.length; i++) {
    if (low[i] === low[i - 1] && low[i].length > 1) doubled++;
  }
  penalty += Math.min(doubled * 3, 15);

  // Unbalanced brackets.
  const opens = (src.match(/[([{]/g) || []).length;
  const closes = (src.match(/[)\]}]/g) || []).length;
  penalty += Math.min(Math.abs(opens - closes) * 3, 10);

  // English-only: lone lowercase "i" pronoun.
  if (lang === 'en') {
    penalty += Math.min((src.match(/(?:^|\s)i(?=$|[\s',.!?])/g) || []).length * 2, 10);
  }

  return clamp100(100 - penalty);
}

/**
 * Lexical + structural diversity proxy (0-100) — the offline stand-in for the
 * Python `coherence`/`vocabulary` signal. Blends type-token ratio with the
 * coefficient of variation of sentence lengths (both markers of human variety).
 * @param {string} text
 * @param {string} lang
 * @returns {number} 0..100
 */
function diversityScore(text, lang = 'en') {
  const src = String(text || '');
  const words = src.match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length === 0) return 100;

  const ttr = new Set(words.map((w) => w.toLowerCase())).size / words.length;

  let cv = 0;
  const sentences = splitSentences(src);
  if (sentences.length >= 2) {
    const lens = sentences.map((s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    if (mean > 0) {
      const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
      cv = Math.sqrt(variance) / mean;
    }
  }

  // TTR up to 0.7 → full 60 pts; sentence-length CV up to 0.5 → full 40 pts.
  const ttrPart = Math.min(ttr / 0.7, 1) * 60;
  const cvPart = Math.min(cv / 0.5, 1) * 40;
  return clamp100(ttrPart + cvPart);
}

/**
 * @typedef {object} HealthComponent
 * @property {string} name    Component id ("readability", "grammar", …).
 * @property {number} score   0-100 sub-score.
 * @property {number} weight  Weight in the composite (before re-normalization).
 * @property {string} details Short human-readable note.
 */

/**
 * @typedef {object} HealthReport
 * @property {number} score      Composite 0-100 (weight-normalized over available components).
 * @property {string} grade      Letter grade "A+".."F".
 * @property {HealthComponent[]} components
 * @property {Record<string, number>} summary  Map of component name → score.
 */

/**
 * Compute the composite content-health score.
 *
 * Each component is computed defensively; any that throws is skipped and its
 * weight is excluded from the re-normalized composite (matching the try/except
 * behavior of health_score.py). If every component fails, the composite falls
 * back to 50.
 *
 * @param {string} text
 * @param {{lang?: string, langPack?: object|null}} [options]
 * @returns {HealthReport} every numeric field finite for empty/short input
 */
export function contentHealth(text, { lang = 'en', langPack = null } = {}) {
  const src = String(text ?? '');
  /** @type {HealthComponent[]} */
  const components = [];
  let totalWeight = 0;

  const add = (name, weight, compute) => {
    try {
      const { score, details } = compute();
      components.push({ name, score: round(clamp100(score)), weight, details: details || '' });
      totalWeight += weight;
    } catch {
      // Skip this component — its weight drops out of the composite.
    }
  };

  // ── Readability (0.20) ──
  add('readability', 0.2, () => {
    const rd = analyzeReadability(src, lang);
    return {
      score: readabilityToScore(rd.gradeLevel),
      details: `grade_level=${round(rd.gradeLevel)}`,
    };
  });

  // ── Grammar (0.25) — surface-mechanics heuristic ──
  add('grammar', 0.25, () => ({
    score: grammarScore(src, lang),
    details: 'surface mechanics heuristic',
  }));

  // ── Uniqueness (0.20) ──
  add('uniqueness', 0.2, () => {
    const uq = uniquenessScore(src, { lang, langPack });
    return {
      score: uq.score * 100,
      details: `ngram_diversity=${uq.ngramDiversity}`,
    };
  });

  // ── AI naturalness (0.20) — lower AI probability = healthier ──
  add('ai_naturalness', 0.2, () => {
    const ai = detectAi(src, { lang, langPack });
    // Detector returns 0.0 + "unknown" for too-short input; treat as neutral 0.5.
    const aiProb = ai.verdict === 'unknown' ? 0.5 : fin(ai.aiProbability);
    return {
      score: (1 - aiProb) * 100,
      details: `verdict=${ai.verdict}, ai_prob=${round(aiProb, 2)}`,
    };
  });

  // ── Diversity (0.15) — lexical + sentence-length variety ──
  add('diversity', 0.15, () => ({
    score: diversityScore(src, lang),
    details: 'lexical + sentence-length variety',
  }));

  // ── Composite (re-normalized over available weights) ──
  let composite;
  if (totalWeight > 0) {
    composite = components.reduce((sum, c) => sum + c.score * (c.weight / totalWeight), 0);
  } else {
    composite = 50;
  }
  composite = round(clamp100(composite));

  /** @type {Record<string, number>} */
  const summary = {};
  for (const c of components) summary[c.name] = c.score;

  return {
    score: composite,
    grade: gradeFromScore(composite),
    components,
    summary,
  };
}

export default { contentHealth, gradeFromScore };
