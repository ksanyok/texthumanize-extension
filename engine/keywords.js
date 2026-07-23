/**
 * Keyword & key-phrase extraction (TF + RAKE-style phrasing, offline).
 * @module engine/keywords
 */

import { stopwordsFor } from './_stopwords.js';

/**
 * @param {string} text
 * @param {{lang?: string, langPack?: object|null, topN?: number}} [opts]
 * @returns {{ keywords: {term: string, score: number, count: number}[], phrases: {phrase: string, score: number}[] }}
 */
export function extractKeywords(text, opts = {}) {
  const { lang, langPack = null, topN = 10 } = opts;
  const stop = stopwordsFor(lang, langPack);
  const s = typeof text === 'string' ? text : '';

  // Single-word frequencies (content words only).
  const tokens = (s.toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]*/gu) || []).filter((w) => w.length >= 3);
  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const w of tokens) {
    if (stop.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const total = tokens.length || 1;
  const keywords = [...freq.entries()]
    .map(([term, count]) => ({ term, count, score: round3((count / total) * Math.log2(1 + term.length)) }))
    .sort((a, b) => b.count - a.count || b.score - a.score)
    .slice(0, topN);

  // RAKE-style phrases: runs of non-stopword content tokens split on stopwords/punctuation.
  const phraseCandidates = new Map();
  const wordScore = new Map();
  for (const [w, c] of freq) wordScore.set(w, c); // degree≈freq (lightweight)
  const sequence = s.toLowerCase().split(/[.,;:!?()"“”«»\n\-—/]+/);
  for (const chunk of sequence) {
    const ws = (chunk.match(/\p{L}[\p{L}\p{N}'’-]*/gu) || []);
    let run = [];
    const flush = () => {
      if (run.length >= 2 && run.length <= 4) {
        const phrase = run.join(' ');
        const sc = run.reduce((a, w) => a + (wordScore.get(w) || 1), 0);
        phraseCandidates.set(phrase, Math.max(phraseCandidates.get(phrase) || 0, sc));
      }
      run = [];
    };
    for (const w of ws) {
      if (stop.has(w) || w.length < 3) { flush(); continue; }
      run.push(w);
    }
    flush();
  }
  const phrases = [...phraseCandidates.entries()]
    .map(([phrase, score]) => ({ phrase, score: round3(score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return { keywords, phrases };
}

function round3(n) { return Math.round((Number.isFinite(n) ? n : 0) * 1000) / 1000; }
