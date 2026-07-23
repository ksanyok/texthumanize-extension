/**
 * Text naturalizer — reduces AI-typical style signals:
 * connector monotony, repetitive sentence starters, uniform sentence
 * lengths (burstiness), overused vocabulary. Uses the full library
 * language-pack dictionaries (ai_connectors, sentence_starters,
 * synonyms, split_conjunctions).
 * @module engine/naturalizer
 */

import { Rng, escapeRegex, matchCase, splitSentences } from './util.js';
import { DE_NOMINALIZE_EN, DE_NOMINALIZE_PHRASES } from './ai-markers-syn.js';

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

    // Burstiness runs first: its sentence-merge branch looks for a neighbour
    // opening with an AI connector, and once _replaceAiConnectors has turned
    // "Moreover," into "Also," that lookup never matches — the merge path was
    // effectively dead. Splitting first also gives the connector pass more
    // sentence starts to work on.
    text = this._injectBurstiness(text, prob);
    text = this._replaceAiConnectors(text, prob);
    text = this._deNominalize(text, prob);
    text = this._varySentenceStarters(text, prob);
    text = this._lightSynonyms(text, prob);
    return text;
  }

  /**
   * Turn "the {noun} of X" back into "{gerund} X" (EN) and swap heavy RU/UK
   * nominal prepositions for verbs — the strongest lever on the `voice` metric
   * and much more human-sounding.
   */
  _deNominalize(text, prob) {
    const code = this.langPack?.code;
    if (code === 'en') {
      const nouns = Object.keys(DE_NOMINALIZE_EN).map(escapeRegex).join('|');
      // Allow one optional adjective in between ("the comprehensive integration
      // of" → "integrating") — dropping the filler adjective is a bonus.
      const re = new RegExp(`(?<=^|[\\s(«"'.,;:!?])(the)\\s+(?:[a-z]+\\s+)?(${nouns})\\s+of\\b`, 'giu');
      text = text.replace(re, (m, the, noun) => {
        if (this.rng.random() > Math.max(prob, 0.7)) return m;
        const gerund = DE_NOMINALIZE_EN[noun.toLowerCase()];
        if (!gerund) return m;
        this.changes.push({ type: 'de_nominalize', description: `${m.trim()} → ${gerund}` });
        // Keep sentence-initial capitalization.
        return /^[A-Z]/.test(the) ? gerund[0].toUpperCase() + gerund.slice(1) : gerund;
      });
      return text;
    }
    const phrases = DE_NOMINALIZE_PHRASES[code];
    if (phrases) {
      for (const [phrase, alts] of Object.entries(phrases)) {
        const re = new RegExp(`(?<=^|[\\s(«"'])${escapeRegex(phrase)}(?=\\s)`, 'giu');
        text = text.replace(re, (m) => {
          if (this.rng.random() > prob) return m;
          const alt = this.rng.choice(alts);
          this.changes.push({ type: 'de_nominalize', description: `${m} → ${alt}` });
          return matchCase(m, alt);
        });
      }
    }
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

    // Spans we have already rewritten. Without this, a replacement can be
    // matched again by a later dict key — "In conclusion" → "Overall" →
    // "On the whole" in a single pass, which drifts far from the source.
    /** @type {Array<[number, number]>} */
    const done = [];
    const overlapsDone = (start, end) => done.some(([s, e]) => start < e && end > s);
    const shiftDone = (at, delta) => {
      for (const span of done) {
        if (span[0] >= at) { span[0] += delta; span[1] += delta; }
      }
    };

    for (const [conn, alts] of Object.entries(dict)) {
      if (!Array.isArray(alts) || alts.length === 0) continue;
      const pattern = new RegExp(
        `(?<=^|[.!?…]\\s|\\n)${escapeRegex(conn)}(?=[,\\s])`,
        'gmu',
      );
      const matches = [...text.matchAll(pattern)];
      if (matches.length === 0) continue;

      // These are AI-characteristic connectors by definition, so even a lone
      // "Furthermore" is a tell worth rewriting — the old first-occurrence
      // factor of 0.35 left ~3 in 4 of them untouched, which is why humanizing
      // barely moved the score on short texts. Repeats stay at full odds.
      for (let i = matches.length - 1; i >= 0; i--) {
        const p = i > 0 ? prob : prob * 0.85;
        if (this.rng.random() > p) continue;

        const m = matches[i];
        if (overlapsDone(m.index, m.index + m[0].length)) continue;

        // Sometimes the most human edit is deleting the connector entirely:
        // "Moreover, the framework…" → "The framework…"
        const followedByComma = text[m.index + m[0].length] === ',';
        if (followedByComma && this.rng.random() < 0.45) {
          const head = text.slice(0, m.index);
          const afterComma = text.slice(m.index + m[0].length + 1).replace(/^\s+/, '');
          const capitalized = afterComma ? afterComma[0].toUpperCase() + afterComma.slice(1) : afterComma;
          shiftDone(m.index, head.length + capitalized.length - text.length);
          text = head + capitalized;
          this.changes.push({
            type: 'connector_drop',
            description: `${m[0]}, → ∅`,
          });
          continue;
        }

        const replacement = matchCase(m[0], this.rng.choice(alts));
        shiftDone(m.index, replacement.length - m[0].length);
        text = text.slice(0, m.index) + replacement + text.slice(m.index + m[0].length);
        done.push([m.index, m.index + replacement.length]);
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
    // Bare prepositions are worse still: their alternatives are only valid for
    // some objects, so swapping them blindly wrecks fixed phrases
    // ("In conclusion" → "Within conclusion", "In 2020" → "During 2020").
    // A preposition's replacement can never be judged from the starter alone.
    const STARTER_BLOCKLIST = new Set([
      'The', 'A', 'An', 'It', 'Це', 'Это',
      'In', 'On', 'At', 'By', 'For', 'With', 'From', 'To', 'As', 'Of',
      'В', 'На', 'По', 'За', 'С', 'До', 'Для', 'При', 'Из', 'От', 'У',
      'Im', 'Am', 'Bei', 'Von', 'Zu', 'Mit', 'Auf', 'Für',
      'En', 'Con', 'Por', 'Para', 'De', 'Del', 'Al',
      'W', 'Na', 'Do', 'Za', 'Od', 'Przy',
    ]);

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
    // Complementizers + relative pronouns make dangling fragments when split
    // ("X, which enables Y" → "X. Enables Y.") — never split on these.
    const COMPLEMENTIZERS = new Set([
      ', что ', ', що ', ', that ', ', dass ', ', que ', ', że ',
      ', which ', ', who ', ', whom ', ', whose ', ', where ', ', when ',
      ', которая ', ', который ', ', которое ', ', которые ', ', яка ', ', який ', ', які ',
    ]);
    // Keep comma-led conjunctions plus semicolons and dashes (always clean
    // clause boundaries) — the old code wrongly dropped "; " and " — ".
    const splitConjunctions = (this.langPack?.split_conjunctions ||
      [', and ', ', but ', ', which ', '; ', ' — '])
      .filter((c) => (c.startsWith(',') || c.startsWith(';') || /[—–]/.test(c)) && !COMPLEMENTIZERS.has(c));
    const out = [];
    let changed = false;

    // Higher intensity → split even medium-length sentences.
    const splitThreshold = Math.max(11, avg * (1.35 - prob * 0.5));

    for (const sentence of sentences) {
      const words = sentence.split(/\s+/);
      if (words.length > splitThreshold && this.rng.random() < 0.4 + prob * 0.6) {
        let parts = this._splitAtConjunction(sentence, splitConjunctions);
        // Very long sentence with no clean conjunction → hard-split at a comma
        // near the middle when the 2nd half can start a fresh sentence.
        if (!parts && words.length > Math.max(24, avg * 1.6)) {
          parts = this._hardSplitAtComma(sentence);
        }
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
   * Fallback split for a very long sentence with no conjunction: break at a
   * comma near the middle, but only when the second half opens with a clear
   * subject (pronoun/determiner) — never a relative pronoun (avoids fragments).
   * @returns {[string, string]|null}
   */
  _hardSplitAtComma(sentence) {
    const SAFE = /^(?:the|this|these|those|it|they|we|you|one|such|most|many|some|our|their|its|his|her|i|he|she|это|этот|эта|эти|они|мы|вы|такой|такие|більшість|вони|ми|ви)\b/i;
    const commas = [];
    const re = /,\s+/gu; let m;
    while ((m = re.exec(sentence)) !== null) commas.push(m.index);
    if (!commas.length) return null;
    const mid = sentence.length / 2;
    commas.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    for (const idx of commas) {
      const first = sentence.slice(0, idx).trim();
      const rest = sentence.slice(idx + 1).trim();
      if (first.split(/\s+/).length < 6 || rest.split(/\s+/).length < 6) continue;
      if (!SAFE.test(rest)) continue;
      const firstOut = /[.!?…]$/.test(first) ? first : first + '.';
      const restOut = rest[0].toUpperCase() + rest.slice(1);
      return [firstOut, /[.!?…]$/.test(restOut) ? restOut : restOut + '.'];
    }
    return null;
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
