/**
 * Stylometry — statistical author "style portrait" extraction and comparison.
 *
 * Ported from the TextHumanize library (`texthumanize/fingerprint.py`:
 * `StyleProfile`, `AuthorFingerprint._extract_features` / `build_profile` /
 * `compare`). Builds a numeric style profile from a text and compares two texts
 * with a weighted Gaussian-kernel similarity to estimate same-authorship.
 *
 * Feature names are camelCased. Two features requested for the extension but
 * absent from the Python source are added: `sentenceLengthVariance` (raw
 * variance of sentence lengths) and `avgSyllables` (vowel-group heuristic).
 * Punctuation rates are per 100 words (as in the Python source); the compare
 * math normalises per feature, so the absolute scale is not load-bearing.
 *
 * All features are guaranteed finite (guarded divisions, sample-stdev needs >=2
 * points else 0). Zero dependencies beyond the shared sentence splitter.
 * @module engine/stylometry
 */

import { splitSentences } from './util.js';

// ─── Built-in function-word sets (stylometry's most stable signal) ───

const EN_FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'can', 'could', 'must',
  'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours',
  'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
  'it', 'its', 'they', 'them', 'their', 'theirs',
  'this', 'that', 'these', 'those',
  'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'of', 'about',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'over', 'up', 'down', 'out', 'off',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'if', 'then', 'else',
  'when', 'while', 'as', 'since', 'because', 'although', 'though',
  'not', 'no', 'very', 'too', 'also', 'just', 'only',
]);

const RU_FUNCTION_WORDS = new Set([
  'и', 'в', 'на', 'с', 'он', 'она', 'они', 'мы', 'вы', 'я',
  'не', 'но', 'а', 'что', 'это', 'как', 'за', 'к', 'по', 'из',
  'от', 'до', 'у', 'о', 'об', 'при', 'для', 'же', 'ли', 'бы',
  'ещё', 'еще', 'так', 'уже', 'все', 'его', 'ее', 'её',
  'то', 'только', 'ну', 'тоже', 'также', 'где', 'когда',
  'если', 'чтобы', 'потому', 'хотя', 'были', 'был', 'была',
  'будет', 'есть', 'нет', 'да',
]);

const UK_FUNCTION_WORDS = new Set([
  'і', 'в', 'на', 'з', 'він', 'вона', 'вони', 'ми', 'ви', 'я',
  'не', 'але', 'а', 'що', 'це', 'як', 'за', 'к', 'по', 'із',
  'від', 'до', 'у', 'о', 'об', 'при', 'для', 'ж', 'чи', 'б',
  'ще', 'так', 'вже', 'всі', 'його', 'її', 'їх',
  'то', 'тільки', 'ну', 'теж', 'також', 'де', 'коли',
  'якщо', 'щоб', 'тому', 'хоча', 'були', 'був', 'була',
  'буде', 'є', 'ні', 'або', 'та',
]);

const PRONOUNS_EN = new Set([
  'i', 'we', 'you', 'he', 'she', 'it', 'they', 'who', 'this', 'that',
  'my', 'our', 'your', 'his', 'her', 'its', 'their',
]);

const ARTICLES_EN = new Set(['the', 'a', 'an']);

const CONJUNCTIONS_EN = new Set([
  'and', 'but', 'or', 'yet', 'so', 'for', 'nor',
  'however', 'moreover', 'furthermore', 'nevertheless',
  'although', 'because', 'since', 'while', 'when', 'if',
]);

/** Vowels for the syllable heuristic (Latin + Cyrillic). */
const VOWEL_RE = /[aeiouyаеёиоуыэюяіїєAEIOUYАЕЁИОУЫЭЮЯІЇЄ]+/g;

/** Numeric feature keys that participate in profiling / comparison. */
const FEATURE_KEYS = [
  'avgWordLength', 'wordLengthStd', 'ttr', 'hapaxRatio', 'avgSyllables',
  'avgSentenceLength', 'sentenceLengthCv', 'sentenceLengthVariance',
  'avgClauseDepth',
  'commaRate', 'semicolonRate', 'dashRate', 'exclamationRate',
  'questionRate', 'parenthesisRate',
  'functionWordRatio',
  'pronounStartRatio', 'articleStartRatio', 'conjunctionStartRatio',
  'avgParagraphLength',
];

/** Per-feature comparison weights (more stable features weigh more). */
const FEATURE_WEIGHTS = {
  functionWordRatio: 3.0,
  avgWordLength: 2.5,
  sentenceLengthCv: 2.0,
  commaRate: 2.0,
  ttr: 1.5,
  pronounStartRatio: 1.5,
  avgSentenceLength: 1.5,
  hapaxRatio: 1.0,
  avgSyllables: 1.0,
  sentenceLengthVariance: 1.0,
  semicolonRate: 1.0,
  dashRate: 1.0,
  exclamationRate: 1.0,
  questionRate: 1.0,
  parenthesisRate: 1.0,
  avgClauseDepth: 1.0,
  articleStartRatio: 1.0,
  conjunctionStartRatio: 1.0,
  wordLengthStd: 1.0,
  avgParagraphLength: 0.8,
};

// ─── Small numeric helpers (all finite-safe) ─────────────────────

/** @param {number[]} a @returns {number} */
function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

/** Sample variance (n-1), matching Python statistics.variance. @param {number[]} a */
function variance(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
}

/** Sample standard deviation (n-1). @param {number[]} a */
function stdev(a) {
  return Math.sqrt(variance(a));
}

/** @param {number} x @returns {number} finite value or 0. */
function finite(x) {
  return Number.isFinite(x) ? x : 0;
}

const PUNCT_EDGE_RE = /^[.,;:!?"'()\-–—«»]+|[.,;:!?"'()\-–—«»]+$/g;

/** Strip leading/trailing punctuation from a token. @param {string} w */
function stripPunct(w) {
  return w.replace(PUNCT_EDGE_RE, '');
}

/** Count vowel-group syllables in a word (min 1 if it has letters). @param {string} w */
function syllables(w) {
  const groups = w.match(VOWEL_RE);
  if (groups && groups.length) return groups.length;
  return /[^\W\d_]/u.test(w) ? 1 : 0;
}

/**
 * Resolve the function-word set for a language, degrading to langPack.stop_words.
 * @param {string} lang @param {object|null} langPack @returns {Set<string>}
 */
function functionWords(lang, langPack) {
  if (lang === 'ru') return RU_FUNCTION_WORDS;
  if (lang === 'uk') return UK_FUNCTION_WORDS;
  if (lang === 'en') return EN_FUNCTION_WORDS;
  const sw = langPack && langPack.stop_words;
  if (Array.isArray(sw) && sw.length) return new Set(sw.map((w) => w.toLowerCase()));
  return EN_FUNCTION_WORDS;
}

/**
 * @typedef {Object} StyleProfile
 * @property {number} avgWordLength
 * @property {number} wordLengthStd
 * @property {number} ttr                    Type/token ratio (vocabulary richness).
 * @property {number} hapaxRatio             Words appearing once / total types.
 * @property {number} avgSyllables           Mean syllables per word.
 * @property {number} avgSentenceLength      Words per sentence.
 * @property {number} sentenceLengthCv       Coefficient of variation of sentence length.
 * @property {number} sentenceLengthVariance Raw variance of sentence length.
 * @property {number} avgClauseDepth         Commas + " and "/" but " per sentence.
 * @property {number} commaRate              Per 100 words.
 * @property {number} semicolonRate
 * @property {number} dashRate
 * @property {number} exclamationRate
 * @property {number} questionRate
 * @property {number} parenthesisRate
 * @property {number} functionWordRatio
 * @property {number} pronounStartRatio      Sentences starting with a pronoun.
 * @property {number} articleStartRatio
 * @property {number} conjunctionStartRatio
 * @property {number} avgParagraphLength     Sentences per paragraph (line).
 * @property {number} sampleWordCount
 * @property {number} sampleSentenceCount
 * @property {string} lang
 */

/** @returns {StyleProfile} zeroed profile. */
function emptyProfile(lang = 'en') {
  /** @type {any} */
  const p = { lang, sampleWordCount: 0, sampleSentenceCount: 0 };
  for (const k of FEATURE_KEYS) p[k] = 0;
  return p;
}

/**
 * Extract style features from a single text.
 * @param {string} text @param {string} lang @param {object|null} langPack
 * @returns {StyleProfile}
 */
function extractFeatures(text, lang, langPack) {
  const p = emptyProfile(lang);
  if (!text) return p;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return p;

  const sentences = splitSentences(text);
  if (sentences.length === 0) return p;

  p.sampleWordCount = words.length;
  p.sampleSentenceCount = sentences.length;

  // ── Word-level ──
  const wordLengths = words.map((w) => stripPunct(w).length).filter((n) => n > 0);
  if (wordLengths.length) {
    p.avgWordLength = finite(mean(wordLengths));
    p.wordLengthStd = finite(stdev(wordLengths));
  }

  const lowerWords = words.map((w) => stripPunct(w).toLowerCase()).filter(Boolean);
  const types = new Set(lowerWords);
  if (lowerWords.length) p.ttr = finite(types.size / lowerWords.length);

  // Hapax legomena / total types.
  const freq = new Map();
  for (const w of lowerWords) freq.set(w, (freq.get(w) || 0) + 1);
  let hapax = 0;
  for (const c of freq.values()) if (c === 1) hapax += 1;
  p.hapaxRatio = types.size ? finite(hapax / types.size) : 0;

  // Syllables per word.
  if (lowerWords.length) {
    p.avgSyllables = finite(mean(lowerWords.map(syllables)));
  }

  // ── Sentence-level ──
  const sentLens = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  if (sentLens.length) {
    p.avgSentenceLength = finite(mean(sentLens));
    p.sentenceLengthVariance = finite(variance(sentLens));
    if (sentLens.length > 1 && p.avgSentenceLength > 0) {
      p.sentenceLengthCv = finite(stdev(sentLens) / p.avgSentenceLength);
    }
  }

  // Clause-depth proxy.
  const clauseCounts = sentences.map(
    (s) => countOccurrences(s, ',') + countOccurrences(s, ' and ') + countOccurrences(s, ' but '),
  );
  p.avgClauseDepth = finite(mean(clauseCounts));

  // ── Punctuation rates (per 100 words) ──
  const n100 = words.length / 100;
  p.commaRate = finite(countOccurrences(text, ',') / n100);
  p.semicolonRate = finite(countOccurrences(text, ';') / n100);
  p.dashRate = finite((countOccurrences(text, '—') + countOccurrences(text, '–') + countOccurrences(text, ' - ')) / n100);
  p.exclamationRate = finite(countOccurrences(text, '!') / n100);
  p.questionRate = finite(countOccurrences(text, '?') / n100);
  p.parenthesisRate = finite((countOccurrences(text, '(') + countOccurrences(text, '[')) / n100);

  // ── Function words ──
  const funcSet = functionWords(lang, langPack);
  const funcCount = lowerWords.reduce((n, w) => n + (funcSet.has(w) ? 1 : 0), 0);
  p.functionWordRatio = lowerWords.length ? finite(funcCount / lowerWords.length) : 0;

  // ── Start-of-sentence patterns (EN POS proxies, as in the source) ──
  const firstWords = sentences
    .map((s) => s.split(/\s+/).filter(Boolean)[0])
    .filter(Boolean)
    .map((w) => stripPunct(w.replace(/^["'«]+/, '')).toLowerCase());
  const nSent = firstWords.length || 1;
  p.pronounStartRatio = finite(firstWords.filter((w) => PRONOUNS_EN.has(w)).length / nSent);
  p.articleStartRatio = finite(firstWords.filter((w) => ARTICLES_EN.has(w)).length / nSent);
  p.conjunctionStartRatio = finite(firstWords.filter((w) => CONJUNCTIONS_EN.has(w)).length / nSent);

  // ── Paragraph-level (lines with content) ──
  const paragraphs = text.split('\n').filter((line) => line.trim());
  if (paragraphs.length) {
    const paraSentCounts = paragraphs.map((para) => splitSentences(para).length);
    p.avgParagraphLength = finite(mean(paraSentCounts));
  }

  return p;
}

/** Count non-overlapping occurrences of `needle` in `hay`. */
function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = hay.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * Average several per-text profiles into one (build_profile).
 * @param {StyleProfile[]} profiles @param {string} lang @returns {StyleProfile}
 */
function averageProfiles(profiles, lang) {
  if (profiles.length === 0) return emptyProfile(lang);
  const merged = emptyProfile(lang);
  for (const k of FEATURE_KEYS) {
    merged[k] = finite(mean(profiles.map((p) => p[k])));
  }
  merged.sampleWordCount = profiles.reduce((n, p) => n + p.sampleWordCount, 0);
  merged.sampleSentenceCount = profiles.reduce((n, p) => n + p.sampleSentenceCount, 0);
  return merged;
}

/**
 * Compare a candidate profile against a reference profile.
 * @param {StyleProfile} ref @param {StyleProfile} cand
 * @returns {{ similarity: number, verdict: string, perFeature: Record<string, {ref:number, value:number, deviation:number, similarity:number}> }}
 */
function compareProfiles(ref, cand) {
  /** @type {Record<string, any>} */
  const perFeature = {};
  let totalWeight = 0;
  let weighted = 0;

  for (const key of FEATURE_KEYS) {
    const refVal = ref[key];
    const newVal = cand[key];
    const scale = Math.max(Math.abs(refVal), 0.01);
    const deviation = (newVal - refVal) / scale;
    const sim = Math.exp(-0.5 * deviation * deviation); // Gaussian kernel
    const w = FEATURE_WEIGHTS[key] ?? 1.0;
    totalWeight += w;
    weighted += sim * w;
    perFeature[key] = {
      ref: round(refVal, 4),
      value: round(newVal, 4),
      deviation: round(deviation, 4),
      similarity: round(sim, 4),
    };
  }

  const similarity = totalWeight > 0 ? weighted / totalWeight : 0.5;
  let verdict = 'uncertain';
  if (similarity >= 0.70) verdict = 'same_author';
  else if (similarity <= 0.40) verdict = 'different_author';

  return { similarity, verdict, perFeature };
}

/** @param {number} x @param {number} d @returns {number} rounded to d decimals. */
function round(x, d) {
  const f = 10 ** d;
  return Math.round(finite(x) * f) / f;
}

// ═══════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════

/** Build and compare author style fingerprints. */
export class Stylometry {
  /** @param {string} [lang='en'] Default language code. */
  constructor(lang = 'en') {
    this.lang = String(lang || 'en').toLowerCase();
  }

  /**
   * Extract a style profile from a single text.
   * @param {string} text
   * @param {object} [opts]
   * @param {object|null} [opts.langPack]
   * @param {string} [opts.lang] Override the instance language.
   * @returns {StyleProfile}
   */
  profile(text, { langPack = null, lang } = {}) {
    const code = String(lang || this.lang || (langPack && langPack.code) || 'en').toLowerCase();
    return extractFeatures(text, code, langPack);
  }

  /**
   * Build an averaged profile from several reference texts (build_profile).
   * @param {string[]} texts
   * @param {object} [opts]
   * @param {object|null} [opts.langPack]
   * @param {string} [opts.lang]
   * @returns {StyleProfile}
   */
  buildProfile(texts, { langPack = null, lang } = {}) {
    const code = String(lang || this.lang || (langPack && langPack.code) || 'en').toLowerCase();
    if (!Array.isArray(texts) || texts.length === 0) return emptyProfile(code);
    const profiles = texts.map((t) => extractFeatures(t, code, langPack));
    return averageProfiles(profiles, code);
  }

  /**
   * Compare a candidate text against a reference profile.
   * @param {StyleProfile} refProfile
   * @param {string} text
   * @param {object} [opts]
   * @param {object|null} [opts.langPack]
   * @returns {{ similarity: number, sameAuthorLikelihood: number, verdict: string, confidence: number, perFeature: object }}
   */
  compare(refProfile, text, { langPack = null } = {}) {
    if (!text || !refProfile || !refProfile.sampleWordCount) {
      return {
        similarity: 0, sameAuthorLikelihood: 0, verdict: 'unknown',
        confidence: 0, perFeature: {},
      };
    }
    const cand = extractFeatures(text, refProfile.lang, langPack);
    const { similarity, verdict, perFeature } = compareProfiles(refProfile, cand);

    const sizeFactor = Math.min(refProfile.sampleWordCount / 500, 1);
    const textFactor = Math.min(cand.sampleWordCount / 100, 1);
    const confidence = sizeFactor * textFactor * 0.9;

    return {
      similarity: round(similarity, 4),
      sameAuthorLikelihood: round(likelihood(similarity), 4),
      verdict,
      confidence: round(confidence, 4),
      perFeature,
    };
  }
}

/**
 * Calibrate a raw similarity into a 0..1 same-author likelihood using the
 * source verdict bands (<=0.40 different, >=0.70 same).
 * @param {number} similarity @returns {number}
 */
function likelihood(similarity) {
  return Math.max(0, Math.min(1, (similarity - 0.40) / 0.30));
}

/**
 * Compare the styles of two texts directly.
 * @param {string} textA @param {string} textB
 * @param {object} [opts]
 * @param {string} [opts.lang]
 * @param {object|null} [opts.langPack]
 * @returns {{ similarity: number, sameAuthorLikelihood: number, verdict: string, confidence: number, perFeature: object }}
 */
export function compareStyle(textA, textB, { lang, langPack = null } = {}) {
  const code = String(lang || (langPack && langPack.code) || 'en').toLowerCase();
  const st = new Stylometry(code);
  const refProfile = st.profile(textA, { langPack });
  return st.compare(refProfile, textB, { langPack });
}

/**
 * Produce a style profile plus a human-readable summary for one text.
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.lang]
 * @param {object|null} [opts.langPack]
 * @returns {{ profile: StyleProfile, summary: string }}
 */
export function fingerprint(text, { lang, langPack = null } = {}) {
  const code = String(lang || (langPack && langPack.code) || 'en').toLowerCase();
  const profile = extractFeatures(text, code, langPack);
  const summary = [
    `lang=${profile.lang}  words=${profile.sampleWordCount}  sentences=${profile.sampleSentenceCount}`,
    `avg word length: ${round(profile.avgWordLength, 2)}  (±${round(profile.wordLengthStd, 2)})`,
    `avg sentence length: ${round(profile.avgSentenceLength, 1)} words  (CV ${round(profile.sentenceLengthCv, 2)})`,
    `avg syllables/word: ${round(profile.avgSyllables, 2)}`,
    `TTR: ${round(profile.ttr, 3)}  hapax: ${round(profile.hapaxRatio, 3)}`,
    `function-word ratio: ${round(profile.functionWordRatio, 3)}`,
    `punctuation /100w — comma ${round(profile.commaRate, 2)}, semicolon ${round(profile.semicolonRate, 2)}, dash ${round(profile.dashRate, 2)}, "!" ${round(profile.exclamationRate, 2)}, "?" ${round(profile.questionRate, 2)}`,
    `sentence starts — pronoun ${round(profile.pronounStartRatio, 2)}, article ${round(profile.articleStartRatio, 2)}, conjunction ${round(profile.conjunctionStartRatio, 2)}`,
  ].join('\n');
  return { profile, summary };
}
