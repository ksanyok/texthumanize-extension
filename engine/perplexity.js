/**
 * Text perplexity & predictability — statistical, no-ML estimation.
 *
 * Ported from the TextHumanize library (`texthumanize/perplexity.py`, with
 * ideas from `perplexity_v2.py`). The intuition: AI text is abnormally
 * predictable (low perplexity, uniform sentence lengths); human text is more
 * perplex and "bursty".
 *
 * Signals (all derived from the text itself — no background corpus, no network):
 *   - `perplexity`     — character 4-gram self-perplexity (leave-in Laplace).
 *   - `burstiness`     — coefficient of variation of sentence lengths.
 *   - `predictability` — 0..1 composite (1 = maximally predictable / AI-like),
 *                        blending char perplexity, word entropy, bigram repeat,
 *                        type-token ratio and hapax ratio (perplexity.py logic).
 *   - `perSentence`    — per-sentence character perplexity.
 *
 * Pure ES module, zero dependencies (beyond sibling engine util).
 * @module engine/perplexity
 */

import { splitSentences } from './util.js';

/** @param {number} x @returns {number} finite value or 0. */
const fin = (x) => (Number.isFinite(x) ? x : 0);

/** @param {number} x @param {number} [d] @returns {number} rounded to d decimals. */
const round = (x, d = 4) => {
  const f = 10 ** d;
  return Math.round(fin(x) * f) / f;
};

/**
 * Lowercase + collapse whitespace (matches perplexity.py `_normalize`).
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Word count of a sentence/string (Unicode-aware).
 * @param {string} text
 * @returns {string[]}
 */
function words(text) {
  return normalize(text).match(/[\p{L}\p{N}]+/gu) || [];
}

/**
 * Character-level self-perplexity via n-gram cross-entropy with Laplace
 * smoothing (port of perplexity.py `_calc_char_perplexity`). Operates on the
 * normalized string (spaces included). Low = predictable.
 * @param {string} text  normalized text
 * @param {number} [n]   char n-gram size (default 4)
 * @returns {number} perplexity (>= 0; 0 when text too short)
 */
function charPerplexity(text, n = 4) {
  if (text.length < n + 1) return 0;

  const ngramCounts = new Map();
  const contextCounts = new Map();
  for (let i = 0; i <= text.length - n; i++) {
    const gram = text.slice(i, i + n);
    const ctx = text.slice(i, i + n - 1);
    ngramCounts.set(gram, (ngramCounts.get(gram) || 0) + 1);
    contextCounts.set(ctx, (contextCounts.get(ctx) || 0) + 1);
  }
  if (ngramCounts.size === 0) return 0;

  const vocabSize = new Set(text).size;
  let totalLogProb = 0;
  let count = 0;
  for (const [gram, freq] of ngramCounts) {
    const ctx = gram.slice(0, -1);
    const ctxFreq = contextCounts.get(ctx) || 0;
    if (ctxFreq > 0) {
      const prob = (freq + 1) / (ctxFreq + vocabSize);
      totalLogProb += freq * Math.log2(prob);
      count += freq;
    }
  }
  if (count === 0) return 0;

  const entropy = -totalLogProb / count;
  return 2 ** entropy;
}

/**
 * Shannon entropy over the word distribution (bits/word).
 * @param {string[]} tokens
 * @returns {number}
 */
function wordEntropy(tokens) {
  if (tokens.length === 0) return 0;
  const total = tokens.length;
  const freqs = new Map();
  for (const w of tokens) freqs.set(w, (freqs.get(w) || 0) + 1);
  let entropy = 0;
  for (const c of freqs.values()) {
    const p = c / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Word-bigram repeat ratio (0 = every bigram unique, 1 = all repeat).
 * @param {string[]} tokens
 * @returns {number} 0..1
 */
function bigramPredictability(tokens) {
  if (tokens.length < 3) return 0;
  const bigrams = [];
  for (let i = 0; i < tokens.length - 1; i++) bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  const total = bigrams.length;
  if (total === 0) return 0;
  return 1 - new Set(bigrams).size / total;
}

/**
 * Mean Segmental Type-Token Ratio (100-word segments) — length-robust TTR.
 * Port of perplexity.py `_calc_ttr`.
 * @param {string[]} tokens
 * @returns {number} 0..1
 */
function meanSegmentalTtr(tokens) {
  if (tokens.length === 0) return 0;
  const seg = 100;
  if (tokens.length < seg) return new Set(tokens).size / tokens.length;
  const ttrs = [];
  for (let i = 0; i + seg <= tokens.length; i += seg) {
    const segment = tokens.slice(i, i + seg);
    ttrs.push(new Set(segment).size / segment.length);
  }
  return ttrs.length ? ttrs.reduce((a, b) => a + b, 0) / ttrs.length : 0;
}

/**
 * Hapax ratio — share of word types occurring exactly once.
 * @param {string[]} tokens
 * @returns {number} 0..1
 */
function hapaxRatio(tokens) {
  if (tokens.length === 0) return 0;
  const freqs = new Map();
  for (const w of tokens) freqs.set(w, (freqs.get(w) || 0) + 1);
  let hapax = 0;
  for (const c of freqs.values()) if (c === 1) hapax++;
  return freqs.size ? hapax / freqs.size : 0;
}

/**
 * Composite predictability score, 0-100 (100 = maximally predictable / AI-like).
 * Port of perplexity.py `_calc_predictability_score`.
 * @param {{charPerplexity:number, wordEntropy:number, bigramPredictability:number, ttr:number, hapaxRatio:number}} m
 * @returns {number} 0..100
 */
function predictabilityScore(m) {
  let score = 0;

  // 1. Character perplexity: low (<4) → AI, high (>12) → human.
  if (m.charPerplexity > 0) {
    if (m.charPerplexity < 4) score += 25;
    else if (m.charPerplexity < 7) score += 15;
    else if (m.charPerplexity < 12) score += 5;
  }

  // 2. Word entropy: low → AI.
  if (m.wordEntropy < 5) score += 20;
  else if (m.wordEntropy < 7) score += 10;
  else if (m.wordEntropy < 8) score += 5;

  // 3. Bigram repetition: high → AI.
  score += m.bigramPredictability * 25;

  // 4. TTR: low → AI.
  if (m.ttr < 0.4) score += 15;
  else if (m.ttr < 0.55) score += 8;
  else if (m.ttr < 0.65) score += 3;

  // 5. Hapax ratio: low → AI.
  if (m.hapaxRatio < 0.4) score += 15;
  else if (m.hapaxRatio < 0.55) score += 8;
  else if (m.hapaxRatio < 0.65) score += 3;

  return Math.min(score, 100);
}

/**
 * Coefficient of variation of sentence lengths (in words) — "burstiness".
 * 0 when fewer than two measurable sentences.
 * @param {string[]} sentences
 * @returns {number} >= 0
 */
function sentenceLengthCv(sentences) {
  const lens = sentences.map((s) => words(s).length).filter((l) => l > 0);
  if (lens.length < 2) return 0;
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  if (mean <= 0) return 0;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  return Math.sqrt(variance) / mean;
}

/**
 * @typedef {object} PerplexityResult
 * @property {number} perplexity     Character 4-gram self-perplexity (>= 0).
 * @property {number} burstiness     Coefficient of variation of sentence lengths (>= 0).
 * @property {number} predictability 0..1 composite (1 = maximally predictable / AI-like).
 * @property {{text: string, perplexity: number}[]} perSentence Per-sentence char perplexity.
 */

/**
 * Estimate text perplexity, burstiness and predictability (no ML).
 *
 * @param {string} text
 * @param {{lang?: string, langPack?: object|null}} [options]
 *   Accepted for API symmetry; the estimator is self-referential and
 *   language-agnostic, so both are currently unused (degrades gracefully when null).
 * @returns {PerplexityResult} every numeric field finite for empty/short input
 */
export function perplexityScore(text, { lang, langPack } = {}) {
  const src = String(text ?? '');
  const clean = normalize(src);
  const tokens = clean.match(/[\p{L}\p{N}]+/gu) || [];

  if (tokens.length === 0) {
    return { perplexity: 0, burstiness: 0, predictability: 0, perSentence: [] };
  }

  const cpp = charPerplexity(clean, 4);

  // Predictability needs enough words to be meaningful (matches perplexity.py's
  // <10-word short-circuit); below that we report a neutral 0 (unpredictable).
  let predictability = 0;
  if (tokens.length >= 10) {
    predictability = predictabilityScore({
      charPerplexity: cpp,
      wordEntropy: wordEntropy(tokens),
      bigramPredictability: bigramPredictability(tokens),
      ttr: meanSegmentalTtr(tokens),
      hapaxRatio: hapaxRatio(tokens),
    }) / 100;
  }

  const allSentences = splitSentences(src);
  const burstiness = sentenceLengthCv(allSentences);

  const perSentence = allSentences
    .filter((s) => s.length > 10)
    .map((s) => ({
      text: s.slice(0, 200),
      perplexity: round(charPerplexity(normalize(s), 4)),
    }));

  return {
    perplexity: round(cpp),
    burstiness: round(burstiness),
    predictability: round(Math.min(1, Math.max(0, predictability))),
    perSentence,
  };
}

export default { perplexityScore };
