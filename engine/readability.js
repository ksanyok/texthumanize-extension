/**
 * Readability metrics.
 *
 * Standard readability formulas (Flesch Reading Ease, Flesch–Kincaid Grade,
 * Coleman–Liau, Automated Readability Index, Gunning Fog, SMOG) plus the
 * underlying text statistics, with a language-aware syllable estimator.
 *
 * Formula parameters mirror the TextHumanize library
 * (`texthumanize/analyzer.py` + `statistical_detector.py`); the SMOG variant
 * uses the standard published formula. Cyrillic syllables are counted by
 * number of vowels; English/Latin by vowel groups with silent-e handling.
 *
 * Pure ES module, zero dependencies.
 * @module engine/readability
 */

import { splitSentences } from './util.js';

/** Vowel sets per language. English keeps a minimal set for the group rules. */
const VOWELS = {
  en: 'aeiouy',
  de: 'aeiouyäöü',
  fr: 'aeiouyàâéèêëïîôùûüÿæœ',
  es: 'aeiouáéíóúü',
  latin: 'aeiouyàâäéèêëïîôöùûüÿãõáíóúæœ',
  cyrillic: 'аеёиоуыэюяіїєґ',
};

/** Languages whose syllables are counted by raw vowel count (Cyrillic script). */
const CYRILLIC_LANGS = new Set(['ru', 'uk', 'be', 'bg', 'mk', 'sr']);

const HAS_CYRILLIC = /[Ѐ-ӿ]/;
const HAS_LATIN = /[a-zà-öø-ÿ]/i;

/**
 * Estimate the number of syllables in a word.
 *
 * English/Latin: count vowel groups (adjacent vowels = one nucleus), then
 * apply the silent trailing-e and consonant+`le` rules for English.
 * Cyrillic: one syllable per vowel.
 *
 * @param {string} word
 * @param {string} [lang]
 * @returns {number} syllable count (>= 1 for a non-empty word, else 0)
 */
export function countSyllables(word, lang = 'en') {
  const w = String(word || '')
    .toLowerCase()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!w) return 0;

  const cyrillic = CYRILLIC_LANGS.has(lang) || (HAS_CYRILLIC.test(w) && !HAS_LATIN.test(w));

  if (cyrillic) {
    // Count every vowel as its own syllable nucleus.
    const vowels = VOWELS.cyrillic;
    let count = 0;
    for (const ch of w) if (vowels.includes(ch)) count += 1;
    return Math.max(count, 1);
  }

  const isEnglish = lang === 'en';
  const vowels = isEnglish ? VOWELS.en : (VOWELS[lang] || VOWELS.latin);

  // Count vowel groups.
  let count = 0;
  let prevVowel = false;
  for (const ch of w) {
    const isVowel = vowels.includes(ch);
    if (isVowel && !prevVowel) count += 1;
    prevVowel = isVowel;
  }

  if (isEnglish) {
    // Silent trailing 'e' (e.g. "make").
    if (w.endsWith('e') && count > 1) count -= 1;
    // Consonant + 'le' ending forms a syllable (e.g. "table").
    if (w.length > 2 && w.endsWith('le') && !vowels.includes(w[w.length - 3]) && count < 1) {
      count = 1;
    }
  }

  return Math.max(count, 1);
}

/** @param {number} x @returns {number} finite value or 0 */
const fin = (x) => (Number.isFinite(x) ? x : 0);

/** @param {number} x @param {number} [d] */
const round = (x, d = 2) => {
  const f = 10 ** d;
  return Math.round(fin(x) * f) / f;
};

/**
 * Map a Flesch Reading Ease score to a coarse reading-level band.
 * @param {number} fre
 * @returns {'very easy'|'easy'|'medium'|'difficult'|'very difficult'}
 */
export function readingLevelFromFRE(fre) {
  if (fre >= 90) return 'very easy';
  if (fre >= 70) return 'easy';
  if (fre >= 50) return 'medium';
  if (fre >= 30) return 'difficult';
  return 'very difficult';
}

/**
 * @typedef {object} ReadabilityResult
 * @property {number} fleschReadingEase   Higher = easier (0..100+).
 * @property {number} fleschKincaidGrade  US grade level.
 * @property {number} colemanLiau         US grade level.
 * @property {number} ari                 Automated Readability Index (grade).
 * @property {number} gunningFog          Gunning Fog index (grade).
 * @property {number} smog                SMOG index (grade).
 * @property {number} avgSentenceLength   Words per sentence.
 * @property {number} avgWordLength       Letters per word.
 * @property {number} avgSyllablesPerWord Syllables per word.
 * @property {number} complexWordRatio    Fraction of words with 3+ syllables.
 * @property {number} lexicalDiversity    Type–token ratio (unique/total).
 * @property {number} gradeLevel          Mean of the five grade-level metrics.
 * @property {string} readingLevel        'very easy' … 'very difficult'.
 */

/** Computes standard readability metrics for a text. */
export class ReadabilityAnalyzer {
  /** @param {string} [lang] */
  constructor(lang = 'en') {
    this.lang = lang;
  }

  /**
   * Analyze `text` and return every metric as a finite number.
   * @param {string} text
   * @returns {ReadabilityResult}
   */
  analyze(text) {
    const src = String(text || '');
    const words = src.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
    const nWords = words.length;

    const empty = {
      fleschReadingEase: 0,
      fleschKincaidGrade: 0,
      colemanLiau: 0,
      ari: 0,
      gunningFog: 0,
      smog: 0,
      avgSentenceLength: 0,
      avgWordLength: 0,
      avgSyllablesPerWord: 0,
      complexWordRatio: 0,
      lexicalDiversity: 0,
      gradeLevel: 0,
      readingLevel: readingLevelFromFRE(0),
    };
    if (nWords === 0) return empty;

    const sentences = splitSentences(src);
    const nSent = Math.max(sentences.length, 1);

    // Per-word aggregates.
    let totalLetters = 0; // alphabetic chars
    let totalAlnum = 0; // letters + digits (for ARI)
    let totalSyllables = 0;
    let complexCount = 0; // 3+ syllables
    let fogComplex = 0; // 3+ syllables, not capitalized, for Gunning Fog
    let polysyllables = 0; // 3+ syllables, for SMOG
    const unique = new Set();

    for (const w of words) {
      const letters = (w.match(/\p{L}/gu) || []).length;
      const alnum = (w.match(/[\p{L}\p{N}]/gu) || []).length;
      totalLetters += letters;
      totalAlnum += alnum;

      const syl = countSyllables(w, this.lang);
      totalSyllables += syl;
      if (syl >= 3) {
        complexCount += 1;
        polysyllables += 1;
        if (w[0] !== w[0].toUpperCase() || w[0] === w[0].toLowerCase()) fogComplex += 1;
      }
      unique.add(w.toLowerCase());
    }

    const asl = nWords / nSent; // avg sentence length (words/sentence)
    const asw = totalSyllables / nWords; // avg syllables per word
    const avgWordLength = totalLetters / nWords;

    // ─── Grade-level & ease formulas ───
    const fleschReadingEase = 206.835 - 1.015 * asl - 84.6 * asw;
    const fleschKincaidGrade = 0.39 * asl + 11.8 * asw - 15.59;

    const L = (totalLetters / nWords) * 100; // letters per 100 words
    const S = (nSent / nWords) * 100; // sentences per 100 words
    const colemanLiau = 0.0588 * L - 0.296 * S - 15.8;

    const ari = 4.71 * (totalAlnum / nWords) + 0.5 * asl - 21.43;

    const pctComplexFog = (fogComplex / nWords) * 100;
    const gunningFog = 0.4 * (asl + pctComplexFog);

    // Standard SMOG (single 30/nSent scaling).
    const smog = 1.0430 * Math.sqrt(polysyllables * (30 / nSent)) + 3.1291;

    const gradeMetrics = [fleschKincaidGrade, colemanLiau, ari, gunningFog, smog];
    const gradeLevel = Math.max(
      0,
      gradeMetrics.reduce((a, b) => a + fin(b), 0) / gradeMetrics.length,
    );

    return {
      fleschReadingEase: round(fleschReadingEase),
      fleschKincaidGrade: round(fleschKincaidGrade),
      colemanLiau: round(colemanLiau),
      ari: round(ari),
      gunningFog: round(gunningFog),
      smog: round(smog),
      avgSentenceLength: round(asl),
      avgWordLength: round(avgWordLength),
      avgSyllablesPerWord: round(asw, 3),
      complexWordRatio: round(complexCount / nWords, 3),
      lexicalDiversity: round(unique.size / nWords, 3),
      gradeLevel: round(gradeLevel),
      readingLevel: readingLevelFromFRE(fleschReadingEase),
    };
  }
}

/**
 * Quick readability analysis.
 * @param {string} text
 * @param {string} [lang]
 * @returns {ReadabilityResult}
 */
export function analyzeReadability(text, lang = 'en') {
  return new ReadabilityAnalyzer(lang).analyze(text);
}
