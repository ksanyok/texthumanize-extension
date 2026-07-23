/**
 * Text uniqueness & similarity — offline word n-gram analysis.
 *
 * Ported from the TextHumanize library (`texthumanize/uniqueness.py` +
 * `texthumanize/plagiarism.py`). Measures how much of a text is built from
 * distinct word n-grams (internal originality) and how similar two texts are
 * to each other (Jaccard overlap of their n-gram sets).
 *
 * Fully offline — no network, no external plagiarism services. All scoring is
 * derived from the text(s) themselves.
 *
 * Pure ES module, zero dependencies.
 * @module engine/uniqueness
 */

/** @param {number} x @returns {number} finite value or 0. */
const fin = (x) => (Number.isFinite(x) ? x : 0);

/** @param {number} x @param {number} [d] @returns {number} rounded to d decimals. */
const round = (x, d = 4) => {
  const f = 10 ** d;
  return Math.round(fin(x) * f) / f;
};

/**
 * Unicode-aware word tokenizer — the analog of Python's `re.findall(r"\b\w+\b", text.lower())`,
 * but covering every script (Cyrillic, CJK letters, etc.), not just ASCII.
 * @param {string} text
 * @returns {string[]} lowercased word tokens
 */
function tokenize(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
}

/**
 * Build word n-grams as space-joined strings.
 * @param {string[]} tokens
 * @param {number} n
 * @returns {string[]}
 */
function ngrams(tokens, n) {
  if (n <= 0 || tokens.length < n) return [];
  const out = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

/**
 * Fraction of distinct n-grams (1.0 when there are none — a trivially unique text).
 * @param {string[]} grams
 * @returns {number} 0..1
 */
function uniqueRatio(grams) {
  if (grams.length === 0) return 1;
  return new Set(grams).size / grams.length;
}

/**
 * Repetition ratio of tokens: extra (repeated) occurrences / total (0 = no repeats).
 * @param {string[]} tokens
 * @returns {number} 0..1
 */
function repetitionScore(tokens) {
  if (tokens.length === 0) return 0;
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  let repeated = 0;
  for (const c of counts.values()) if (c > 1) repeated += c - 1;
  return repeated / tokens.length;
}

/**
 * @typedef {object} UniquenessResult
 * @property {number} score          Composite uniqueness, 0..1 (1 = fully unique).
 * @property {number} ngramDiversity Distinct/total n-grams at the requested `n`, 0..1.
 * @property {{ngram: string, count: number}[]} repeatedNgrams
 *   n-grams (at `n`) occurring more than once, sorted by count desc (top 25).
 * @property {number} totalNgrams    Total n-gram count at `n`.
 */

/**
 * Analyze the internal uniqueness of a text via word n-gram fingerprinting.
 *
 * The composite `score` blends distinct-ratios of 2/3/4-grams, vocabulary
 * richness and (inverse) token repetition — mirroring the weighting of
 * `uniqueness.py`, but returned on a 0..1 scale (Python returned 0..100).
 * The reported `ngramDiversity`, `repeatedNgrams` and `totalNgrams` are driven
 * by the requested `n` (default 3).
 *
 * @param {string} text
 * @param {{lang?: string, langPack?: object|null, n?: number}} [options]
 *   `lang`/`langPack` are accepted for API symmetry (uniqueness is
 *   language-agnostic); `n` sets the reported n-gram size (default 3).
 * @returns {UniquenessResult} every field finite for empty/short input
 */
export function uniquenessScore(text, { lang, langPack, n = 3 } = {}) {
  const nn = Number.isInteger(n) && n >= 1 ? n : 3;
  const tokens = tokenize(text);
  const total = tokens.length;

  if (total === 0) {
    return { score: 1, ngramDiversity: 1, repeatedNgrams: [], totalNgrams: 0 };
  }

  // ── Composite score (0..1): faithful to uniqueness.py weighting ──
  const ur2 = uniqueRatio(ngrams(tokens, 2));
  const ur3 = uniqueRatio(ngrams(tokens, 3));
  const ur4 = uniqueRatio(ngrams(tokens, 4));
  const vocabRichness = new Set(tokens).size / total;
  const rep = repetitionScore(tokens);
  let score = ur2 * 0.15 + ur3 * 0.25 + ur4 * 0.25 + vocabRichness * 0.2 + (1 - rep) * 0.15;
  score = Math.min(1, Math.max(0, score));

  // ── Reported n-gram stats at the requested n ──
  const grams = ngrams(tokens, nn);
  const totalNgrams = grams.length;
  const counts = new Map();
  for (const g of grams) counts.set(g, (counts.get(g) || 0) + 1);
  const ngramDiversity = totalNgrams ? counts.size / totalNgrams : 1;

  const repeatedNgrams = [...counts.entries()]
    .filter(([, c]) => c > 1)
    .map(([ngram, count]) => ({ ngram, count }))
    .sort((a, b) => b.count - a.count || (a.ngram < b.ngram ? -1 : 1))
    .slice(0, 25);

  return {
    score: round(score),
    ngramDiversity: round(ngramDiversity),
    repeatedNgrams,
    totalNgrams,
  };
}

/**
 * @typedef {object} SimilarityResult
 * @property {number} similarity  Jaccard overlap of the two n-gram sets, 0..1
 *   (1 = identical, 0 = nothing shared).
 * @property {number} sharedNgrams Count of n-grams present in both texts.
 */

/**
 * Compare two texts for similarity via word n-gram overlap (Jaccard).
 *
 * Offline self-similarity only — no external corpus. Identical texts score ~1;
 * unrelated texts score near 0. For very short inputs (fewer than `n` tokens in
 * both texts) it falls back to unigram overlap so identical short texts still
 * compare as identical.
 *
 * @param {string} a
 * @param {string} b
 * @param {{n?: number}} [options] `n` — n-gram size (default 3).
 * @returns {SimilarityResult} finite for empty/short input
 */
export function compareTexts(a, b, { n = 3 } = {}) {
  const nn = Number.isInteger(n) && n >= 1 ? n : 3;
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  let setA = new Set(ngrams(tokensA, nn));
  let setB = new Set(ngrams(tokensB, nn));

  // Short-text fallback: if neither side yields n-grams at `n`, drop to unigrams.
  if (setA.size === 0 && setB.size === 0) {
    setA = new Set(tokensA);
    setB = new Set(tokensB);
  }

  let shared = 0;
  for (const g of setA) if (setB.has(g)) shared++;
  const union = setA.size + setB.size - shared;

  // Both empty → identical by convention (matches compare_texts in Python).
  const similarity = union === 0 ? 1 : shared / union;

  return { similarity: round(similarity), sharedNgrams: shared };
}

export default { uniquenessScore, compareTexts };
