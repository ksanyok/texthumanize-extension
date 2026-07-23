/**
 * Debureaucratizer — replaces heavy bureaucratic words and phrases with
 * plain alternatives from the language pack (full library dictionaries).
 * @module engine/debureaucratizer
 */

import { Rng, escapeRegex, matchCase } from './util.js';
import { AI_MARKER_SYNONYMS } from './ai-markers-syn.js';

/**
 * Rough gender/number class of a Cyrillic noun by its ending.
 * Used to avoid breaking adjective agreement in RU/UK when swapping
 * single nouns («комплексная методология» → «комплексный подход»
 * would need adjective reinflection we cannot do here).
 * @param {string} word
 * @returns {'fem'|'neut'|'masc'|'plur'|'unknown'}
 */
function cyrGenderClass(word) {
  const w = word.toLowerCase();
  if (!/[а-яёіїєґ]$/.test(w)) return 'unknown';
  if (/(?:ия|ія|ость|ість|ка|га|ха|ца|жа|ша|ща|ча|а|я)$/.test(w)) return 'fem';
  if (/(?:ие|іє|ня|тя)$/.test(w)) return 'neut';
  if (/(?:о|е|є)$/.test(w)) return 'neut';
  if (/(?:ы|и|і)$/.test(w)) return 'plur';
  return 'masc';
}

export class Debureaucratizer {
  /**
   * @param {object|null} langPack — exported TextHumanize language pack
   * @param {string} profile
   * @param {number} intensity 0..100
   * @param {number} seed
   */
  constructor(langPack, profile = 'web', intensity = 60, seed = 0) {
    this.langPack = langPack;
    this.profile = profile;
    this.intensity = intensity;
    this.rng = new Rng(seed);
    this.isCyrillicLang = langPack?.code === 'ru' || langPack?.code === 'uk';
    /** @type {Array<{type: string, description: string, from?: string, to?: string}>} */
    this.changes = [];
    this.maxChanges = 100;
    this.changesMade = 0;
  }

  /**
   * Pick a replacement candidate. For RU/UK single-word noun swaps,
   * prefer candidates whose gender/number class matches the original —
   * otherwise adjective agreement breaks («комплексная подход»).
   * @param {string} original
   * @param {string[]} candidates
   * @returns {string|null}
   */
  _pickReplacement(original, candidates) {
    if (!this.isCyrillicLang || original.includes(' ')) {
      return this.rng.choice(candidates);
    }
    const cls = cyrGenderClass(original);
    if (cls === 'unknown') return this.rng.choice(candidates);
    const matching = candidates.filter((c) =>
      c.includes(' ') || cyrGenderClass(c) === cls || cyrGenderClass(c) === 'unknown');
    if (matching.length === 0) return null;
    return this.rng.choice(matching);
  }

  /** @param {string} text @returns {string} */
  process(text) {
    if (!this.langPack) return text;
    const prob = this.intensity / 100;
    if (prob < 0.05) return text;

    const wordCount = text.split(/\s+/).length;
    // Scale the change budget with intensity so raising it actually rewrites
    // more (was a flat 15% cap that made high intensity indistinguishable).
    this.maxChanges = Math.max(2, Math.floor(wordCount * (0.15 + prob * 0.25)));
    this.changesMade = 0;

    // Kill the exact AI-marker buzzwords first — they carry the most detector
    // weight and the language packs don't cover them.
    const aiSyn = AI_MARKER_SYNONYMS[this.langPack.code];
    if (aiSyn) text = this._replaceFromDict(text, aiSyn, Math.max(prob, 0.85), 'de_ai_marker');

    // Phrases first (longest match wins), then single words.
    //
    // Phrases run at near-certainty rather than at `prob`. A multi-word match
    // like "it is important to note that" or "у сучасному світі" is an
    // unambiguous AI tell, so leaving it in on a coin flip is simply a miss —
    // on a short text that was enough to keep several markers and make
    // humanizing look like it did nothing. Variety comes from *which*
    // alternative is drawn, not from whether we act. Single words stay at
    // `prob`: those are where blanket replacement starts to read mechanical.
    text = this._replaceFromDict(
      text, this.langPack.bureaucratic_phrases, Math.max(prob, 0.92), 'decancel_phrase');
    text = this._replaceFromDict(text, this.langPack.bureaucratic, prob, 'decancel_word');
    return text;
  }

  /**
   * @param {string} text
   * @param {Record<string, string[]>|undefined} dict
   * @param {number} prob
   * @param {string} changeType
   */
  _replaceFromDict(text, dict, prob, changeType) {
    if (!dict) return text;

    // Sort keys longest-first so multi-word entries take priority.
    const keys = Object.keys(dict).sort((a, b) => b.length - a.length);

    for (const key of keys) {
      if (this.changesMade >= this.maxChanges) break;

      const replacements = dict[key];
      if (!Array.isArray(replacements) || replacements.length === 0) continue;

      const pattern = new RegExp(
        `(?<=^|[\\s(«"'])${escapeRegex(key)}(?=$|[\\s).,;:!?»"'…])`,
        'giu',
      );
      const matches = [...text.matchAll(pattern)];

      for (let i = matches.length - 1; i >= 0; i--) {
        if (this.changesMade >= this.maxChanges) break;
        if (this.rng.random() > prob) continue;

        const match = matches[i];
        const original = match[0];
        const prevWord = (text.slice(0, match.index).match(/([\p{L}']+)\s*$/u) || [])[1] || '';
        const nextChar = text[match.index + original.length] || '';
        let candidates = replacements;
        // "make efficient the process": «make ADJ» replacements only work
        // clause-finally — drop them when an object follows.
        if (!original.includes(' ') && nextChar === ' ') {
          candidates = candidates.filter((c) => !/^(make|makes|making)\s+\w+$/i.test(c));
          if (candidates.length === 0) continue;
        }
        // help/make/let take a bare infinitive, so they can't stand in front of
        // a gerund. De-nominalization runs first and turns "the optimization
        // of X" into "improving X", after which "facilitates" → "helps" gave
        // "helps improving X". Drop those candidates when a gerund follows.
        const nextWord = (text.slice(match.index + original.length)
          .match(/^\s+([\p{L}']+)/u) || [])[1] || '';
        if (/^\p{Ll}+ing$/u.test(nextWord)) {
          candidates = candidates.filter(
            (c) => !/^(help|helps|helped|make|makes|made|let|lets)$/i.test(c));
          if (candidates.length === 0) continue;
        }
        // Avoid determiner collisions: «the aforementioned» → «the this».
        if (/^(the|a|an|this|that|these|those)$/i.test(prevWord)) {
          candidates = replacements.filter(
            (c) => !/^(the|this|that|these|those|a|an)\b/i.test(c));
          if (candidates.length === 0) continue;
        }
        const picked = this._pickReplacement(original, candidates);
        if (picked === null) continue;

        // An empty replacement means "this phrase is best simply deleted" —
        // the most human edit for an opening cliché. Deleting text needs more
        // care than swapping it: without this, dropping "It is worth noting
        // that " left a double space and a lower-case sentence start
        // ("…daily lives.  these powerful tools…").
        if (picked === '') {
          const head = text.slice(0, match.index).replace(/[ \t]+$/, '');
          let tail = text.slice(match.index + original.length)
            .replace(/^[\s,;:]+/, '');
          if (!tail) continue;
          const startsText = head === '';
          if (startsText || /[.!?…]["»']?$/u.test(head)) {
            tail = tail[0].toLocaleUpperCase() + tail.slice(1);
          }
          text = (startsText ? '' : `${head} `) + tail;
          this.changesMade++;
          this.changes.push({
            type: changeType,
            description: `${original} → ∅`,
            from: original,
            to: '',
          });
          continue;
        }

        const replacement = matchCase(original, picked);

        text = text.slice(0, match.index) + replacement +
          text.slice(match.index + original.length);
        this.changesMade++;
        this.changes.push({
          type: changeType,
          description: `${original} → ${replacement}`,
          from: original,
          to: replacement,
        });
      }
    }
    return text;
  }
}
