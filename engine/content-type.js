/**
 * Content-type classifier — determines text category for adaptive processing.
 *
 * Ported from the TextHumanize library (`texthumanize/content_classifier.py`,
 * `classify()` + `ContentType` enum). A fast, heuristic, zero-dependency
 * classifier used to route text through the right processing profile.
 *
 * Faithful categories from the Python source:
 *   code, mixed_code, article, news, tutorial, academic, chat,
 *   technical_doc, list_heavy, general.
 * Added for the browser extension (the Python enum lacks them, but the router
 * needs them): `email`, `social`, `marketing`.
 *
 * @module engine/content-type
 */

import { splitSentences } from './util.js';

// ── Regex patterns (Python \w is Unicode-aware; JS needs \p{L} + u flag) ──

const CODE_BLOCK_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INDENTED_CODE_RE = /^(?: {4}|\t).+$/gm;
const HEADING_MD_RE = /^#{1,6}\s+.+$/gm;
const HEADING_HTML_RE = /<h[1-6][^>]*>.*?<\/h[1-6]>/gi;
const BULLET_RE = /^\s*[-*•▸►]\s+.+$/gm;
const NUMBERED_RE = /^\s*\d+[.)]\s+.+$/gm;
const DATELINE_RE = /(?:^|\n)\s*(?:[A-Z]{2,}[\s,]+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Январ|Феврал|Март|Апрел|Ма[йя]|Июн|Июл|Август|Сентябр|Октябр|Ноябр|Декабр)[\p{L}\d,.\s]+\d{4}/iu;
const QUOTE_ATTR_RE = /[«"“”']\s*[^«"“”']{10,}[«"“”']\s*[,—–-]\s*(?:сказал|заявил|said|told|according)/giu;
const STEP_RE = /(?:^|\n)\s*(?:шаг|step|этап)\s*\d+|(?:^|\n)\s*(?:во-первых|во-вторых|в-третьих|firstly|secondly|thirdly)|(?:^|\n)\s*\d+\.\s+(?:Install|Set up|Create|Open|Run|Configure|Add|Установ|Создай|Откр|Запуст|Настро|Добав)/gimu;
const CITATION_RE = /\[\d+\]|\([A-ZА-Я][a-zа-яёA-Za-z]+\s+et\s+al\.?\s*,?\s*\d{4}\)|[A-ZА-Я][a-zа-яёA-Za-z]+\s+et\s+al\.\s*\(\d{4}\)|\([A-ZА-Я][a-zа-яёA-Za-z]+(?:\s*(?:&|и|,|and)\s*[A-ZА-Я][a-zа-яёA-Za-z]+)*\s*,?\s*\d{4}\)|\((?:и\s*др|и\s+другие)[.,]?\s*,?\s*\d{4}\)/gu;
const ABSTRACT_RE = /(?:^|\n)\s*(?:abstract|аннотация|анотація|резюме)\s*[:.]/iu;
const API_DOC_RE = /(?:Parameters|Returns|Raises|Args|Kwargs|Attributes|Параметры|Возвращает|Аргументы)\s*[:\n]/iu;
const FUNCTION_SIG_RE = /(?:def|function|func|fn|class|struct|interface|type)\s+\w+\s*\(/g;
const CODE_KW_RE = /\b(?:def|class|import|from|return|if|elif|else|for|while|try|except|function|const|let|var|async|await|export|require|public|private|protected|static|void|int|string|bool|func|struct|impl|trait|match|enum|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN)\b/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
// Broad emoji coverage (wider than the Python source so pictographs like
// 🎉/🔥 in 1F300–1F5FF are caught for social detection).
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu;

// ── Extension-only signals: email / social / marketing ──
const EMAIL_GREETING_RE = /(?:^|\n)\s*(?:dear|hi|hello|hey|greetings|уважаем\w*|шановн\w*|привет|привіт|здравствуйте)\b[^\n]{0,40}[,:]/iu;
const EMAIL_SIGNOFF_RE = /\b(?:best regards|kind regards|warm regards|best wishes|kind wishes|sincerely(?:\s+yours)?|yours (?:truly|sincerely|faithfully)|best,|cheers|many thanks|thanks(?:,| again| in advance)|thank you|talk soon|looking forward to hearing|с уважением|с наилучшими пожеланиями|заранее (?:спасибо|благодарю))\b/iu;
const EMAIL_SUBJECT_RE = /(?:^|\n)\s*(?:subject|re|fwd|тема)\s*:/i;
const HASHTAG_RE = /(?:^|\s)#[\p{L}0-9_]+/gu;
const MENTION_RE = /(?:^|\s)@[A-Za-z0-9_.]+/g;
const MARKETING_CTA_RE = /\b(?:buy now|shop now|sign[- ]?up|order (?:now|today)|get started(?: today)?|limited[- ]time|act now|don'?t miss|free trial|start(?:ing)? (?:free|today)|subscribe|save \d+%|\d+% off|exclusive offer|special offer|claim your|register now|book (?:now|a demo)|try it free)\b/gi;
const MARKETING_HYPE_RE = /\b(?:amazing|incredible|revolutionary|game[- ]chang\w+|best[- ]in[- ]class|unbeatable|ultimate|exclusive|unlock|supercharge|skyrocket|transform your)\b/gi;

/** @param {string|RegExp} re @param {string} text @returns {number} match count. */
function countMatches(text, re) {
  const rx = re instanceof RegExp && re.global ? re : new RegExp(re, 'g');
  return (text.match(rx) || []).length;
}

/**
 * Processing hints per content type. Mirrors `_apply_processing_hints`,
 * extended for email/social/marketing.
 * @type {Record<string, {protectStructure:boolean, protectWhitespace:boolean, allowParaphrase:boolean, allowSyntaxRewrite:boolean, maxIntensityCap:number, profile:string}>}
 */
const TYPE_HINTS = {
  code: { protectStructure: true, protectWhitespace: true, allowParaphrase: false, allowSyntaxRewrite: false, maxIntensityCap: 20, profile: 'docs' },
  mixed_code: { protectStructure: true, protectWhitespace: true, allowParaphrase: true, allowSyntaxRewrite: true, maxIntensityCap: 60, profile: 'docs' },
  article: { protectStructure: true, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: true, maxIntensityCap: 80, profile: 'web' },
  news: { protectStructure: true, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: true, maxIntensityCap: 70, profile: 'web' },
  tutorial: { protectStructure: true, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: false, maxIntensityCap: 65, profile: 'docs' },
  academic: { protectStructure: true, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: false, maxIntensityCap: 55, profile: 'academic' },
  chat: { protectStructure: false, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: true, maxIntensityCap: 80, profile: 'chat' },
  technical_doc: { protectStructure: true, protectWhitespace: true, allowParaphrase: true, allowSyntaxRewrite: false, maxIntensityCap: 50, profile: 'docs' },
  list_heavy: { protectStructure: true, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: false, maxIntensityCap: 65, profile: 'web' },
  email: { protectStructure: true, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: true, maxIntensityCap: 75, profile: 'email' },
  social: { protectStructure: false, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: true, maxIntensityCap: 80, profile: 'social' },
  marketing: { protectStructure: false, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: true, maxIntensityCap: 75, profile: 'marketing' },
  general: { protectStructure: false, protectWhitespace: false, allowParaphrase: true, allowSyntaxRewrite: true, maxIntensityCap: 80, profile: 'web' },
};

/** @param {number} x @returns {number} */
function clamp1(x) {
  return Math.min(1, x);
}

/**
 * Classify text content type.
 *
 * @param {string} text Input text.
 * @param {object} [opts]
 * @param {string} [opts.lang='en'] Language code.
 * @param {object|null} [opts.langPack] Language pack (reserved; not required).
 * @returns {{ type: string, confidence: number, signals: object, suggestedProfile: string }}
 */
export function classifyContent(text, { lang = 'en', langPack = null } = {}) {
  void langPack; // reserved for future language-specific tuning
  if (!text || text.trim().length < 20) {
    return {
      type: 'general',
      confidence: 0.5,
      signals: { scores: { general: 0.5 }, ...TYPE_HINTS.general },
      suggestedProfile: TYPE_HINTS.general.profile,
    };
  }

  const textLen = Math.max(text.length, 1);
  const lines = text.split('\n');
  const nLines = Math.max(lines.length, 1);
  const words = text.split(/\s+/).filter(Boolean);
  const nWords = Math.max(words.length, 1);

  // ── Structural feature extraction ──
  const codeBlocks = text.match(CODE_BLOCK_RE) || [];
  const codeBlockChars = codeBlocks.reduce((n, b) => n + b.length, 0);
  const codeBlockRatio = codeBlockChars / textLen;

  const textNoCode = text.replace(CODE_BLOCK_RE, '');
  const indentedLines = countMatches(textNoCode, INDENTED_CODE_RE);
  const indentedRatio = indentedLines / nLines;

  const codeKwMatches = countMatches(textNoCode, CODE_KW_RE);
  const codeKwRatio = codeKwMatches / nWords;

  const inlineCode = countMatches(text, INLINE_CODE_RE);
  const inlineCodeRatio = inlineCode / nWords;

  const headingCount = countMatches(text, HEADING_MD_RE) + countMatches(text, HEADING_HTML_RE);

  const bullets = countMatches(text, BULLET_RE);
  const numbered = countMatches(text, NUMBERED_RE);
  const listItems = bullets + numbered;
  const listRatio = listItems / nLines;

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const nParagraphs = Math.max(paragraphs.length, 1);
  const avgParaWords = paragraphs.reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0) / nParagraphs;

  const sentences = splitSentences(text);
  const nSentences = Math.max(sentences.length, 1);
  const avgSentWords = nWords / nSentences;
  const sentLengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const shortSents = sentLengths.filter((sl) => sl < 8).length;
  const shortSentRatio = shortSents / nSentences;

  const emojiCount = countMatches(text, EMOJI_RE);
  const hashtagCount = countMatches(text, HASHTAG_RE);
  const mentionCount = countMatches(text, MENTION_RE);

  const lowerText = text.toLowerCase();

  // ── Category scores ──
  /** @type {Record<string, number>} */
  const scores = {};

  // CODE
  let code = 0;
  if (codeBlockRatio > 0.6) code += 0.7;
  else if (codeBlockRatio > 0.3) code += 0.4;
  if (indentedRatio > 0.4) code += 0.3;
  if (codeKwRatio > 0.08) code += 0.3;
  else if (codeKwRatio > 0.04) code += 0.15;
  const braceCount = countMatches(text, /[{};]/g);
  if (braceCount / textLen > 0.02) code += 0.2;
  scores.code = clamp1(code);

  // MIXED_CODE
  let mixed = 0;
  if (codeBlockRatio > 0.05 && codeBlockRatio < 0.6) mixed += 0.4;
  if (inlineCodeRatio > 0.02) mixed += 0.2;
  if (headingCount >= 1 && codeBlockRatio > 0.05) mixed += 0.2;
  if (listItems > 0 && codeBlockRatio > 0.05) mixed += 0.1;
  scores.mixed_code = clamp1(mixed);

  // ARTICLE
  let article = 0;
  if (headingCount >= 2) article += 0.3;
  else if (headingCount === 1) article += 0.15;
  if (nParagraphs >= 3 && avgParaWords > 30) article += 0.3;
  if (avgSentWords >= 12 && avgSentWords <= 30) article += 0.2;
  if (listItems > 0 && listRatio < 0.3) article += 0.1;
  scores.article = clamp1(article);

  // NEWS
  let news = 0;
  if (DATELINE_RE.test(text)) news += 0.35;
  if (countMatches(text, QUOTE_ATTR_RE) > 0) news += 0.25;
  if (avgParaWords < 40 && nParagraphs >= 3) news += 0.15;
  if (headingCount <= 1) news += 0.1;
  scores.news = clamp1(news);

  // TUTORIAL
  let tutorial = 0;
  if (countMatches(text, STEP_RE) > 0) tutorial += 0.4;
  if (numbered >= 3) tutorial += 0.2;
  if (headingCount >= 2) tutorial += 0.15;
  const impWords = ['install', 'create', 'open', 'run', 'add', 'set', 'click', 'type', 'select', 'copy', 'paste', 'go',
    'установите', 'создайте', 'откройте', 'запустите', 'добавьте', 'настройте', 'выберите', 'скопируйте', 'нажмите', 'введите', 'перейдите'];
  const impCount = impWords.filter((w) => lowerText.includes(w)).length;
  if (impCount >= 3) tutorial += 0.2;
  scores.tutorial = clamp1(tutorial);

  // ACADEMIC
  let academic = 0;
  const citations = countMatches(text, CITATION_RE);
  if (citations >= 2) academic += 0.4;
  else if (citations === 1) academic += 0.2;
  if (ABSTRACT_RE.test(text)) academic += 0.3;
  if (avgSentWords > 20) academic += 0.15;
  const formalMarkers = ['furthermore', 'moreover', 'consequently', 'thus', 'hence', 'hereby', 'notwithstanding', 'aforementioned',
    'кроме того', 'более того', 'следовательно', 'таким образом', 'вышеизложенное', 'нижеследующий'];
  const formalCount = formalMarkers.filter((m) => lowerText.includes(m)).length;
  if (formalCount >= 3) academic += 0.15;
  scores.academic = clamp1(academic);

  // CHAT
  let chat = 0;
  if (emojiCount >= 2) chat += 0.3;
  else if (emojiCount === 1) chat += 0.15;
  if (shortSentRatio > 0.6) chat += 0.25;
  if (avgSentWords < 10) chat += 0.2;
  const exclRate = countMatches(text, /!/g) / textLen;
  const questRate = countMatches(text, /\?/g) / textLen;
  if (exclRate > 0.005 || questRate > 0.005) chat += 0.15;
  if (nWords < 100) chat += 0.1;
  // Two or more hashtags mark a public social post, not a private chat —
  // cap chat so the more specific `social` category wins the tie.
  if (hashtagCount >= 2) chat = Math.min(chat, 0.5);
  scores.chat = clamp1(chat);

  // TECHNICAL_DOC
  let tech = 0;
  if (API_DOC_RE.test(text)) tech += 0.35;
  const funcSigs = countMatches(textNoCode, FUNCTION_SIG_RE);
  if (funcSigs >= 2) tech += 0.25;
  if (inlineCodeRatio > 0.03) tech += 0.15;
  if (headingCount >= 3) tech += 0.1;
  scores.technical_doc = clamp1(tech);

  // LIST_HEAVY
  let listHeavy = 0;
  if (listRatio > 0.4) listHeavy += 0.5;
  else if (listRatio > 0.25) listHeavy += 0.3;
  if (listItems >= 5) listHeavy += 0.2;
  scores.list_heavy = clamp1(listHeavy);

  // EMAIL (extension-only)
  let email = 0;
  const hasGreeting = EMAIL_GREETING_RE.test(text);
  const hasSignoff = EMAIL_SIGNOFF_RE.test(text);
  if (hasGreeting) email += 0.4;
  if (hasSignoff) email += 0.4;
  if (EMAIL_SUBJECT_RE.test(text)) email += 0.15;
  scores.email = clamp1(email);

  // SOCIAL (extension-only)
  let social = 0;
  if (hashtagCount >= 2) social += 0.45;
  else if (hashtagCount === 1) social += 0.25;
  if (mentionCount >= 1) social += 0.25;
  if (emojiCount >= 1) social += 0.2;
  if (nWords < 60) social += 0.15;
  // Hashtag + mention/emoji together is the hallmark of a social post.
  if (hashtagCount >= 1 && (mentionCount >= 1 || emojiCount >= 1)) social += 0.15;
  scores.social = clamp1(social);

  // MARKETING (extension-only)
  let marketing = 0;
  const ctaCount = countMatches(text, MARKETING_CTA_RE);
  if (ctaCount >= 2) marketing += 0.4;
  else if (ctaCount === 1) marketing += 0.2;
  const hypeCount = countMatches(text, MARKETING_HYPE_RE);
  if (hypeCount >= 2 && exclRate > 0.003) marketing += 0.2;
  else if (hypeCount >= 1) marketing += 0.1;
  scores.marketing = clamp1(marketing);

  // GENERAL baseline
  scores.general = 0.15;

  // ── Winner selection ──
  let bestType = 'general';
  let bestScore = -Infinity;
  for (const [t, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; bestType = t; }
  }

  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  let confidence;
  if (sortedScores.length >= 2) {
    const gap = sortedScores[0] - sortedScores[1];
    confidence = clamp1(bestScore * 0.6 + gap * 0.4 + 0.1);
  } else {
    confidence = clamp1(bestScore);
  }

  const hints = TYPE_HINTS[bestType] || TYPE_HINTS.general;

  const signals = {
    scores,
    codeBlockRatio: round4(codeBlockRatio),
    headingCount,
    listItemCount: listItems,
    paragraphCount: nParagraphs,
    avgParagraphWords: round4(avgParaWords),
    avgSentenceWords: round4(avgSentWords),
    shortSentenceRatio: round4(shortSentRatio),
    emojiCount,
    hashtagCount,
    mentionCount,
    citationCount: countMatches(text, CITATION_RE),
    lang,
    protectStructure: hints.protectStructure,
    protectWhitespace: hints.protectWhitespace,
    allowParaphrase: hints.allowParaphrase,
    allowSyntaxRewrite: hints.allowSyntaxRewrite,
    maxIntensityCap: hints.maxIntensityCap,
  };

  return {
    type: bestType,
    confidence: round4(confidence),
    signals,
    suggestedProfile: hints.profile,
  };
}

/** @param {number} x @returns {number} */
function round4(x) {
  return Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : 0;
}
