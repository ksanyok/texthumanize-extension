/**
 * Text statistics — pure counts and derived metrics (zero-dep, offline).
 * @module engine/statistics
 */

import { splitSentences } from './util.js';

/**
 * @param {string} text
 * @returns {{
 *   chars: number, charsNoSpaces: number, words: number, uniqueWords: number,
 *   sentences: number, paragraphs: number, avgWordLength: number,
 *   avgSentenceLength: number, lexicalDiversity: number, longWordRatio: number,
 *   readingTimeSec: number, speakingTimeSec: number, longestSentenceWords: number
 * }}
 */
export function textStatistics(text) {
  const s = typeof text === 'string' ? text : '';
  const chars = s.length;
  const charsNoSpaces = (s.match(/\S/g) || []).length;

  const wordTokens = s.match(/\p{L}[\p{L}\p{N}'’-]*/gu) || [];
  const words = wordTokens.length;
  const lower = wordTokens.map((w) => w.toLowerCase());
  const uniqueWords = new Set(lower).size;

  const sentences = splitSentences(s).filter((x) => x.trim().length > 0);
  const sentenceCount = sentences.length || (words > 0 ? 1 : 0);

  const paragraphs = s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length ||
    (s.trim() ? 1 : 0);

  const totalWordLen = lower.reduce((a, w) => a + w.length, 0);
  const avgWordLength = words ? totalWordLen / words : 0;

  const sentWordCounts = sentences.map((x) => (x.match(/\p{L}[\p{L}\p{N}'’-]*/gu) || []).length);
  const avgSentenceLength = sentenceCount ? words / sentenceCount : 0;
  const longestSentenceWords = sentWordCounts.length ? Math.max(...sentWordCounts) : 0;

  const lexicalDiversity = words ? uniqueWords / words : 0;
  const longWordRatio = words ? lower.filter((w) => w.length >= 7).length / words : 0;

  const readingTimeSec = Math.round((words / 200) * 60);
  const speakingTimeSec = Math.round((words / 130) * 60);

  return {
    chars, charsNoSpaces, words, uniqueWords,
    sentences: sentenceCount, paragraphs,
    avgWordLength: round2(avgWordLength),
    avgSentenceLength: round2(avgSentenceLength),
    lexicalDiversity: round2(lexicalDiversity),
    longWordRatio: round2(longWordRatio),
    readingTimeSec, speakingTimeSec, longestSentenceWords,
  };
}

function round2(n) { return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100; }
