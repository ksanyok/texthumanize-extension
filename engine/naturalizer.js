/**
 * Text naturalizer — reduces AI-typical style signals:
 * connector monotony, repetitive sentence starters, uniform sentence
 * lengths (burstiness), overused vocabulary. Uses the full library
 * language-pack dictionaries (ai_connectors, sentence_starters,
 * synonyms, split_conjunctions).
 * @module engine/naturalizer
 */

import { Rng, escapeRegex, matchCase, splitSentences } from './util.js';

export class TextNaturalizer {
  /**
   * @param {object|null} langPack
   * @param {string} profile
   * @param {number} intensity 0..100
   * @param {number} seed
   */
  constructor(langPack, profile = 'web', intensity = 60, seed = 0) {
    this.langPack = langPack;
    this.profile = profile;
    this.intensity = intensity;
    this.rng = new Rng(seed);
    /** @type {Array<{type: string, description: string}>} */
    this.changes = [];
  }

  /** @param {string} text @returns {string} */
  process(text) {
    const prob = this.intensity / 100;
    if (prob < 0.05) return text;

    text = this._replaceAiConnectors(text, prob);
    text = this._varySentenceStarters(text, prob);
    text = this._injectBurstiness(text, prob);
    text = this._lightSynonyms(text, prob);
    return text;
  }

  /**
   * Replace AI-characteristic connectors using the pack's ai_connectors
   * dict (connector → human alternatives). First occurrence is kept;
   * repeats are replaced with varied alternatives.
   */
  _replaceAiConnectors(text, prob) {
    const dict = this.langPack?.ai_connectors;
    if (!dict) return text;

    for (const [conn, alts] of Object.entries(dict)) {
      if (!Array.isArray(alts) || alts.length === 0) continue;
      const pattern = new RegExp(
        `(?<=^|[.!?…]\\s|\\n)${escapeRegex(conn)}(?=[,\\s])`,
        'gmu',
      );
      const matches = [...text.matchAll(pattern)];
      if (matches.length === 0) continue;

      // Replace from the 2nd occurrence on (always), or the 1st with prob*0.35.
      for (let i = matches.length - 1; i >= 0; i--) {
        const isRepeat = i > 0;
        const p = isRepeat ? prob : prob * 0.35;
        if (this.rng.random() > p) continue;

        const m = matches[i];

        // Sometimes the most human edit is deleting the connector entirely:
        // "Moreover, the framework…" → "The framework…"
        const followedByComma = text[m.index + m[0].length] === ',';
        if (followedByComma && this.rng.random() < 0.45) {
          const afterComma = text.slice(m.index + m[0].length + 1).replace(/^\s+/, '');
          const capitalized = afterComma ? afterComma[0].toUpperCase() + afterComma.slice(1) : afterComma;
          text = text.slice(0, m.index) + capitalized;
          this.changes.push({
            type: 'connector_drop',
            description: `${m[0]}, → ∅`,
          });
          continue;
        }

        const replacement = matchCase(m[0], this.rng.choice(alts));
        text = text.slice(0, m.index) + replacement + text.slice(m.index + m[0].length);
        this.changes.push({
          type: 'connector_variation',
          description: `${m[0]} → ${replacement}`,
        });
      }
    }
    return text;
  }

  /**
   * If several sentences start with the same word (This/Такой/…),
   * vary the repeats using pack sentence_starters alternatives.
   */
  _varySentenceStarters(text, prob) {
    const dict = this.langPack?.sentence_starters;
    if (!dict) return text;

    const sentences = splitSentences(text);
    if (sentences.length < 3) return text;

    /** @type {Map<string, number>} */
    const starterCount = new Map();
    for (const s of sentences) {
      const first = (s.match(/^[\p{L}']+/u) || [])[0];
      if (first) starterCount.set(first, (starterCount.get(first) || 0) + 1);
    }

    // Articles/pronouns whose pack alternatives can invent content
    // ("It" → "The system") or shift meaning ("The" → "Each") — skip.
    const STARTER_BLOCKLIST = new Set(['The', 'A', 'An', 'It', 'Це', 'Это']);

    for (const [starter, count] of starterCount) {
      if (count < 2) continue;
      if (STARTER_BLOCKLIST.has(starter)) continue;
      const alts = dict[starter] || dict[starter.toLowerCase()] ||
        dict[starter[0].toUpperCase() + starter.slice(1)];
      if (!Array.isArray(alts) || alts.length === 0) continue;

      // Replace repeats (2nd+) with alternatives, keep first occurrence.
      let seen = 0;
      const pattern = new RegExp(`(?<=^|[.!?…]\\s|\\n)${escapeRegex(starter)}(?=[\\s,])`, 'gmu');
      text = text.replace(pattern, (match) => {
        seen++;
        if (seen > 1 && this.rng.random() < prob * 0.8) {
          const replacement = matchCase(match, this.rng.choice(alts));
          this.changes.push({
            type: 'starter_variation',
            description: `${match} → ${replacement}`,
          });
          return replacement;
        }
        return match;
      });
    }
    return text;
  }

  /**
   * Sentence-length burstiness: split overly long sentences at natural
   * conjunction points; occasionally merge two very short neighbours.
   */
  _injectBurstiness(text, prob) {
    const sentences = splitSentences(text);
    if (sentences.length < 4) return text;

    const lengths = sentences.map((s) => s.split(/\s+/).length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + (l - avg) ** 2, 0) / lengths.length;
    if (variance > 30) return text; // Already bursty enough.

    // Complementizers make dangling clauses when split on («следует
    // подчеркнуть, что…» → «следует подчеркнуть.») — exclude them.
    // Also require a leading comma: splitting at a bare conjunction can cut
    // through a noun phrase («robuste und umfassende Lösung»).
    const COMPLEMENTIZERS = new Set([
      ', что ', ', що ', ', that ', ', dass ', ', que ', ', że ',
    ]);
    const splitConjunctions = (this.langPack?.split_conjunctions ||
      [', and ', ', but ', ', which '])
      .filter((c) => c.startsWith(',') && !COMPLEMENTIZERS.has(c));
    const out = [];
    let changed = false;

    // Higher intensity → split even medium-length sentences.
    const splitThreshold = Math.max(11, avg * (1.35 - prob * 0.5));

    for (const sentence of sentences) {
      const words = sentence.split(/\s+/);
      if (words.length > splitThreshold && this.rng.random() < prob * 0.7) {
        const parts = this._splitAtConjunction(sentence, splitConjunctions);
        if (parts) {
          out.push(parts[0], parts[1]);
          changed = true;
          this.changes.push({ type: 'burstiness', description: 'sentence_split' });
          continue;
        }
      }
      out.push(sentence);
    }

    // No split possible and rhythm still flat → merge one adjacent pair
    // where the 2nd sentence opens with a connector we can drop:
    // "…the process. Moreover, the utilization…" → "…the process — and the utilization…"
    if (!changed && this.rng.random() < prob) {
      const connectors = Object.keys(this.langPack?.ai_connectors || {});
      for (let i = 1; i < out.length; i++) {
        const prev = out[i - 1];
        const curr = out[i];
        const conn = connectors.find((c) => curr.startsWith(c + ','));
        if (!conn) continue;
        if (prev.split(/\s+/).length + curr.split(/\s+/).length > 42) continue;
        let rest = curr.slice(conn.length + 1).replace(/^\s+/, '');
        if (rest.length < 15) continue;
        rest = rest[0].toLowerCase() + rest.slice(1);
        const joint = this.langPack?.code === 'en' ? ' — and ' : ' — ';
        out.splice(i - 1, 2, prev.replace(/[.]$/, '') + joint + rest);
        changed = true;
        this.changes.push({ type: 'burstiness', description: `sentence_merge (${conn} dropped)` });
        break;
      }
    }

    return changed ? out.join(' ') : text;
  }

  /**
   * Try to split a long sentence at a pack-defined conjunction near the middle.
   * @returns {[string, string]|null}
   */
  _splitAtConjunction(sentence, splitConjunctions) {
    const mid = sentence.length / 2;
    let best = null;
    let bestDist = Infinity;

    for (const conj of splitConjunctions) {
      let idx = sentence.indexOf(conj);
      while (idx !== -1) {
        const dist = Math.abs(idx - mid);
        if (dist < bestDist && idx > 15 && idx < sentence.length - 15) {
          bestDist = dist;
          best = { idx, conj };
        }
        idx = sentence.indexOf(conj, idx + 1);
      }
    }

    if (!best) return null;

    let first = sentence.slice(0, best.idx).trim();
    let rest = sentence.slice(best.idx + best.conj.length).trim();
    // Both halves must be substantial sentences on their own.
    if (!first || !rest) return null;
    if (first.split(/\s+/).length < 5 || rest.split(/\s+/).length < 5) return null;

    // Terminate first part; drop the conjunction from the second.
    const terminal = /[.!?…]$/.test(first) ? '' : '.';
    first += terminal;
    rest = rest[0].toUpperCase() + rest.slice(1);
    if (!/[.!?…]$/.test(rest)) rest += '.';
    return [first, rest];
  }

  /**
   * Light synonym variation for overused simple words (max a few per text,
   * only exact-case dictionary hits — safe, meaning-preserving).
   */
  _lightSynonyms(text, prob) {
    const dict = this.langPack?.synonyms;
    if (!dict) return text;

    const words = text.split(/\s+/);
    /** @type {Map<string, number>} */
    const freq = new Map();
    for (const w of words) {
      const clean = w.replace(/[.,;:!?"'()[\]{}«»…]/gu, '').toLowerCase();
      if (clean.length > 3) freq.set(clean, (freq.get(clean) || 0) + 1);
    }

    let budget = Math.max(2, Math.floor(words.length / 60));

    for (const [word, count] of [...freq.entries()].sort((a, b) => b[1] - a[1])) {
      if (budget <= 0) break;
      // Vary words repeated 3+ times; long distinctive words already at 2+.
      const minCount = word.length >= 8 ? 2 : 3;
      if (count < minCount) continue;
      const alts = dict[word];
      if (!Array.isArray(alts) || alts.length === 0) continue;
      if (this.rng.random() > prob * 0.7) continue;

      // Replace the 2nd occurrence only (keep natural repetition elsewhere).
      let seen = 0;
      const pattern = new RegExp(`(?<=^|[\\s(«"'])${escapeRegex(word)}(?=$|[\\s).,;:!?»"'…])`, 'giu');
      text = text.replace(pattern, (match) => {
        seen++;
        if (seen === 2) {
          const replacement = matchCase(match, this.rng.choice(alts));
          this.changes.push({
            type: 'synonym_variation',
            description: `${match} → ${replacement}`,
          });
          budget--;
          return replacement;
        }
        return match;
      });
    }
    return text;
  }
}
