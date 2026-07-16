/**
 * Debureaucratizer — replaces heavy bureaucratic words and phrases with
 * plain alternatives from the language pack (full library dictionaries).
 * @module engine/debureaucratizer
 */

import { Rng, escapeRegex, matchCase } from './util.js';

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
    this.maxChanges = Math.max(2, Math.floor(wordCount * 0.15));
    this.changesMade = 0;

    // Phrases first (longest match wins), then single words.
    text = this._replaceFromDict(text, this.langPack.bureaucratic_phrases, prob, 'decancel_phrase');
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
        // Avoid determiner collisions: «the aforementioned» → «the this».
        if (/^(the|a|an|this|that|these|those)$/i.test(prevWord)) {
          candidates = replacements.filter(
            (c) => !/^(the|this|that|these|those|a|an)\b/i.test(c));
          if (candidates.length === 0) continue;
        }
        const picked = this._pickReplacement(original, candidates);
        if (picked === null) continue;
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
