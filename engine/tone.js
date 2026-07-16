/**
 * Tone analyzer and adjuster.
 *
 * Detects the tone of a text (formal, academic, professional, neutral,
 * friendly, casual, marketing) and can nudge it toward a target tone.
 *
 * Ported from the TextHumanize library (`texthumanize/tone.py`), extended
 * with additional formality signals (passive voice, 1st/2nd-person
 * pronouns, exclamations, emoji) and optional language-pack enrichment.
 *
 * Pure ES module, zero dependencies. Works with `langPack === null`.
 * @module engine/tone
 */

import { Rng, escapeRegex, matchCase, splitSentences } from './util.js';

/**
 * Tone levels — mirrors the Python `ToneLevel` enum (source of truth).
 * @readonly
 * @enum {string}
 */
export const TONE_LEVELS = Object.freeze({
  FORMAL: 'formal',
  ACADEMIC: 'academic',
  PROFESSIONAL: 'professional',
  NEUTRAL: 'neutral',
  FRIENDLY: 'friendly',
  CASUAL: 'casual',
  MARKETING: 'marketing',
});

// ═══════════════════════════════════════════════════════════════
//  FORMALITY MARKERS (ported verbatim from tone.py)
// ═══════════════════════════════════════════════════════════════

/**
 * Per-language marker categories. Categories: very_formal, formal,
 * informal, subjective, academic, marketing.
 * @type {Record<string, Record<string, string[]>>}
 */
const FORMAL_MARKERS = {
  en: {
    very_formal: [
      'herein', 'thereof', 'whereby', 'aforementioned', 'notwithstanding',
      'pursuant', 'hereunder', 'hitherto', 'therein', 'theretofore',
      'inasmuch', 'heretofore', 'whomsoever', 'insofar',
    ],
    formal: [
      'consequently', 'furthermore', 'moreover', 'nevertheless',
      'accordingly', 'subsequently', 'pertaining', 'regarding',
      'concerning', 'facilitate', 'commence', 'endeavor',
      'implement', 'utilize', 'constitute', 'demonstrate',
      'establish', 'incorporate', 'subsequent', 'prior to',
      'in accordance with', 'with respect to', 'in regard to',
    ],
    informal: [
      'gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'dunno',
      'yeah', 'yep', 'nope', 'hey', 'oh', 'wow', 'huh',
      'ok', 'okay', 'stuff', 'thing', 'things', 'like',
      'basically', 'literally', 'actually', 'pretty',
      'awesome', 'cool', 'super', 'totally', 'honestly',
      'damn', 'hell', 'crap', 'mess', 'weird', 'crazy',
    ],
    subjective: [
      'i think', 'i believe', 'in my opinion', 'i feel',
      'it seems', 'perhaps', 'maybe', 'probably', 'possibly',
      'hopefully', 'unfortunately', 'surprisingly', 'obviously',
      'clearly', 'certainly', 'definitely', 'absolutely',
      'amazing', 'terrible', 'wonderful', 'horrible',
      'fantastic', 'awful', 'brilliant', 'stunning',
    ],
    academic: [
      'hypothesis', 'methodology', 'paradigm', 'empirical',
      'theoretical', 'significant', 'correlation', 'variables',
      'findings', 'literature', 'framework', 'furthermore',
      'et al', 'cf.', 'ibid', 'viz.', 'i.e.', 'e.g.',
      'in contrast', 'on the other hand', 'taken together',
      'it is worth noting', 'it should be noted',
    ],
    marketing: [
      'revolutionary', 'exclusive', 'premium', 'innovative',
      'best-in-class', 'cutting-edge', 'world-class', 'unique',
      'limited', 'free', 'guaranteed', 'proven', 'powerful',
      'effortless', 'seamless', 'transform', 'unlock',
      'supercharge', 'game-changing', 'breakthrough', 'ultimate',
      'discover', 'unleash', 'skyrocket', 'maximize',
    ],
  },
  ru: {
    very_formal: [
      'нижеследующий', 'вышеизложенный', 'нижеуказанный',
      'сим', 'настоящим', 'надлежащий', 'оный',
      'таковой', 'каковой', 'коего', 'сего',
    ],
    formal: [
      'осуществлять', 'обеспечивать', 'предусматривать',
      'регламентировать', 'следовательно', 'вследствие',
      'в соответствии с', 'ввиду', 'касательно', 'относительно',
      'содействовать', 'способствовать', 'являться',
      'представлять собой', 'в рамках', 'в целях',
    ],
    informal: [
      'прям', 'щас', 'типа', 'короче', 'ваще', 'блин',
      'фигня', 'норм', 'ок', 'лол', 'чё', 'ну',
      'вообще-то', 'кстати', 'кароче', 'прикольно',
      'классно', 'круто', 'фигово', 'реально', 'жесть',
    ],
    subjective: [
      'я думаю', 'я считаю', 'по-моему', 'мне кажется',
      'наверное', 'возможно', 'может быть', 'вероятно',
      'к сожалению', 'к счастью', 'очевидно', 'безусловно',
      'конечно', 'определённо', 'несомненно',
      'потрясающий', 'ужасный', 'замечательный', 'отвратительный',
    ],
    academic: [
      'гипотеза', 'методология', 'парадигма', 'эмпирический',
      'теоретический', 'корреляция', 'переменная', 'детерминант',
      'результаты', 'рассмотрим', 'анализ показывает',
      'следует отметить', 'необходимо подчеркнуть',
    ],
  },
  uk: {
    formal: [
      'здійснювати', 'забезпечувати', 'передбачати',
      'регламентувати', 'отже', 'внаслідок',
      'відповідно до', 'зважаючи на', 'стосовно',
      'сприяти', 'являти собою', 'в межах', 'з метою',
    ],
    informal: [
      'типу', 'короче', 'взагалі', 'блін', 'фігня',
      'норм', 'ок', 'ну', 'до речі', 'класно',
      'круто', 'реально',
    ],
    subjective: [
      'я думаю', 'я вважаю', 'на мою думку', 'мені здається',
      'мабуть', 'можливо', 'напевно', 'безумовно',
      'на жаль', 'на щастя', 'очевидно',
    ],
  },
  de: {
    formal: [
      'durchführen', 'bereitstellen', 'gewährleisten',
      'implementieren', 'diesbezüglich', 'dementsprechend',
      'folglich', 'infolgedessen', 'hinsichtlich',
      'gemäß', 'entsprechend', 'darüber hinaus',
    ],
    informal: [
      'halt', 'eben', 'quasi', 'irgendwie', 'sozusagen',
      'krass', 'geil', 'cool', 'mega', 'voll',
      'echt', 'total', 'na ja', 'also',
    ],
    subjective: [
      'ich denke', 'ich glaube', 'meiner meinung nach',
      'wahrscheinlich', 'vielleicht', 'möglicherweise',
      'offensichtlich', 'leider', 'glücklicherweise',
    ],
  },
  fr: {
    formal: [
      'effectuer', 'mettre en œuvre', 'conformément',
      'en conséquence', 'néanmoins', 'toutefois',
      'préalablement', 'notamment', 'en ce qui concerne',
      'afin de', 'dans le cadre de', 'à cet égard',
    ],
    informal: [
      'genre', 'carrément', 'trop', 'vachement', 'bof',
      'ouais', 'ben', 'bah', 'quoi', 'du coup',
      'franchement', 'grave', 'en mode', 'kiffer',
    ],
    subjective: [
      'je pense', 'je crois', 'à mon avis',
      'probablement', 'peut-être', 'évidemment',
      'malheureusement', 'heureusement', 'apparemment',
    ],
  },
  es: {
    formal: [
      'realizar', 'implementar', 'conforme a',
      'en consecuencia', 'no obstante', 'sin embargo',
      'previamente', 'asimismo', 'en lo que respecta',
      'con el fin de', 'en el marco de', 'al respecto',
    ],
    informal: [
      'mola', 'flipar', 'currar', 'tío', 'chaval',
      'guay', 'vale', 'bueno', 'pues', 'o sea',
      'es que', 'la verdad', 'en plan', 'mogollón',
    ],
    subjective: [
      'creo que', 'pienso que', 'en mi opinión',
      'probablemente', 'quizás', 'tal vez',
      'obviamente', 'desafortunadamente', 'afortunadamente',
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
//  TONE-SHIFT REPLACEMENTS (ported verbatim from tone.py)
// ═══════════════════════════════════════════════════════════════

/**
 * Replacement tables keyed by `"<from>|<to>"` direction.
 * @type {Record<string, Record<string, Record<string, string>>>}
 */
const TONE_REPLACEMENTS = {
  en: {
    'informal|formal': {
      get: 'obtain', buy: 'purchase', ask: 'inquire',
      help: 'assist', start: 'commence', end: 'conclude',
      big: 'significant', good: 'favorable', bad: 'unfavorable',
      show: 'demonstrate', need: 'require', try: 'attempt',
      'find out': 'determine', 'set up': 'establish',
      'look at': 'examine', 'think about': 'consider',
      'put off': 'postpone', 'come up with': 'devise',
      'deal with': 'address', 'go up': 'increase',
      'go down': 'decrease', 'talk about': 'discuss',
    },
    'formal|informal': {
      obtain: 'get', purchase: 'buy', inquire: 'ask',
      assist: 'help', commence: 'start', conclude: 'end',
      demonstrate: 'show', require: 'need', attempt: 'try',
      determine: 'find out', establish: 'set up',
      examine: 'look at', consider: 'think about',
      postpone: 'put off', devise: 'come up with',
      address: 'deal with', utilize: 'use',
      facilitate: 'help with', implement: 'do',
    },
  },
  ru: {
    'informal|formal': {
      'делать': 'осуществлять', 'начать': 'приступить',
      'показать': 'продемонстрировать', 'нужно': 'необходимо',
      'помочь': 'оказать содействие', 'думать': 'полагать',
      'сделать': 'выполнить', 'большой': 'значительный',
      'хороший': 'надлежащий', 'плохой': 'неудовлетворительный',
    },
    'formal|informal': {
      'осуществлять': 'делать', 'обеспечивать': 'давать',
      'необходимо': 'нужно', 'полагать': 'думать',
      'содействовать': 'помогать', 'являться': 'быть',
      'представлять собой': 'быть', 'в целях': 'чтобы',
      'в рамках': 'в', 'вследствие': 'из-за',
    },
  },
  uk: {
    'informal|formal': {
      'робити': 'здійснювати', 'почати': 'розпочати',
      'показати': 'продемонструвати', 'треба': 'необхідно',
      'допомогти': 'сприяти', 'думати': 'вважати',
      'зробити': 'виконати', 'великий': 'значний',
      'гарний': 'належний', 'поганий': 'незадовільний',
      'дати': 'надати', 'сказати': 'зазначити',
    },
    'formal|informal': {
      'здійснювати': 'робити', 'забезпечувати': 'давати',
      'необхідно': 'треба', 'вважати': 'думати',
      'сприяти': 'допомагати', 'являти собою': 'бути',
      'з метою': 'щоб', 'в межах': 'в',
      'внаслідок': 'через', 'передбачати': 'планувати',
    },
  },
  de: {
    'informal|formal': {
      'machen': 'durchführen', 'anfangen': 'beginnen',
      'zeigen': 'demonstrieren', 'brauchen': 'benötigen',
      'helfen': 'unterstützen', 'denken': 'erwägen',
      'kriegen': 'erhalten', 'kaufen': 'erwerben',
      'sagen': 'mitteilen', 'fragen': 'erkundigen',
      'gucken': 'betrachten', 'echt': 'tatsächlich',
    },
    'formal|informal': {
      'durchführen': 'machen', 'bereitstellen': 'geben',
      'benötigen': 'brauchen', 'erwägen': 'denken',
      'unterstützen': 'helfen', 'darstellen': 'sein',
      'erhalten': 'kriegen', 'erwerben': 'kaufen',
      'mitteilen': 'sagen', 'betrachten': 'gucken',
      'implementieren': 'umsetzen', 'gewährleisten': 'sicherstellen',
    },
  },
  fr: {
    'informal|formal': {
      'faire': 'effectuer', 'commencer': 'débuter',
      'montrer': 'démontrer', 'aider': 'assister',
      'penser': 'considérer', 'acheter': 'acquérir',
      'demander': 'solliciter', 'regarder': 'examiner',
      'trouver': 'identifier', 'dire': 'indiquer',
      'parler': 'communiquer', 'essayer': 'tenter',
    },
    'formal|informal': {
      'effectuer': 'faire', 'débuter': 'commencer',
      'démontrer': 'montrer', 'assister': 'aider',
      'considérer': 'penser', 'acquérir': 'acheter',
      'solliciter': 'demander', 'examiner': 'regarder',
      'identifier': 'trouver', 'indiquer': 'dire',
      'mettre en œuvre': 'faire', 'faciliter': 'aider',
    },
  },
  es: {
    'informal|formal': {
      'hacer': 'realizar', 'empezar': 'iniciar',
      'mostrar': 'demostrar', 'ayudar': 'asistir',
      'pensar': 'considerar', 'comprar': 'adquirir',
      'pedir': 'solicitar', 'mirar': 'examinar',
      'buscar': 'identificar', 'decir': 'indicar',
      'hablar': 'comunicar', 'intentar': 'procurar',
    },
    'formal|informal': {
      'realizar': 'hacer', 'iniciar': 'empezar',
      'demostrar': 'mostrar', 'asistir': 'ayudar',
      'considerar': 'pensar', 'adquirir': 'comprar',
      'solicitar': 'pedir', 'examinar': 'mirar',
      'identificar': 'buscar', 'indicar': 'decir',
      'implementar': 'hacer', 'facilitar': 'ayudar',
    },
  },
};

// ═══════════════════════════════════════════════════════════════
//  ADDITIONAL FORMALITY-SIGNAL RESOURCES (extension over tone.py)
// ═══════════════════════════════════════════════════════════════

/** 1st/2nd person pronouns per language family. @type {Record<string, string[]>} */
const PERSON_PRONOUNS = {
  en: ['i', 'we', 'you', 'me', 'us', 'my', 'your', 'our', 'mine',
    'yours', 'ours', 'myself', 'yourself', 'ourselves', "i'm", "we're",
    "you're", "i've", "we've", "you've", "i'll", "we'll", "you'll"],
  ru: ['я', 'мы', 'ты', 'вы', 'меня', 'тебя', 'нас', 'вас', 'мне',
    'тебе', 'нам', 'вам', 'мой', 'моя', 'моё', 'мои', 'твой', 'твоя',
    'наш', 'наша', 'ваш', 'ваша'],
  uk: ['я', 'ми', 'ти', 'ви', 'мене', 'тебе', 'нас', 'вас', 'мені',
    'тобі', 'нам', 'вам', 'мій', 'моя', 'твій', 'наш', 'ваш'],
  de: ['ich', 'wir', 'du', 'ihr', 'mich', 'dich', 'uns', 'euch',
    'mein', 'dein', 'unser', 'euer'],
  fr: ['je', 'nous', 'tu', 'vous', 'moi', 'toi', 'mon', 'ma', 'mes',
    'ton', 'ta', 'notre', 'votre'],
  es: ['yo', 'nosotros', 'tú', 'vosotros', 'mí', 'ti', 'mi', 'mis',
    'tu', 'tus', 'nuestro', 'vuestro'],
};

/** Rough passive-voice detectors per language family. @type {Record<string, RegExp>} */
const PASSIVE_PATTERNS = {
  en: /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ed|done|made|built|held|kept|sent|shown|known|found|given|taken|written|paid|put|set|seen|used|based|considered)\b/gi,
  ru: /\b[\wа-яё]+(?:ется|ится|уется|ируется|ались|ался|алась|ана|ено|ены|аны|ится)\b/gi,
  uk: /\b[\wа-яіїєґ]+(?:ється|ується|ались|ався|ана|ено|ені|ані)\b/gi,
};

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/** @param {number} x @param {number} [digits] */
const round = (x, digits = 4) => {
  const f = 10 ** digits;
  return Math.round((Number.isFinite(x) ? x : 0) * f) / f;
};

/**
 * Build a Unicode-safe word-boundary regexp for `term`.
 * @param {string} term @param {string} [flags]
 * @returns {RegExp}
 */
function boundaryRe(term, flags = 'giu') {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(${escapeRegex(term)})(?![\\p{L}\\p{N}_])`,
    flags,
  );
}

// ═══════════════════════════════════════════════════════════════
//  ANALYZER
// ═══════════════════════════════════════════════════════════════

/**
 * @typedef {object} ToneResult
 * @property {string} level Detected primary tone (a {@link TONE_LEVELS} value).
 * @property {number} score Strength of the detected tone (0..1).
 * @property {number} confidence Classification confidence (0..1).
 * @property {number} formalityScore Formality, 0=colloquial … 1=formal.
 * @property {object} signals Numeric sub-signals + per-tone scores + found markers.
 * @property {string[]} indicators Human-readable list of the signals that fired.
 */

/** Analyzes the tone/formality of a text. */
export class ToneAnalyzer {
  /** @param {string} [lang] */
  constructor(lang = 'en') {
    this.lang = lang;
    this.markers = FORMAL_MARKERS[lang] || FORMAL_MARKERS.en;
    this.pronouns = new Set(PERSON_PRONOUNS[lang] || PERSON_PRONOUNS.en);
    this.passiveRe = PASSIVE_PATTERNS[lang] || PASSIVE_PATTERNS.en;
  }

  /**
   * Analyze the tone of `text`.
   * @param {string} text
   * @param {{langPack?: object|null}} [opts]
   * @returns {ToneResult}
   */
  analyze(text, { langPack = null } = {}) {
    const src = String(text || '');
    const textLower = src.toLowerCase();
    const wordTokens = textLower.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
    const wordCount = wordTokens.length;
    const sentenceCount = Math.max(splitSentences(src).length, 1);

    if (wordCount < 5) {
      return {
        level: TONE_LEVELS.NEUTRAL,
        score: 0,
        confidence: 0,
        formalityScore: 0.5,
        signals: { wordCount, sentenceCount, tooShort: true },
        indicators: [],
      };
    }

    // Token frequency map for fast single-word marker counting.
    const tokenCounts = new Map();
    for (const t of wordTokens) tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);

    /** Count occurrences of a marker (phrase → substring; word → boundary). */
    const countMarker = (marker) => {
      if (marker.includes(' ') || /[^\p{L}\p{N}'’\-]/u.test(marker)) {
        // multiword or punctuated phrase → non-overlapping substring count
        let n = 0;
        let i = textLower.indexOf(marker);
        while (i !== -1) { n++; i = textLower.indexOf(marker, i + marker.length); }
        return n;
      }
      return tokenCounts.get(marker) || 0;
    };

    // Assemble marker lists, enriched from the language pack when present.
    /** @type {Record<string, string[]>} */
    const markerLists = {
      very_formal: [...(this.markers.very_formal || [])],
      formal: [...(this.markers.formal || [])],
      informal: [...(this.markers.informal || [])],
      subjective: [...(this.markers.subjective || [])],
      academic: [...(this.markers.academic || [])],
      marketing: [...(this.markers.marketing || [])],
    };
    if (langPack) {
      if (Array.isArray(langPack.colloquial_markers)) {
        markerLists.informal = dedupe([
          ...markerLists.informal,
          ...langPack.colloquial_markers.map((s) => String(s).toLowerCase()),
        ]);
      }
      if (langPack.bureaucratic && typeof langPack.bureaucratic === 'object') {
        markerLists.formal = dedupe([
          ...markerLists.formal,
          ...Object.keys(langPack.bureaucratic).map((s) => s.toLowerCase()),
        ]);
      }
    }

    /** @type {Record<string, number>} */
    const categoryCounts = {};
    /** @type {Record<string, string[]>} */
    const categoryFound = {};
    for (const [category, list] of Object.entries(markerLists)) {
      let count = 0;
      const found = [];
      for (const marker of list) {
        const occ = countMarker(marker);
        if (occ > 0) { count += occ; found.push(marker); }
      }
      categoryCounts[category] = count;
      categoryFound[category] = found;
    }

    // ─── Formality (ported core) ───
    const formalScore =
      (categoryCounts.very_formal || 0) * 3 +
      (categoryCounts.formal || 0) * 2 +
      (categoryCounts.academic || 0) * 2;
    const informalScore = (categoryCounts.informal || 0) * 2;
    let formality = formalScore / (formalScore + informalScore + 1);

    // Average word length nudge.
    const avgWordLen =
      wordTokens.reduce((s, w) => s + w.length, 0) / wordCount;
    if (avgWordLen > 6) formality = Math.min(formality + 0.1, 1.0);
    else if (avgWordLen < 4.5) formality = Math.max(formality - 0.1, 0.0);

    // Contractions → informality.
    const contractions = (src.match(/[\p{L}]+['’][\p{L}]+/gu) || []).length;
    const contractionRatio = contractions / wordCount;
    if (contractionRatio > 0.02) formality = Math.max(formality - 0.15, 0.0);

    // ─── Extended signals (not in tone.py) ───
    const exclamationCount = (src.match(/!/g) || []).length;
    const exclamationRate = exclamationCount / sentenceCount;
    const questionCount = (src.match(/\?/g) || []).length;
    const emojiCount = (src.match(EMOJI_RE) || []).length;

    let personCount = 0;
    for (const [tok, n] of tokenCounts) if (this.pronouns.has(tok)) personCount += n;
    const personRatio = personCount / wordCount;

    this.passiveRe.lastIndex = 0;
    const passiveCount = (src.match(this.passiveRe) || []).length;
    const passiveRatio = passiveCount / sentenceCount;

    if (exclamationRate > 0.3) formality = Math.max(formality - 0.05, 0.0);
    if (emojiCount > 0) formality = Math.max(formality - 0.1, 0.0);
    if (personRatio > 0.05) formality = Math.max(formality - Math.min(0.1, personRatio * 0.5), 0.0);
    if (passiveRatio > 0) formality = Math.min(formality + Math.min(0.1, passiveRatio * 0.2), 1.0);
    formality = clamp(formality, 0, 1);

    // ─── Subjectivity ───
    const subjectivity = Math.min(
      (categoryCounts.subjective || 0) / Math.max(wordCount / 50, 1),
      1.0,
    );

    // ─── Per-tone scores (ported) ───
    /** @type {Record<string, number>} */
    const scores = {};
    scores.formal = formality;
    scores.academic = Math.min(
      (categoryCounts.academic || 0) / Math.max(wordCount / 100, 1), 1.0);
    scores.marketing = Math.min(
      (categoryCounts.marketing || 0) / Math.max(wordCount / 80, 1), 1.0);
    scores.casual = 1.0 - formality;
    scores.friendly = Math.max(0, Math.min(0.7 - formality + subjectivity * 0.3, 1.0));
    scores.neutral = 1.0 - Math.max(formality, subjectivity, scores.marketing);
    scores.professional = Math.max(0, formality * 0.7 + (1 - subjectivity) * 0.3);

    // Primary tone = argmax, tie-break by Python dict insertion order.
    const order = ['formal', 'academic', 'marketing', 'casual', 'friendly', 'neutral', 'professional'];
    let level = 'neutral';
    let best = -Infinity;
    for (const k of order) {
      if (scores[k] > best) { best = scores[k]; level = k; }
    }
    if (!Object.values(TONE_LEVELS).includes(level)) level = TONE_LEVELS.NEUTRAL;

    // Confidence from the gap between the top two scores.
    const sorted = Object.values(scores).sort((a, b) => b - a);
    let confidence = 0;
    if (sorted.length >= 2) confidence = Math.min((sorted[0] - sorted[1]) * 2 + 0.3, 1.0);

    // ─── Indicators ───
    const indicators = [];
    for (const cat of ['very_formal', 'formal', 'academic', 'marketing', 'informal', 'subjective']) {
      const found = categoryFound[cat];
      if (found && found.length) indicators.push(`${cat}: ${found.slice(0, 6).join(', ')}`);
    }
    if (contractionRatio > 0.02) indicators.push('contraction-heavy');
    if (emojiCount > 0) indicators.push(`emoji (${emojiCount})`);
    if (exclamationRate > 0.3) indicators.push('exclamation-heavy');
    if (personRatio > 0.05) indicators.push('1st/2nd-person pronouns');
    if (passiveRatio > 0) indicators.push(`passive voice (${passiveCount})`);

    return {
      level,
      score: round(scores[level] ?? 0),
      confidence: round(confidence),
      formalityScore: round(formality),
      signals: {
        formality: round(formality),
        subjectivity: round(subjectivity),
        confidence: round(confidence),
        wordCount,
        sentenceCount,
        avgWordLength: round(avgWordLen, 3),
        avgSentenceLength: round(wordCount / sentenceCount, 3),
        contractions,
        contractionRatio: round(contractionRatio, 3),
        exclamationCount,
        exclamationRate: round(exclamationRate, 3),
        questionCount,
        emojiCount,
        firstSecondPerson: personCount,
        firstSecondPersonRatio: round(personRatio, 3),
        passiveCount,
        passiveRatio: round(passiveRatio, 3),
        formalMarkerScore: formalScore,
        informalMarkerScore: informalScore,
        markerCounts: categoryCounts,
        markers: categoryFound,
        scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, round(v)])),
      },
      indicators,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
//  ADJUSTER
// ═══════════════════════════════════════════════════════════════

/** Nudges a text toward a target tone by swapping formal/informal words. */
export class ToneAdjuster {
  /** @param {string} [lang] @param {number} [seed] */
  constructor(lang = 'en', seed = 0) {
    this.lang = lang;
    this.replacements = TONE_REPLACEMENTS[lang] || {};
    this.analyzer = new ToneAnalyzer(lang);
    this.rng = new Rng(seed);
  }

  /**
   * Adjust the tone of `text` toward `target`.
   * @param {string} text
   * @param {string} [target] Target tone (a {@link TONE_LEVELS} value or alias).
   * @param {{langPack?: object|null, intensity?: number}} [opts]
   * @returns {{text: string, changes: Array<{from: string, to: string, direction: string}>}}
   */
  adjust(text, target = TONE_LEVELS.NEUTRAL, { langPack = null, intensity = 0.5 } = {}) {
    const src = String(text || '');
    /** @type {Array<{from: string, to: string, direction: string}>} */
    const changes = [];

    const report = this.analyzer.analyze(src, { langPack });
    const current = report.level;
    const tgt = ToneAdjuster._normalizeLevel(target);
    if (current === tgt) return { text: src, changes };

    const dir = ToneAdjuster._getDirection(current, tgt);
    if (!dir) return { text: src, changes };

    const table = this.replacements[`${dir[0]}|${dir[1]}`];
    if (!table) return { text: src, changes };

    let result = src;
    let made = 0;
    const wordCount = (src.match(/\S+/g) || []).length;
    const maxChanges = Math.max(1, Math.floor(wordCount * intensity * 0.1));

    for (const [oldW, newW] of Object.entries(table)) {
      if (made >= maxChanges) break;
      const re = boundaryRe(oldW);
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(result)) !== null) {
        // Probabilistic gate (mirrors `rng.random() > intensity: continue`).
        if (this.rng.random() > intensity) continue;
        const original = m[1];
        const replacement = matchCase(original, newW);
        result = result.slice(0, m.index) + replacement + result.slice(m.index + original.length);
        changes.push({ from: original, to: replacement, direction: `${dir[0]}→${dir[1]}` });
        made++;
        break; // one replacement per source term
      }
    }

    return { text: result, changes };
  }

  /**
   * Normalize a target-tone string; accepts the real enum values plus a few
   * intuitive aliases (informal→casual, very_formal→formal, …).
   * @param {string} x @returns {string}
   */
  static _normalizeLevel(x) {
    const v = String(x || '').toLowerCase();
    if (Object.values(TONE_LEVELS).includes(v)) return v;
    /** @type {Record<string, string>} */
    const alias = {
      informal: TONE_LEVELS.CASUAL,
      very_informal: TONE_LEVELS.CASUAL,
      colloquial: TONE_LEVELS.CASUAL,
      conversational: TONE_LEVELS.FRIENDLY,
      very_formal: TONE_LEVELS.FORMAL,
      business: TONE_LEVELS.PROFESSIONAL,
    };
    return alias[v] || TONE_LEVELS.NEUTRAL;
  }

  /**
   * Determine the replacement direction between two tones.
   * @param {string} current @param {string} target
   * @returns {[string, string]|null}
   */
  static _getDirection(current, target) {
    const formal = new Set([
      TONE_LEVELS.FORMAL, TONE_LEVELS.ACADEMIC,
      TONE_LEVELS.PROFESSIONAL, TONE_LEVELS.MARKETING,
    ]);
    const informal = new Set([TONE_LEVELS.CASUAL, TONE_LEVELS.FRIENDLY]);

    if (informal.has(current) && formal.has(target)) return ['informal', 'formal'];
    if (formal.has(current) && informal.has(target)) return ['formal', 'informal'];
    if (current === TONE_LEVELS.NEUTRAL && formal.has(target)) return ['informal', 'formal'];
    if (current === TONE_LEVELS.NEUTRAL && informal.has(target)) return ['formal', 'informal'];
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Quick tone analysis.
 * @param {string} text
 * @param {{lang?: string, langPack?: object|null}} [opts]
 * @returns {ToneResult}
 */
export function analyzeTone(text, { lang = 'en', langPack = null } = {}) {
  return new ToneAnalyzer(lang).analyze(text, { langPack });
}

/**
 * Quick tone adjustment.
 * @param {string} text
 * @param {string} [target]
 * @param {{lang?: string, langPack?: object|null, seed?: number, intensity?: number}} [opts]
 * @returns {{text: string, changes: Array<{from: string, to: string, direction: string}>}}
 */
export function adjustTone(text, target = TONE_LEVELS.NEUTRAL, { lang = 'en', langPack = null, seed = 0, intensity = 0.5 } = {}) {
  return new ToneAdjuster(lang, seed).adjust(text, target, { langPack, intensity });
}

/** @template T @param {T[]} arr @returns {T[]} */
function dedupe(arr) {
  return [...new Set(arr)];
}
