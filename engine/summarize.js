/**
 * Extractive summarization — frequency + position scoring (offline, zero-dep).
 * @module engine/summarize
 */

import { splitSentences } from './util.js';
import { stopwordsFor } from './_stopwords.js';

/**
 * @param {string} text
 * @param {{sentences?: number, lang?: string, langPack?: object|null}} [opts]
 * @returns {{ summary: string, picked: {text: string, score: number, index: number}[] }}
 */
export function summarize(text, opts = {}) {
  const { sentences: want = 3, lang, langPack = null } = opts;
  const stop = stopwordsFor(lang, langPack);
  const s = typeof text === 'string' ? text : '';
  const sents = splitSentences(s).filter((x) => x.trim().split(/\s+/).length >= 3);

  if (sents.length <= want) {
    return { summary: sents.join(' ') || s.trim(), picked: sents.map((text2, index) => ({ text: text2, score: 1, index })) };
  }

  // Content-word frequencies across the document.
  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const sent of sents) {
    for (const w of sent.toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]*/gu) || []) {
      if (w.length < 3 || stop.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  let maxF = 1;
  for (const v of freq.values()) if (v > maxF) maxF = v;

  const scored = sents.map((sent, index) => {
    const words = sent.toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]*/gu) || [];
    const content = words.filter((w) => w.length >= 3 && !stop.has(w));
    let tf = 0;
    for (const w of content) tf += (freq.get(w) || 0) / maxF;
    const density = content.length ? tf / content.length : 0;
    const positionBonus = index === 0 ? 0.25 : index === 1 ? 0.12 : 0;
    const lengthPenalty = words.length > 40 ? -0.15 : words.length < 6 ? -0.1 : 0;
    const score = density + positionBonus + lengthPenalty;
    return { text: sent, score, index };
  });

  const picked = scored.slice().sort((a, b) => b.score - a.score).slice(0, want).sort((a, b) => a.index - b.index);
  return { summary: picked.map((p) => p.text).join(' '), picked };
}
