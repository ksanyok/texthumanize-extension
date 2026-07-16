/**
 * Language detection — trigram + marker based.
 * Faithful port of texthumanize/lang_detect.py.
 * @module engine/lang-detect
 */

import { TRIGRAMS } from './trigrams.gen.js';

/** @param {string} text @param {number} limit */
function extractTrigrams(text, limit = 300) {
  const t = text.toLowerCase().slice(0, 5000);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (let i = 0; i < t.length - 2; i++) {
    const tri = t.slice(i, i + 3);
    if (tri.trim()) counts.set(tri, (counts.get(tri) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return new Map(sorted);
}

/** @param {string} text */
function cyrillicRatio(text) {
  if (!text) return 0;
  let cyr = 0;
  let alpha = 0;
  for (const c of text) {
    if (c >= 'Ѐ' && c <= 'ӿ') cyr++;
    if (/\p{L}/u.test(c)) alpha++;
  }
  return alpha > 0 ? cyr / alpha : 0;
}

const UK_CHARS = new Set(['і', 'ї', 'є', 'ґ']);
const UK_MARKERS = [
  ' є ', ' та ', ' або ', ' що ', ' як ', ' бо ', ' але ',
  ' цей ', ' ця ', ' це ', ' ці ', ' від ', ' між ', ' під ',
  ' щоб ', ' якщо ', ' тому ', ' також ', ' ще ', ' вже ',
  ' їх ', ' його ', ' її ', ' наш ', ' ваш ', ' який ',
  ' яка ', ' яке ', ' які ',
];

const RU_CHARS = new Set(['ё', 'ы', 'э', 'ъ']);
const RU_MARKERS = [
  ' это ', ' что ', ' как ', ' но ', ' или ', ' для ',
  ' если ', ' уже ', ' ещё ', ' еще ', ' тоже ', ' также ',
  ' только ', ' он ', ' она ', ' они ', ' мы ', ' вы ',
  ' его ', ' её ', ' ее ', ' их ', ' был ', ' были ',
  ' будет ', ' может ', ' этот ', ' эта ', ' эти ',
  ' который ', ' которая ', ' которые ',
];

/** @param {string} textLower */
function hasUkrainianMarkers(textLower) {
  let charHits = 0;
  for (const c of textLower) if (UK_CHARS.has(c)) charHits++;
  if (charHits > 2) return true;
  let markerHits = 0;
  for (const m of UK_MARKERS) if (textLower.includes(m)) markerHits++;
  return markerHits >= 3;
}

/** @param {string} textLower */
function hasRussianMarkers(textLower) {
  let charHits = 0;
  for (const c of textLower) if (RU_CHARS.has(c)) charHits++;
  if (charHits > 1) return true;
  let markerHits = 0;
  for (const m of RU_MARKERS) if (textLower.includes(m)) markerHits++;
  return markerHits >= 3;
}

const LATIN_MARKERS = {
  de: [' und ', ' der ', ' die ', ' das ', ' ist ', ' ein ', ' eine ',
    ' nicht ', ' mit ', ' auf ', ' für ', ' von ', ' werden ',
    ' haben ', ' sich ', ' sind ', ' auch ', ' nach ', ' wird ',
    ' über ', ' aber ', ' oder ', ' noch ', ' kann '],
  fr: [' les ', ' des ', ' une ', ' est ', ' dans ', ' pour ',
    ' que ', ' qui ', ' pas ', ' sur ', ' avec ', ' sont ',
    ' mais ', ' par ', ' nous ', ' vous ', ' cette ', ' tout ',
    ' plus ', ' elle ', ' être ', ' avoir ', ' fait ',
    " c'est ", " l'on ", " qu'il ", " n'est "],
  es: [' los ', ' las ', ' una ', ' del ', ' por ', ' con ',
    ' para ', ' que ', ' pero ', ' como ', ' más ', ' ser ',
    ' este ', ' esta ', ' esto ', ' son ', ' han ', ' hay ',
    ' todo ', ' puede ', ' muy ', ' también ', ' sobre ',
    ' entre ', ' cuando ', ' donde ', ' porque '],
  pl: [' nie ', ' jest ', ' się ', ' na ', ' to ', ' że ',
    ' ale ', ' jak ', ' lub ', ' dla ', ' ich ', ' był ',
    ' może ', ' tylko ', ' być ', ' został ', ' przez ',
    ' które ', ' który ', ' która ', ' można ', ' bardzo ',
    ' są ', ' było ', ' będzie '],
  pt: [' não ', ' uma ', ' para ', ' com ', ' são ', ' dos ',
    ' das ', ' nos ', ' nas ', ' mais ', ' pelo ', ' pela ',
    ' como ', ' pode ', ' também ', ' muito ', ' sobre ',
    ' entre ', ' quando ', ' onde ', ' porque ', ' ainda ',
    ' tem ', ' já ', ' seu ', ' sua ', ' isso ', ' esta '],
  it: [' gli ', ' delle ', ' della ', ' dello ', ' nella ',
    ' sono ', ' che ', ' per ', ' con ', ' una ',
    ' questo ', ' questa ', ' anche ', ' come ', ' può ',
    ' più ', ' molto ', ' tutto ', ' ogni ', ' fra ',
    ' essere ', ' avere ', ' fatto ', ' stato ',
    ' perché ', ' quando ', ' dove ', ' quale '],
  en: [' the ', ' and ', ' that ', ' have ', ' for ', ' are ',
    ' with ', ' this ', ' from ', ' they ', ' been ',
    ' which ', ' their ', ' would ', ' there ', ' about ',
    ' could ', ' other ', ' into ', ' than ', ' these ',
    ' its ', ' were ', ' will ', ' does ', ' should '],
  tr: [' bir ', ' ve ', ' bu ', ' için ', ' ile ', ' da ',
    ' de ', ' olan ', ' gibi ', ' daha ', ' çok ', ' var ',
    ' ancak ', ' ama ', ' hem ', ' kadar ', ' olarak ',
    ' sonra ', ' önce ', ' ayrıca ', ' dolayısıyla '],
};

/** @param {string} text */
function trigramFallback(text, threshold) {
  const trigrams = extractTrigrams(text);
  /** @type {Record<string, number>} */
  const scores = {};
  for (const [code, list] of Object.entries(TRIGRAMS)) {
    let score = 0;
    for (const tri of list) score += trigrams.get(tri) || 0;
    scores[code] = score;
  }
  let best = null;
  let bestScore = -1;
  for (const [code, score] of Object.entries(scores)) {
    if (score > bestScore) { best = code; bestScore = score; }
  }
  if (best !== null && bestScore > threshold) return best;
  return null;
}

/** @param {string} text */
function detectLatinLanguage(text) {
  const textLower = text.toLowerCase();
  /** @type {Record<string, number>} */
  const scores = {};

  let deScore = 0;
  for (const c of 'äöü') deScore += countChar(textLower, c);
  deScore += countChar(textLower, 'ß') * 3;
  deScore += markerScore(textLower, LATIN_MARKERS.de);
  scores.de = deScore;

  let frScore = 0;
  for (const c of 'éèêëçàùîô') frScore += countChar(textLower, c);
  frScore += markerScore(textLower, LATIN_MARKERS.fr);
  scores.fr = frScore;

  let esScore = 0;
  esScore += countChar(textLower, 'ñ') * 3;
  esScore += countChar(text, '¿') * 3;
  esScore += countChar(text, '¡') * 3;
  esScore += markerScore(textLower, LATIN_MARKERS.es);
  scores.es = esScore;

  let plScore = 0;
  for (const c of 'ąęśźżłńć') plScore += countChar(textLower, c) * 2;
  plScore += markerScore(textLower, LATIN_MARKERS.pl);
  scores.pl = plScore;

  let ptScore = 0;
  ptScore += countChar(textLower, 'ã') * 2;
  ptScore += countChar(textLower, 'õ') * 2;
  ptScore += countChar(textLower, 'ç');
  ptScore += markerScore(textLower, LATIN_MARKERS.pt);
  scores.pt = ptScore;

  scores.it = markerScore(textLower, LATIN_MARKERS.it);
  scores.en = markerScore(textLower, LATIN_MARKERS.en);

  let trScore = 0;
  for (const c of 'şğı') trScore += countChar(textLower, c) * 3;
  for (const c of 'çöü') trScore += countChar(textLower, c);
  trScore += markerScore(textLower, LATIN_MARKERS.tr);
  scores.tr = trScore;

  const maxScore = Math.max(...Object.values(scores));

  if (maxScore < 4) {
    return trigramFallback(text, 5) || 'en';
  }

  let bestLang = 'en';
  let best = -1;
  for (const [code, score] of Object.entries(scores)) {
    if (score > best) { bestLang = code; best = score; }
  }

  if (best < 6) {
    const trigrams = extractTrigrams(text);
    let totalTri = 0;
    for (const v of trigrams.values()) totalTri += v;
    const byTri = trigramFallback(text, totalTri * 0.05);
    return byTri || 'en';
  }

  return bestLang;
}

function countChar(text, ch) {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}

function markerScore(textLower, markers) {
  let score = 0;
  for (const m of markers) if (textLower.includes(m)) score += 2;
  return score;
}

/**
 * Detect the language of a text.
 * Supports ru, uk, en, de, fr, es, pl, pt, it, ar, zh, ja, ko, tr (+ 'en' fallback).
 * @param {string} text
 * @returns {string} language code
 */
export function detectLanguage(text) {
  if (!text || text.trim().length < 10) return 'en';

  const padded = ' ' + text + ' ';

  let arabic = 0;
  let cjk = 0;
  let hiragana = 0;
  let katakana = 0;
  let hangul = 0;
  let alpha = 0;
  for (const c of padded) {
    const cp = c.codePointAt(0);
    if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0x0750 && cp <= 0x077F) ||
        (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) arabic++;
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
        (cp >= 0xF900 && cp <= 0xFAFF)) cjk++;
    if (cp >= 0x3040 && cp <= 0x309F) hiragana++;
    if (cp >= 0x30A0 && cp <= 0x30FF) katakana++;
    if ((cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x1100 && cp <= 0x11FF) ||
        (cp >= 0x3130 && cp <= 0x318F)) hangul++;
    if (/\p{L}/u.test(c)) alpha++;
  }
  alpha = alpha || 1;

  if (arabic / alpha > 0.3) return 'ar';
  if (hangul / alpha > 0.3) return 'ko';
  if ((hiragana + katakana) / alpha > 0.15) return 'ja';
  if (cjk / alpha > 0.3) return 'zh';

  const cyrRatio = cyrillicRatio(padded);
  const textLower = padded.toLowerCase();

  if (cyrRatio > 0.5) {
    if (hasUkrainianMarkers(textLower)) return 'uk';
    if (hasRussianMarkers(textLower)) return 'ru';
    const trigrams = extractTrigrams(padded);
    const score = (code) => {
      let s = 0;
      for (const tri of TRIGRAMS[code] || []) s += trigrams.get(tri) || 0;
      return s;
    };
    return score('uk') > score('ru') * 1.1 ? 'uk' : 'ru';
  }

  if (cyrRatio > 0.1) {
    return hasUkrainianMarkers(textLower) ? 'uk' : 'ru';
  }

  return detectLatinLanguage(padded);
}
