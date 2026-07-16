/**
 * Typography normalizer — profile-aware punctuation/spacing cleanup.
 * Port of texthumanize/normalizer.py.
 * @module engine/normalizer
 */

const PROFILE_TYPOGRAPHY = {
  chat: { dash: '-', quotes: '"', ellipsis: '...' },
  web: { dash: '–', quotes: '"', ellipsis: '...' },
  seo: { dash: '–', quotes: '"', ellipsis: '...' },
  docs: { dash: '—', quotes: '"', ellipsis: '…' },
  formal: { dash: '—', quotes: '«»', ellipsis: '…' },
  academic: { dash: '—', quotes: '«»', ellipsis: '…' },
  marketing: { dash: '–', quotes: '"', ellipsis: '...' },
  social: { dash: '-', quotes: '"', ellipsis: '...' },
  email: { dash: '–', quotes: '"', ellipsis: '...' },
};

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/g;
const DOMAIN_RE = /\b[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+\b/g;

export class TypographyNormalizer {
  /** @param {string} profile @param {string} lang */
  constructor(profile = 'web', lang = 'en') {
    this.profileName = profile;
    this.typography = PROFILE_TYPOGRAPHY[profile] || PROFILE_TYPOGRAPHY.web;
    this.lang = lang;
    /** @type {Array<{type: string, description: string}>} */
    this.changes = [];
  }

  /** @param {string} text @returns {string} */
  normalize(text) {
    this.changes = [];
    const original = text;

    text = this._normalizeDashes(text);
    text = this._normalizeQuotes(text);
    text = this._normalizeEllipsis(text);
    text = this._normalizeSpaces(text);
    text = this._fixPunctuationSpaces(text);
    text = this._fixMultipleSpaces(text);

    if (text !== original) {
      this.changes.push({ type: 'typography', description: 'typography_normalized' });
    }
    return text;
  }

  _normalizeDashes(text) {
    const target = this.typography.dash;
    if (target !== '—') {
      text = text.replace(/(?<=\S)\s*—\s*(?=\S)/g, ` ${target} `);
    }
    text = text.replace(/(\w)—(\w)/g, `$1 ${target} $2`);
    return text;
  }

  _normalizeQuotes(text) {
    const target = this.typography.quotes;
    if (target === '"') {
      text = text.replace(/[«»„‟]/g, '"');
      text = text.replace(/[“”]/g, '"');
      text = text.replace(/[‹›]/g, "'");
    } else if (target === '«»') {
      text = text.replace(/„/g, '«').replace(/“/g, '«').replace(/”/g, '»');
      text = this._replacePairedQuotes(text, '"', '«', '»');
    }
    return text;
  }

  _replacePairedQuotes(text, char, openQ, closeQ) {
    let inQuote = false;
    let out = '';
    for (const c of text) {
      if (c === char) {
        out += inQuote ? closeQ : openQ;
        inQuote = !inQuote;
      } else {
        out += c;
      }
    }
    return out;
  }

  _normalizeEllipsis(text) {
    const target = this.typography.ellipsis;
    if (target === '...') {
      text = text.replace(/…/g, '...');
    } else {
      text = text.replace(/(?<!\.)\.{3}(?!\.)/g, '…');
    }
    return text;
  }

  _normalizeSpaces(text) {
    if (this.profileName === 'formal') return text;
    return text
      .replace(/ /g, ' ')
      .replace(/ /g, ' ')
      .replace(/ /g, ' ')
      .replace(/ /g, ' ')
      .replace(/ /g, ' ');
  }

  _fixPunctuationSpaces(text) {
    /** @type {Array<[string, string]>} */
    const protectedSlots = [];
    let counter = 0;
    for (const re of [EMAIL_RE, URL_RE, DOMAIN_RE]) {
      text = text.replace(re, (m) => {
        const ph = `\x00TYPO${counter++}\x00`;
        protectedSlots.push([ph, m]);
        return ph;
      });
    }

    text = text.replace(/\s+([,:;!?])/g, '$1');
    text = text.replace(/\s+(\.(?!\.{3}))/g, '$1');
    text = text.replace(/([,.:;!?])(?=[A-Za-zА-Яа-яёЁіІїЇєЄґҐ])/g, '$1 ');

    for (let i = protectedSlots.length - 1; i >= 0; i--) {
      text = text.replace(protectedSlots[i][0], () => protectedSlots[i][1]);
    }
    return text;
  }

  _fixMultipleSpaces(text) {
    return text.split('\n').map((line) => {
      const stripped = line.replace(/^[ \t]+/, '');
      const leading = line.slice(0, line.length - stripped.length);
      return leading + stripped.replace(/ {2,}/g, ' ');
    }).join('\n');
  }
}
