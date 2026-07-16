/**
 * Watermark detection & cleaning — Unicode steganography, homoglyphs,
 * invisible characters, spacing anomalies, Kirchenbauer green-list test.
 * Faithful port of texthumanize/watermark.py.
 * @module engine/watermark
 */

const ZERO_WIDTH_CHARS = new Set([
  '​', // Zero Width Space
  '‌', // Zero Width Non-Joiner
  '‍', // Zero Width Joiner
  '‎', // Left-to-Right Mark
  '‏', // Right-to-Left Mark
  '⁠', // Word Joiner
  '⁡', // Function Application
  '⁢', // Invisible Times
  '⁣', // Invisible Separator
  '⁤', // Invisible Plus
  '﻿', // Zero Width No-Break Space (BOM)
  '­', // Soft Hyphen
  '͏', // Combining Grapheme Joiner
  '؜', // Arabic Letter Mark
  '᠎', // Mongolian Vowel Separator
]);

const CYRILLIC_TO_LATIN = {
  'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p',
  'х': 'x', 'у': 'y', 'А': 'A', 'В': 'B', 'С': 'C',
  'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M', 'О': 'O',
  'Р': 'P', 'Т': 'T', 'Х': 'X',
};
const LATIN_TO_CYRILLIC = Object.fromEntries(
  Object.entries(CYRILLIC_TO_LATIN).map(([k, v]) => [v, k]),
);

const SPECIAL_HOMOGLYPHS = {
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd',
  'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g',
  '∂': 'd', 'α': 'a', 'ο': 'o',
  '²': '2', '³': '3', '¹': '1',
  '⁰': '0', 'ⁱ': 'i',
};

const TYPOGRAPHY_NORMALIZE = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '‒': '-', '–': '-', '—': '-', '−': '-',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  ' ': ' ', ' ': ' ', '　': ' ',
};

const IS_CYRILLIC = /\p{Script=Cyrillic}/u;
const IS_LATIN = /\p{Script=Latin}/u;
const IS_FORMAT = /\p{Cf}/u;

// ── Compact synchronous SHA-256 (needed for Kirchenbauer parity with Python) ──

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 of a UTF-8 string; returns first 32 bits as unsigned int
 * (equivalent to int(hashlib.sha256(s).hexdigest()[:8], 16)).
 * @param {string} str
 * @returns {number}
 */
export function sha256First32(str) {
  const bytes = new TextEncoder().encode(str);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return h0 >>> 0;
}

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** Complementary error function (Abramowitz & Stegun 7.1.26 approximation). */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 +
    t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
    t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/**
 * @typedef {Object} WatermarkReport
 * @property {boolean} hasWatermarks
 * @property {string[]} watermarkTypes
 * @property {string[]} details
 * @property {string} cleanedText
 * @property {number} charactersRemoved
 * @property {Array<[string, string, number]>} homoglyphsFound
 * @property {number} zeroWidthCount
 * @property {number} confidence
 * @property {number} kirchenbauerScore
 * @property {number} kirchenbauerPValue
 */

export class WatermarkDetector {
  /** @param {string} lang */
  constructor(lang = 'en') {
    this.lang = lang;
  }

  /**
   * @param {string} text
   * @returns {WatermarkReport}
   */
  detect(text) {
    /** @type {WatermarkReport} */
    const report = {
      hasWatermarks: false,
      watermarkTypes: [],
      details: [],
      cleanedText: text,
      charactersRemoved: 0,
      homoglyphsFound: [],
      zeroWidthCount: 0,
      confidence: 0,
      kirchenbauerScore: 0,
      kirchenbauerPValue: 1,
    };

    this._detectZeroWidth(text, report);
    this._detectHomoglyphs(report);
    this._detectInvisible(report);
    this._detectSpacingAnomalies(report);
    this._detectStatistical(text, report);
    this._detectKirchenbauer(text, report);

    report.hasWatermarks = report.watermarkTypes.length > 0;
    if (report.hasWatermarks) {
      report.confidence = Math.min(
        0.3 + 0.15 * report.watermarkTypes.length +
        0.01 * report.charactersRemoved +
        0.05 * report.homoglyphsFound.length,
        1,
      );
    }
    return report;
  }

  /** @param {string} text @returns {string} */
  clean(text) {
    return this.detect(text).cleanedText;
  }

  _detectZeroWidth(text, report) {
    let count = 0;
    let cleaned = '';
    for (const ch of text) {
      if (ZERO_WIDTH_CHARS.has(ch)) count++;
      else cleaned += ch;
    }
    if (count > 0) {
      report.watermarkTypes.push('zero_width_characters');
      report.details.push(`Found ${count} zero-width/invisible characters`);
      report.zeroWidthCount = count;
      report.charactersRemoved += count;
      report.cleanedText = cleaned;
    }
  }

  _detectHomoglyphs(report) {
    const isCyrillicText = this.lang === 'ru' || this.lang === 'uk';
    /** @type {Array<[string, string, number]>} */
    const homoglyphs = [];
    const chars = [...report.cleanedText];

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const left = i > 0 ? chars[i - 1] : ' ';
      const right = i < chars.length - 1 ? chars[i + 1] : ' ';

      if (isCyrillicText) {
        if (ch in LATIN_TO_CYRILLIC &&
            (IS_CYRILLIC.test(left) || IS_CYRILLIC.test(right))) {
          const expected = LATIN_TO_CYRILLIC[ch];
          homoglyphs.push([ch, expected, i]);
          chars[i] = expected;
        }
      } else if (ch in CYRILLIC_TO_LATIN &&
          (IS_LATIN.test(left) || IS_LATIN.test(right))) {
        const expected = CYRILLIC_TO_LATIN[ch];
        homoglyphs.push([ch, expected, i]);
        chars[i] = expected;
      }

      if (ch in SPECIAL_HOMOGLYPHS && SPECIAL_HOMOGLYPHS[ch] !== ch) {
        homoglyphs.push([ch, SPECIAL_HOMOGLYPHS[ch], i]);
        chars[i] = SPECIAL_HOMOGLYPHS[ch];
      }

      if (chars[i] in TYPOGRAPHY_NORMALIZE && TYPOGRAPHY_NORMALIZE[chars[i]] !== chars[i]) {
        chars[i] = TYPOGRAPHY_NORMALIZE[chars[i]];
      }
    }

    report.cleanedText = chars.join('');

    if (homoglyphs.length > 0) {
      report.watermarkTypes.push('homoglyph_substitution');
      report.homoglyphsFound = homoglyphs;
      report.details.push(`Found ${homoglyphs.length} homoglyph substitutions`);
      report.charactersRemoved += homoglyphs.length;
    }
  }

  _detectInvisible(report) {
    let count = 0;
    let cleaned = '';
    for (const ch of report.cleanedText) {
      if (ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ') {
        cleaned += ch;
        continue;
      }
      if (IS_FORMAT.test(ch) && !ZERO_WIDTH_CHARS.has(ch)) count++;
      else cleaned += ch;
    }
    if (count > 0) {
      report.watermarkTypes.push('invisible_unicode');
      report.details.push(`Found ${count} invisible Unicode format characters`);
      report.charactersRemoved += count;
      report.cleanedText = cleaned;
    }
  }

  _detectSpacingAnomalies(report) {
    let cleaned = report.cleanedText;

    const multiSpace = cleaned.match(/(?<=\S) {2,}(?=\S)/g) || [];
    if (multiSpace.length > 5) {
      report.watermarkTypes.push('spacing_steganography');
      report.details.push(`Found ${multiSpace.length} unusual multi-space sequences`);
      cleaned = cleaned.split('\n').map((line) => {
        const stripped = line.replace(/^ +/, '');
        const leading = line.slice(0, line.length - stripped.length);
        return leading + stripped.replace(/ {2,}/g, ' ');
      }).join('\n');
      report.cleanedText = cleaned;
    }

    const lines = cleaned.split('\n');
    const trailingCount = lines.filter((l) => l !== l.replace(/ +$/, '')).length;
    if (trailingCount > 3) {
      report.watermarkTypes.push('trailing_space_steganography');
      report.details.push(`Found ${trailingCount} lines with trailing spaces`);
      report.cleanedText = lines.map((l) => l.replace(/ +$/, '')).join('\n');
    }
  }

  _detectStatistical(text, report) {
    const words = (text.toLowerCase().match(/\p{L}[\p{L}\p{N}_]*/gu) || []);
    if (words.length < 50) return;

    const endings = words.filter((w) => w.length > 3).map((w) => w.slice(-2));
    if (!endings.length) return;
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const e of endings) counts.set(e, (counts.get(e) || 0) + 1);
    const common = new Set(['ed', 'ly', 'ng', 'er', 'on', 'al', 'le', 'es', 'ts',
      'ть', 'ий', 'ый', 'ет', 'на']);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [ending, count] of top) {
      const ratio = count / endings.length;
      if (ratio > 0.15 && !common.has(ending)) {
        report.watermarkTypes.push('statistical_bias');
        report.details.push(
          `Suspicious word ending bias: '${ending}' appears in ${(ratio * 100).toFixed(1)}% of words`);
        break;
      }
    }
  }

  _detectKirchenbauer(text, report) {
    const GAMMA = 0.25;
    const THRESHOLD_Z = 4.0;

    const words = (text.toLowerCase().match(/\p{L}[\p{L}\p{N}_]*|\p{N}+/gu) || []);
    const n = words.length;
    if (n < 30) return;

    let green = 0;
    for (let i = 1; i < n; i++) {
      const seed = sha256First32(words[i - 1]);
      const h = sha256First32(`${seed}:${words[i]}`);
      if ((h % 10000) / 10000 < GAMMA) green++;
    }

    const total = n - 1;
    if (total < 1) return;
    const expected = GAMMA * total;
    const std = Math.sqrt(GAMMA * (1 - GAMMA) * total);
    if (std === 0) return;

    const z = (green - expected) / std;
    const p = 0.5 * erfc(z / Math.SQRT2);

    report.kirchenbauerScore = Math.round(z * 1000) / 1000;
    report.kirchenbauerPValue = Math.round(p * 1e6) / 1e6;

    if (z >= THRESHOLD_Z) {
      report.watermarkTypes.push('kirchenbauer_watermark');
      report.details.push(
        `Kirchenbauer green-list watermark: z=${z.toFixed(2)}, p=${p.toExponential(2)}. ` +
        `${green}/${total} tokens in green list (expected ${expected.toFixed(0)})`);
    }
  }
}

/** @param {string} text @param {string} lang */
export function detectWatermarks(text, lang = 'en') {
  return new WatermarkDetector(lang).detect(text);
}

/** @param {string} text @param {string} lang */
export function cleanWatermarks(text, lang = 'en') {
  return new WatermarkDetector(lang).clean(text);
}
