/**
 * Lexicon-based sentiment analysis (EN + RU, offline, zero-dep).
 * Handles negation and intensifiers. Not ML — a transparent heuristic.
 * @module engine/sentiment
 */

const POSITIVE = new Set([
  'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'loved', 'like', 'liked',
  'best', 'happy', 'awesome', 'perfect', 'nice', 'beautiful', 'brilliant', 'enjoy', 'enjoyed', 'pleased',
  'delighted', 'superb', 'positive', 'success', 'successful', 'win', 'winning', 'gain', 'benefit', 'helpful',
  'recommend', 'recommended', 'impressive', 'outstanding', 'favorite', 'glad', 'grateful', 'thanks', 'thank',
  'easy', 'fast', 'clear', 'strong', 'reliable', 'smooth', 'fun', 'cool', 'incredible', 'remarkable', 'joy',
  'хорош', 'отличн', 'прекрасн', 'замечательн', 'люблю', 'нравится', 'лучш', 'счастл', 'супер', 'идеальн',
  'красив', 'радост', 'спасибо', 'благодар', 'успех', 'удобн', 'быстр', 'полезн', 'рекоменд', 'восхитительн',
  'приятн', 'позитивн', 'выгодн', 'надёжн', 'надежн', 'классн', 'крут', 'великолепн', 'достойн',
]);

const NEGATIVE = new Set([
  'bad', 'terrible', 'awful', 'horrible', 'hate', 'hated', 'worst', 'sad', 'poor', 'ugly', 'disappointing',
  'disappointed', 'fail', 'failure', 'failed', 'wrong', 'broken', 'bug', 'buggy', 'slow', 'hard', 'difficult',
  'confusing', 'annoying', 'useless', 'waste', 'problem', 'problems', 'issue', 'issues', 'error', 'errors',
  'negative', 'weak', 'boring', 'nasty', 'pain', 'painful', 'angry', 'frustrating', 'frustrated', 'lousy',
  'mediocre', 'inferior', 'unreliable', 'crash', 'crashes', 'dislike', 'regret', 'scam', 'garbage', 'trash',
  'плох', 'ужасн', 'отвратительн', 'ненавиж', 'худш', 'груст', 'слаб', 'некрасив', 'разочарова', 'провал',
  'ошибк', 'сломан', 'медленн', 'сложн', 'запутан', 'раздража', 'бесполезн', 'проблем', 'скучн', 'боль',
  'зл', 'ужас', 'отстой', 'мусор', 'кошмар', 'жаль', 'негативн', 'ненадёжн', 'ненадежн', 'бесит',
]);

const NEGATIONS = new Set(['not', 'no', 'never', 'without', "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "won't", "can't", 'cannot',
  'не', 'нет', 'ни', 'без', 'нельзя']);
const INTENSIFIERS = new Set(['very', 'really', 'so', 'extremely', 'absolutely', 'totally', 'incredibly', 'super',
  'очень', 'реально', 'крайне', 'абсолютно', 'совершенно', 'ужасно', 'супер', 'слишком']);

function matchLex(word, lex) {
  if (lex.has(word)) return true;
  // Cyrillic stems: check prefix membership (e.g. "хорош" ⊂ "хороший").
  for (const stem of lex) {
    if (stem.length >= 4 && /[а-яё]/.test(stem) && word.startsWith(stem)) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @param {{lang?: string}} [opts]
 * @returns {{ polarity: number, label: 'positive'|'neutral'|'negative', positive: number, negative: number, subjectivity: number }}
 */
export function analyzeSentiment(text, opts = {}) {
  const words = (String(text || '').toLowerCase().match(/[\p{L}']+/gu) || []);
  let positive = 0;
  let negative = 0;
  let sentimentHits = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let weight = 1;
    const prev = words[i - 1];
    const prev2 = words[i - 2];
    if (prev && INTENSIFIERS.has(prev)) weight = 1.5;
    let negated = false;
    if ((prev && NEGATIONS.has(prev)) || (prev2 && NEGATIONS.has(prev2))) negated = true;

    const isPos = matchLex(w, POSITIVE);
    const isNeg = matchLex(w, NEGATIVE);
    if (!isPos && !isNeg) continue;
    sentimentHits++;
    let polar = isPos ? 1 : -1;
    if (negated) polar = -polar;
    if (polar > 0) positive += weight; else negative += weight;
  }

  const denom = positive + negative + 1;
  const polarity = round3((positive - negative) / denom);
  const label = polarity > 0.15 ? 'positive' : polarity < -0.15 ? 'negative' : 'neutral';
  const subjectivity = round3(Math.min(1, sentimentHits / Math.max(8, words.length / 8)));

  return { polarity, label, positive: Math.round(positive), negative: Math.round(negative), subjectivity };
}

function round3(n) { return Math.round((Number.isFinite(n) ? n : 0) * 1000) / 1000; }
