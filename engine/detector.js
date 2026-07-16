/**
 * Heuristic AI text detector — pure-JS port of TextHumanize's Python
 * `AIDetector` (texthumanize/detectors.py).
 *
 * ES module, zero dependencies, Chrome 120+. Fully local: no network,
 * no file I/O. All probabilities are in [0, 1] (1.0 = "definitely AI").
 *
 * Ported metrics (algorithms mirror the Python implementations):
 *   entropy, burstiness, vocabulary, stylometry, pattern (AI patterns),
 *   punctuation, grammar, opening, readability, rhythm, perplexity
 *   (incl. cross-perplexity vs an embedded reference trigram corpus),
 *   discourse, semantic_rep, entity, voice.
 * Stubbed metrics (always 0.5, excluded from all weighting/voting):
 *   zipf, coherence, topic_sentence.
 *
 * @module engine/detector
 */

/**
 * @typedef {Object} LangPack
 * @property {string[]|Set<string>} [stop_words]  Stop words for the language.
 * @property {string[]|Object<string, unknown>} [ai_connectors]
 *   AI-overused connectors ("However", "Furthermore", …). May be an array or
 *   an object whose KEYS are the connectors (TextHumanize pack format).
 * @property {string[]|Object<string, unknown>} [bureaucratic]
 *   Bureaucratic words; array or object keyed by the words.
 * @property {string[]|Object<string, unknown>} [bureaucratic_phrases]
 *   Multi-word bureaucratic expressions; array or object keyed by phrase.
 * @property {string[]|Object<string, unknown>} [sentence_starters]
 *   Generic sentence starters. Only multi-word entries are used (as extra
 *   formal-start markers); single generic words ("The", "It") are ignored
 *   because they would poison the pattern metric.
 */

/**
 * @typedef {Object} Explanation
 * @property {string} metric   Metric key ("pattern", "burstiness", …) or "meta".
 * @property {number} score    The metric's score (0..1).
 * @property {string} textKey  Localization key: "ai.<metric>", "human.<metric>"
 *                             or "meta.too_short" / "meta.too_few_sentences".
 */

/**
 * @typedef {Object} DetectionResult
 * @property {"human"|"mixed"|"ai"|"unknown"} verdict
 * @property {number} aiProbability  0..1
 * @property {number} confidence     0..1
 * @property {string} domain         academic|news|blog|legal|social|code_docs|general
 * @property {Object<string, number>} scores  Per-metric scores (0..1).
 *   zipf / coherence / topic_sentence are fixed 0.5 stubs.
 * @property {Explanation[]} explanations
 * @property {number} wordCount
 * @property {number} sentenceCount
 * @property {string} lang  Effective language used for scoring.
 */

// ═══════════════════════════════════════════════════════════════
//  Small helpers (Python stdlib equivalents)
// ═══════════════════════════════════════════════════════════════

const PUNCT_STRIP = '.,;:!?"\'()[]{}';

/** Python-like str.strip(chars). */
function stripChars(w, chars) {
  let a = 0;
  let b = w.length;
  while (a < b && chars.includes(w[a])) a++;
  while (b > a && chars.includes(w[b - 1])) b--;
  return w.slice(a, b);
}

/** strip standard punctuation like Python `w.strip('.,;:!?"\'()[]{}')`. */
function stripPunct(w) {
  return stripChars(w, PUNCT_STRIP);
}

/** Python-like str.rstrip(chars). */
function rstripChars(w, chars) {
  let b = w.length;
  while (b > 0 && chars.includes(w[b - 1])) b--;
  return w.slice(0, b);
}

/** Whitespace tokenization, like Python `text.split()`. */
function tokens(text) {
  const t = text.trim();
  return t ? t.split(/\s+/) : [];
}

/** Arithmetic mean (0 for empty input; callers guard like Python does). */
function mean(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample variance (n - 1 denominator), like statistics.variance. */
function sampleVariance(xs) {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (n - 1);
}

/** Sample standard deviation, like statistics.stdev (0 when n < 2). */
function sampleStdev(xs) {
  return Math.sqrt(sampleVariance(xs));
}

/** Non-overlapping substring count, like Python `str.count`. */
function countSub(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) break;
    count++;
    idx += needle.length;
  }
  return count;
}

/** Count regex matches, like len(re.findall(...)). Regex must be global. */
function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ── Unicode-aware regex construction ──────────────────────────
// Python's `\b` / `\w` are Unicode-aware; JS's are ASCII-only. Convert
// `\b` → full Unicode word boundary, `\w` → [\p{L}\p{N}_] (needs /u).
const WB =
  '(?:(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])|(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_]))';

/** Compile a Python-style pattern string into a Unicode-aware RegExp. */
function uniRe(src, flags = 'gu') {
  const converted = src.replace(/\\b/g, WB).replace(/\\w/g, '[\\p{L}\\p{N}_]');
  return new RegExp(converted, flags);
}

const RE_LETTER = /\p{L}/u;
const RE_UPPER_FIRST = /^\p{Lu}/u;
const RE_ALPHA_ONLY = /^\p{L}+$/u;
const RE_CYRILLIC = /[Ѐ-ӿ]/g;
const RE_LATIN = /[A-Za-z]/g;

/** Normalize marker containers: array | Set | object-with-marker-keys → string[]. */
function keysOf(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.filter((v) => typeof v === 'string');
  if (x instanceof Set) return [...x].filter((v) => typeof v === 'string');
  if (typeof x === 'object') return Object.keys(x);
  return [];
}

// ═══════════════════════════════════════════════════════════════
//  Built-in AI markers (from texthumanize/ai_markers.py fallback data)
// ═══════════════════════════════════════════════════════════════

const AI_MARKERS = {
  en: {
    adverbs: [
      'significantly', 'substantially', 'considerably', 'remarkably',
      'exceptionally', 'tremendously', 'profoundly', 'fundamentally',
      'essentially', 'particularly', 'specifically', 'notably',
      'increasingly', 'effectively', 'ultimately', 'consequently',
      'inherently', 'intrinsically', 'predominantly', 'invariably',
    ],
    adjectives: [
      'comprehensive', 'crucial', 'pivotal', 'paramount',
      'innovative', 'robust', 'seamless', 'holistic',
      'cutting-edge', 'state-of-the-art', 'groundbreaking',
      'transformative', 'synergistic', 'multifaceted',
      'nuanced', 'intricate', 'meticulous', 'imperative',
    ],
    verbs: [
      'utilize', 'leverage', 'facilitate', 'implement',
      'foster', 'enhance', 'streamline', 'optimize',
      'underscore', 'delve', 'navigate', 'harness',
      'exemplify', 'spearhead', 'revolutionize', 'catalyze',
      'necessitate', 'elucidate', 'delineate', 'substantiate',
    ],
    connectors: [
      'however', 'furthermore', 'moreover', 'nevertheless',
      'nonetheless', 'additionally', 'consequently', 'therefore',
      'thus', 'hence', 'accordingly', 'subsequently',
      'in conclusion', 'to summarize', 'in essence',
      'it is important to note', 'it is worth mentioning',
    ],
    phrases: [
      'plays a crucial role', 'is of paramount importance',
      "in today's world", 'in the modern era',
      'a wide range of', 'it goes without saying',
      'in light of', 'due to the fact that',
      'at the end of the day', 'it is important to note that',
      'it should be noted that', 'it is worth mentioning that',
      'first and foremost', 'last but not least',
      'in order to', 'with regard to', 'as a matter of fact',
    ],
  },
  ru: {
    adverbs: [
      'значительно', 'существенно', 'чрезвычайно', 'безусловно',
      'несомненно', 'неоспоримо', 'принципиально', 'непосредственно',
      'кардинально', 'всесторонне', 'исключительно', 'преимущественно',
    ],
    adjectives: [
      'комплексный', 'всеобъемлющий', 'инновационный', 'ключевой',
      'основополагающий', 'первостепенный', 'фундаментальный',
      'принципиальный', 'многогранный', 'всесторонний',
    ],
    verbs: [
      'осуществлять', 'реализовывать', 'способствовать',
      'обеспечивать', 'характеризоваться', 'представлять собой',
      'являться', 'функционировать', 'оказывать влияние',
    ],
    connectors: [
      'однако', 'тем не менее', 'вместе с тем', 'кроме того',
      'более того', 'помимо этого', 'таким образом',
      'следовательно', 'безусловно', 'несомненно',
      'в заключение', 'подводя итог', 'исходя из вышесказанного',
      'необходимо отметить', 'стоит подчеркнуть',
    ],
    phrases: [
      'играет ключевую роль', 'имеет первостепенное значение',
      'в современном мире', 'на сегодняшний день',
      'широкий спектр', 'не подлежит сомнению',
      'является одним из', 'представляет собой',
      'в рамках данного', 'с учётом того что',
      'необходимо подчеркнуть', 'следует отметить',
    ],
  },
  uk: {
    adverbs: [
      'значно', 'суттєво', 'надзвичайно', 'безумовно',
      'безсумнівно', 'незаперечно', 'принципово', 'безпосередньо',
      'кардинально', 'всебічно', 'виключно', 'переважно',
      'категорично', "об'єктивно", 'беззаперечно', 'вичерпно',
    ],
    adjectives: [
      'комплексний', 'всеосяжний', 'інноваційний', 'ключовий',
      'основоположний', 'першочерговий', 'фундаментальний',
      'принциповий', 'багатогранний', 'всебічний',
      'пріоритетний', 'системний', 'стратегічний', 'оптимальний',
    ],
    verbs: [
      'здійснювати', 'реалізовувати', 'сприяти',
      'забезпечувати', 'характеризуватися', 'являти собою',
      'функціонувати', 'справляти вплив', 'зумовлювати',
      'обумовлювати', 'передбачати', 'уможливлювати',
    ],
    connectors: [
      'однак', 'тим не менш', 'разом з тим', 'крім того',
      'більш того', 'окрім цього', 'таким чином',
      'отже', 'безумовно', 'безсумнівно',
      'на завершення', 'підсумовуючи',
      'необхідно зазначити', 'варто підкреслити',
      'у підсумку', 'з огляду на це', 'відповідно',
    ],
    phrases: [
      'відіграє ключову роль', 'має першочергове значення',
      'у сучасному світі', 'на сьогоднішній день',
      'широкий спектр', 'є одним з',
      'являє собою', 'у рамках даного',
      'не підлягає сумніву', 'з точки зору',
      'слід наголосити', 'варто звернути увагу',
    ],
  },
  de: {
    adverbs: [
      'erheblich', 'wesentlich', 'grundlegend', 'insbesondere',
      'zweifellos', 'unbestreitbar', 'maßgeblich', 'zunehmend',
    ],
    adjectives: [
      'umfassend', 'entscheidend', 'innovativ', 'grundlegend',
      'weitreichend', 'vielfältig', 'bedeutend', 'wesentlich',
    ],
    connectors: [
      'jedoch', 'darüber hinaus', 'außerdem', 'nichtsdestotrotz',
      'folglich', 'demzufolge', 'zusammenfassend',
      'es ist wichtig zu beachten', 'abschließend',
    ],
    phrases: [
      'spielt eine entscheidende Rolle',
      'ist von größter Bedeutung',
      'in der heutigen Welt',
      'ein breites Spektrum',
    ],
  },
  es: {
    adverbs: [
      'significativamente', 'sustancialmente', 'considerablemente',
      'fundamentalmente', 'esencialmente', 'particularmente',
      'predominantemente', 'inherentemente',
    ],
    adjectives: [
      'integral', 'crucial', 'innovador', 'robusto',
      'holístico', 'transformador', 'multifacético', 'imperativo',
    ],
    connectors: [
      'sin embargo', 'además', 'no obstante', 'por lo tanto',
      'en consecuencia', 'asimismo', 'en conclusión',
      'cabe destacar', 'vale la pena mencionar',
    ],
    phrases: [
      'juega un papel crucial',
      'es de suma importancia',
      'en el mundo actual',
      'una amplia gama de',
    ],
  },
  fr: {
    adverbs: [
      'considérablement', 'fondamentalement', 'essentiellement',
      'particulièrement', 'incontestablement', 'intrinsèquement',
    ],
    adjectives: [
      'compréhensif', 'crucial', 'innovant', 'fondamental',
      'holistique', 'transformateur', 'multifacette',
    ],
    connectors: [
      'cependant', 'de plus', 'néanmoins', 'par conséquent',
      'en outre', 'ainsi', 'en conclusion',
      'il convient de noter', 'il est important de souligner',
    ],
    phrases: [
      'joue un rôle crucial',
      "est d'une importance capitale",
      'dans le monde actuel',
      'un large éventail de',
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
//  Reference corpus stats (from texthumanize/corpus_stats.py)
//  Character trigram → relative frequency; used for cross-perplexity.
// ═══════════════════════════════════════════════════════════════

const EN_TRIGRAMS = {
  'the': 0.0356, ' th': 0.0289, 'he ': 0.0245, 'ing': 0.0182,
  'nd ': 0.0167, 'and': 0.0163, ' an': 0.0158, 'er ': 0.0145,
  'ed ': 0.0138, ' to': 0.0132, 'to ': 0.0128, ' in': 0.0125,
  'ion': 0.0121, 'tio': 0.0118, 'ati': 0.0112, ' of': 0.0108,
  'of ': 0.0105, 'in ': 0.0102, 'ent': 0.0098, ' ha': 0.0095,
  'hat': 0.0092, 'tha': 0.0090, 'ere': 0.0087, 'her': 0.0085,
  're ': 0.0082, 'for': 0.0079, ' fo': 0.0077, 'or ': 0.0075,
  ' is': 0.0073, 'is ': 0.0071, 'es ': 0.0069, ' wa': 0.0067,
  'was': 0.0065, 'as ': 0.0063, 'on ': 0.0061, ' it': 0.0059,
  'it ': 0.0057, 'all': 0.0055, ' al': 0.0053, 'ons': 0.0051,
  ' co': 0.0049, 'ted': 0.0047, 'ter': 0.0045, ' on': 0.0043,
  ' re': 0.0042, 'rea': 0.0041, 'con': 0.0040, ' he': 0.0039,
  'his': 0.0038, ' hi': 0.0037, 'ith': 0.0036, 'wit': 0.0035,
  ' wi': 0.0034, 'not': 0.0033, ' no': 0.0032, 'ot ': 0.0031,
  'ver': 0.0030, ' be': 0.0029, 'men': 0.0028, 'pro': 0.0027,
  ' pr': 0.0026, 'com': 0.0025, ' st': 0.0024, 'ste': 0.0023,
  'ment': 0.0022, 'sta': 0.0021, 'est': 0.0020, 'ess': 0.0019,
  'ave': 0.0017, 'hav': 0.0016,
  ' wh': 0.0015, 'whi': 0.0014, 'ich': 0.0014, 'hic': 0.0013,
  ' ar': 0.0013, 'are': 0.0012, 'oul': 0.0012, 'ld ': 0.0011,
  'ou ': 0.0011, 'you': 0.0010, ' yo': 0.0010, ' we': 0.0010,
  'wer': 0.0009, 'nce': 0.0009, 'enc': 0.0009, ' en': 0.0008,
  'ght': 0.0008, 'igh': 0.0008, ' de': 0.0008, 'der': 0.0007,
  'eve': 0.0007, ' se': 0.0007, 'se ': 0.0007, 'ble': 0.0006,
  ' ma': 0.0006, 'man': 0.0006, 'any': 0.0006,
};

const RU_TRIGRAMS = {
  ' не': 0.0198, 'не ': 0.0185, 'ени': 0.0162, ' на': 0.0155,
  'на ': 0.0148, ' по': 0.0142, 'ого': 0.0138, 'ани': 0.0132,
  'ост': 0.0128, ' ко': 0.0122, 'ние': 0.0118, ' пр': 0.0115,
  'про': 0.0112, ' и ': 0.0108, 'ста': 0.0105, ' в ': 0.0102,
  'ать': 0.0098, 'ова': 0.0095, ' от': 0.0092, 'что': 0.0090,
  ' чт': 0.0088, 'то ': 0.0085, ' за': 0.0082, 'ель': 0.0079,
  'тел': 0.0077, ' об': 0.0075, 'ере': 0.0073, 'пер': 0.0071,
  ' пе': 0.0069, 'ред': 0.0067, 'ра ': 0.0065, ' ра': 0.0063,
  'нос': 0.0061, 'ный': 0.0059,
  ' ка': 0.0053, ' до': 0.0051, ' вы': 0.0049,
  'ает': 0.0045, 'стр': 0.0043, ' ст': 0.0042, 'ран': 0.0041,
  'ным': 0.0040, 'тор': 0.0039, ' то': 0.0038, ' та': 0.0037,
  'так': 0.0036, 'как': 0.0035, ' как': 0.0034, 'ый ': 0.0033,
  'ой ': 0.0032, ' мо': 0.0031, 'мож': 0.0030, 'ожн': 0.0029,
  'жно': 0.0028, ' сл': 0.0027, 'ско': 0.0026, ' бы': 0.0025,
  'был': 0.0024, 'ыл ': 0.0023, 'ла ': 0.0022, 'ли ': 0.0021,
  'все': 0.0020, ' вс': 0.0019, 'сь ': 0.0018, 'тся': 0.0017,
  'ись': 0.0016, 'ить': 0.0015, 'ому': 0.0013,
};

const EN_REFERENCE_PERPLEXITY = 12.5;
const RU_REFERENCE_PERPLEXITY = 14.2;
const EN_VOCAB_SIZE = 17576;
const RU_VOCAB_SIZE = 29791;

function getReferenceTrigrams(lang) {
  return lang === 'ru' || lang === 'uk' ? RU_TRIGRAMS : EN_TRIGRAMS;
}

function getReferencePerplexity(lang) {
  return lang === 'ru' || lang === 'uk'
    ? RU_REFERENCE_PERPLEXITY
    : EN_REFERENCE_PERPLEXITY;
}

/** Cross-perplexity of text against the embedded reference corpus. */
function crossPerplexity(text, lang) {
  const ref = getReferenceTrigrams(lang);
  let totalRefMass = 0;
  for (const k in ref) totalRefMass += ref[k];
  const smoothingMass = 1.0 - totalRefMass;
  const vocabSize =
    lang === 'ru' || lang === 'uk' ? RU_VOCAB_SIZE : EN_VOCAB_SIZE;

  const textLower = text.toLowerCase();
  if (textLower.length < 10) return getReferencePerplexity(lang);

  let logProbSum = 0;
  let n = 0;
  for (let i = 0; i < textLower.length - 2; i++) {
    const trigram = textLower.slice(i, i + 3);
    const prob = Object.prototype.hasOwnProperty.call(ref, trigram)
      ? ref[trigram]
      : smoothingMass / vocabSize;
    if (prob > 0) {
      logProbSum += Math.log(prob);
      n++;
    }
  }
  if (n === 0) return getReferencePerplexity(lang);
  return Math.exp(-(logProbSum / n));
}

// ═══════════════════════════════════════════════════════════════
//  Static pattern data (transcribed from _calc_ai_patterns et al.)
// ═══════════════════════════════════════════════════════════════

const FORMAL_STARTERS = [
  // English
  'however', 'furthermore', 'moreover', 'additionally',
  'consequently', 'nevertheless', 'nonetheless',
  // Russian
  'однако', 'кроме того', 'более того', 'помимо этого',
  'таким образом', 'следовательно', 'тем не менее',
  // Ukrainian
  'однак', 'крім того', 'більш того', 'окрім цього',
  'таким чином', 'отже',
  // German
  'jedoch', 'darüber hinaus', 'außerdem', 'nichtsdestotrotz',
  'folglich', 'demzufolge', 'zusammenfassend',
  // French
  'cependant', 'de plus', 'néanmoins', 'par conséquent',
  'en outre', 'ainsi', 'en conclusion',
  // Spanish
  'sin embargo', 'además', 'no obstante', 'por lo tanto',
  'en consecuencia', 'asimismo', 'en conclusión',
  // Italian
  'tuttavia', 'inoltre', 'ciononostante', 'pertanto',
  'di conseguenza', 'in conclusione',
  // Polish
  'jednakże', 'ponadto', 'niemniej jednak', 'w związku z tym',
  'podsumowując',
  // Portuguese
  'no entanto', 'além disso', 'contudo', 'portanto',
  'consequentemente', 'em conclusão',
];

const HEDGING_PATTERNS = [
  String.raw`\bit is (?:important|essential|crucial|worth|necessary|imperative|critical|noteworthy|undeniable|evident|clear|apparent|undeniable|widely recognized)`,
  String.raw`\bit (?:should be|must be|can be|could be) (?:noted|mentioned|emphasized|highlighted|stressed|acknowledged|recognized|understood|argued)`,
  String.raw`\bthis (?:approach|method|strategy|technique|framework|analysis|study|research|paper|article|investigation) (?:has|enables|ensures|provides|facilitates|demonstrates|highlights|reveals|examines|explores|investigates|addresses|aims|seeks)`,
  String.raw`\bplays? (?:a |an )?(?:crucial|important|vital|significant|key|essential|fundamental|pivotal|indispensable|central|integral) role`,
  String.raw`\bin (?:today's|the modern|the current|the contemporary|an increasingly) `,
  String.raw`\bone of the most (?:important|significant|pressing|critical|challenging|notable|prominent|influential|impactful)`,
  String.raw`\bthe (?:importance|significance|impact|role|influence|implications|consequences|relevance) of\b`,
  String.raw`\bgaining (?:traction|momentum|popularity|significance|attention)`,
  String.raw`\bboth .{5,40} and .{5,40}(?: alike)?[.]`,
  String.raw`\brepresents? (?:a |an )?(?:significant|important|major|critical|key|fundamental|notable|promising|paradigm)`,
  // AI cliché phrases (EN)
  String.raw`\bin (?:terms of|light of|the context of|the realm of|the field of)\b`,
  String.raw`\bwith (?:regard to|respect to|a focus on)\b`,
  String.raw`\bas (?:a result|such|mentioned|noted|previously stated)\b`,
  String.raw`\bon the other hand\b`,
  String.raw`\bin conclusion\b`,
  String.raw`\bto (?:sum up|summarize|conclude|recap)\b`,
  String.raw`\bit is (?:widely|generally|commonly) (?:known|accepted|believed|recognized)\b`,
  String.raw`\b(?:comprehensive|thorough|in-depth|extensive|holistic) (?:analysis|review|examination|study|overview|understanding|approach|assessment)\b`,
  String.raw`\b(?:significant|substantial|considerable|remarkable|notable) (?:impact|progress|improvement|advancement|growth|increase|benefits|advantages)\b`,
  String.raw`\bthe (?:utilization|implementation|optimization|integration|facilitation|enhancement) of\b`,
  String.raw`\b(?:delve|delves|delving) (?:into|deeper)\b`,
  String.raw`\b(?:navigate|navigating|navigates) (?:the|this|these) (?:complex|challenging|intricate|evolving|dynamic)\b`,
  String.raw`\b(?:landscape|paradigm|ecosystem|synergy|synergies)\b`,
  String.raw`\bleverage(?:s|d|ing)?\b`,
  String.raw`\bfoster(?:s|ed|ing)? (?:a |an )?(?:sense|culture|environment|community|atmosphere|spirit|innovation|collaboration|growth)\b`,
  // Russian patterns
  String.raw`\bявляется (?:одним|ключевым|важным|важнейшим|неотъемлемым|основ)`,
  String.raw`\bиграет (?:важную|ключевую|существенную|значительную) роль`,
  String.raw`\bпредставляет собой\b`,
  String.raw`\bоказывает (?:существенное|значительное|важное) влияние`,
  String.raw`\bодн(?:им|ой) из (?:наиболее|самых|важнейших|ключевых)`,
  String.raw`\bнеобходимо (?:отметить|подчеркнуть|учитывать)`,
  String.raw`\bследует (?:отметить|подчеркнуть|учитывать)`,
  String.raw`\bважно (?:отметить|подчеркнуть|учитывать)`,
  String.raw`\bв (?:рамках|контексте|условиях|сфере) данн`,
  String.raw`\bданн(?:ый|ая|ое|ые) (?:подход|метод|исследование|анализ|работа|статья|факт|фактор|явление|процесс|результат)`,
  String.raw`\bв (?:данном|настоящем|современном) (?:контексте|исследовании|мире|обществе|этапе)`,
  String.raw`\b(?:комплексный|всесторонний|тщательный|глубокий|детальный|систематический) (?:анализ|подход|обзор|исследование|изучение)\b`,
  String.raw`\b(?:значительн|существенн|замет|ощутим)(?:ый|ая|ое|ые|о|ого) (?:вклад|прогресс|рост|влияние|улучшение)\b`,
  String.raw`\bспособствует (?:оптимизации|улучшению|развитию|повышению|укреплению|формированию|росту)\b`,
  String.raw`\bобеспечивает (?:повышение|улучшение|оптимизацию|эффективн|надёжн|устойчив|комплексн)\b`,
  // German hedging patterns
  String.raw`\bes ist (?:wichtig|entscheidend|wesentlich|bemerkenswert|von (?:großer|entscheidender|besonderer) Bedeutung)`,
  String.raw`\bspielt eine (?:entscheidende|wichtige|wesentliche|zentrale|bedeutende|fundamentale) Rolle`,
  String.raw`\bin der heutigen (?:Welt|Gesellschaft|Zeit)\b`,
  String.raw`\bdarüber hinaus\b`,
  String.raw`\bnichtsdestotrotz\b`,
  String.raw`\bzusammenfassend (?:lässt sich|kann man|ist)\b`,
  String.raw`\bes (?:sollte|muss|kann) (?:betont|erwähnt|hervorgehoben|festgestellt) werden`,
  String.raw`\bein(?:e|en|em|er)? (?:umfassend|gründlich|eingehend|tiefgreifend)(?:e|en|er|em|es)? (?:Analyse|Untersuchung|Überblick|Studie)\b`,
  // French hedging patterns
  String.raw`\bil (?:est|convient de|faut|importe de) (?:important|essentiel|crucial|nécessaire|noter|souligner|mentionner)\b`,
  String.raw`\bjoue un rôle (?:crucial|important|essentiel|fondamental|clé)\b`,
  String.raw`\bdans le (?:monde|contexte|cadre) (?:actuel|moderne|contemporain)\b`,
  String.raw`\bpar conséquent\b`,
  String.raw`\bnéanmoins\b`,
  String.raw`\ben conclusion\b`,
  String.raw`\bil convient de (?:noter|souligner|mentionner|rappeler)\b`,
  String.raw`\bune (?:analyse|étude|approche) (?:approfondie|exhaustive|complète|globale)\b`,
  // Spanish hedging patterns
  String.raw`\bes (?:importante|esencial|crucial|fundamental|necesario|imprescindible) (?:señalar|destacar|mencionar|subrayar|tener en cuenta)\b`,
  String.raw`\bjuega un papel (?:crucial|importante|fundamental|clave|esencial)\b`,
  String.raw`\ben el (?:mundo|contexto|marco) actual\b`,
  String.raw`\bsin embargo\b`,
  String.raw`\bno obstante\b`,
  String.raw`\ben conclusión\b`,
  String.raw`\bcabe (?:destacar|mencionar|señalar|resaltar)\b`,
  String.raw`\bun (?:análisis|estudio|enfoque) (?:exhaustivo|integral|profundo|detallado)\b`,
  // Italian hedging patterns
  String.raw`\bè (?:importante|essenziale|cruciale|fondamentale|necessario) (?:notare|sottolineare|menzionare|evidenziare)\b`,
  String.raw`\bgioca un ruolo (?:cruciale|importante|fondamentale|chiave|essenziale)\b`,
  String.raw`\bnel (?:mondo|contesto|quadro) (?:attuale|moderno|contemporaneo)\b`,
  String.raw`\btuttavia\b`,
  String.raw`\bciononostante\b`,
  String.raw`\bin (?:conclusione|sintesi)\b`,
  String.raw`\b(?:un'analisi|uno studio|un approccio) (?:approfondito|esaustivo|completo)\b`,
  // Polish hedging patterns
  String.raw`\bnależy (?:podkreślić|zauważyć|wspomnieć|zwrócić uwagę)\b`,
  String.raw`\bodgrywa (?:kluczową|ważną|istotną|zasadniczą) rolę\b`,
  String.raw`\bw (?:dzisiejszym|współczesnym|obecnym) (?:świecie|kontekście)\b`,
  String.raw`\bjednakże\b`,
  String.raw`\bniemniej jednak\b`,
  String.raw`\bpodsumowując\b`,
  // Portuguese hedging patterns
  String.raw`\bé (?:importante|essencial|crucial|fundamental|necessário) (?:notar|destacar|mencionar|salientar)\b`,
  String.raw`\bdesempenha um papel (?:crucial|importante|fundamental|essencial)\b`,
  String.raw`\bno (?:mundo|contexto|cenário) (?:atual|moderno|contemporâneo)\b`,
  String.raw`\bno entanto\b`,
  String.raw`\bcontudo\b`,
  String.raw`\bem conclusão\b`,
].map((p) => uniRe(p));

const ENUM_PATTERNS = [
  String.raw`\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|lastly),?\s`,
  String.raw`\b(?:first and foremost|last but not least|in addition to)\b`,
  String.raw`\b(?:во-первых|во-вторых|в-третьих|наконец)\b`,
  String.raw`\b(?:erstens|zweitens|drittens|schließlich|abschließend)\b`,
  String.raw`\b(?:premièrement|deuxièmement|troisièmement|enfin|finalement)\b`,
  String.raw`\b(?:primero|segundo|tercero|finalmente|por último)\b`,
  String.raw`\b(?:in primo luogo|in secondo luogo|in terzo luogo|infine)\b`,
  String.raw`\b(?:po pierwsze|po drugie|po trzecie|na koniec)\b`,
  String.raw`\b(?:primeiramente|em segundo lugar|em terceiro lugar|por fim)\b`,
].map((p) => uniRe(p));

// Voice metric patterns
const PASSIVE_PATTERNS = [
  // EN
  String.raw`\b(?:is|are|was|were|been|being|be)\s+\w+ed\b`,
  String.raw`\b(?:is|are|was|were|been|being|be)\s+\w+en\b`,
  String.raw`\b(?:has|have|had)\s+been\s+\w+ed\b`,
  String.raw`\bwas\s+\w+ed\b`,
  String.raw`\bwere\s+\w+ed\b`,
  // RU/UK
  String.raw`\b\w+(?:ован|ирован|ен|ан|ят|ит)(?:а|о|ы|и)?\s+(?:был|была|было|были)\b`,
  String.raw`\b(?:был|была|было|были)\s+\w+(?:ован|ирован|ен|ан)\w*\b`,
  String.raw`\b(?:из|пере|раз|при|за|от|вы)\w{3,}(?:ся|сь)\b`,
  // DE
  String.raw`\b(?:wird|wurde|werden|wurden)\s+\w+(?:t|en)\b`,
  String.raw`\bist\s+\w+\s+worden\b`,
  String.raw`\b(?:wird|wurde)\s+\w+\b`,
  // FR
  String.raw`\b(?:est|sont|a été|ont été|sera|seront)\s+\w+(?:é|ée|és|ées)\b`,
  String.raw`\b(?:est|sont)\s+\w+(?:é|ée|és|ées)\s+par\b`,
  // ES
  String.raw`\b(?:fue|fueron|es|son|ha sido|han sido)\s+\w+(?:ado|ido|ada|ida)\b`,
  String.raw`\bse\s+\w+(?:a|e|an|en)\b`,
  // IT
  String.raw`\b(?:è|sono|è stato|è stata|sono stati|sono state)\s+\w+(?:ato|ato|ita|iti|ite)\b`,
  String.raw`\b(?:viene|vengono)\s+\w+(?:ato|ata|ati|ate)\b`,
].map((p) => uniRe(p));

const NOMINALIZATION_PATTERNS = [
  String.raw`\b\w{4,}tion\b`, String.raw`\b\w{4,}ment\b`, String.raw`\b\w{4,}ness\b`,
  String.raw`\b\w{4,}ity\b`, String.raw`\b\w{4,}ence\b`, String.raw`\b\w{4,}ance\b`,
  // RU
  String.raw`\b\w{4,}ация\b`, String.raw`\b\w{4,}ение\b`, String.raw`\b\w{4,}ование\b`,
  // DE
  String.raw`\b\w{4,}ung\b`, String.raw`\b\w{4,}heit\b`, String.raw`\b\w{4,}keit\b`,
  String.raw`\b\w{4,}schaft\b`,
  // FR
  String.raw`\b\w{4,}ité\b`, String.raw`\b\w{4,}isation\b`,
  // ES
  String.raw`\b\w{4,}ción\b`, String.raw`\b\w{4,}miento\b`, String.raw`\b\w{4,}dad\b`,
  // IT
  String.raw`\b\w{4,}zione\b`, String.raw`\b\w{4,}mento\b`, String.raw`\b\w{4,}ità\b`,
  // PL
  String.raw`\b\w{4,}ość\b`, String.raw`\b\w{4,}acja\b`,
  // PT
  String.raw`\b\w{4,}ção\b`, String.raw`\b\w{4,}dade\b`,
].map((p) => uniRe(p));

const ACTIVE_MARKER_PATTERNS = [
  uniRe(String.raw`\b(?:I|we|you|he|she|they)\s+\w+(?:ed|s)\b`, 'giu'),
  uniRe(String.raw`\b(?:я|мы|ты|вы|он|она|они|він|вона|вони)\s+\w+`, 'giu'),
  uniRe(String.raw`\b(?:ich|wir|du|er|sie)\s+\w+(?:e|st|t|en)\b`, 'giu'),
  uniRe(String.raw`\b(?:je|nous|tu|vous|il|elle|ils|elles)\s+\w+`, 'giu'),
  uniRe(String.raw`\b(?:yo|nosotros|tú|usted|él|ella|ellos)\s+\w+`, 'giu'),
];

// Grammar metric regexes
const RE_CONTRACTIONS = uniRe(String.raw`\b\w+'(?:t|s|re|ve|ll|d|m)\b`, 'giu');
const RE_OXFORD = uniRe(String.raw`,\s+and\b`, 'giu');
const RE_AND = uniRe(String.raw`\band\b`, 'giu');
const RE_INFORMAL_PUNCT = /[!?]{2,}|\.{3,}/gu;
const RE_BULLET_LINES = /^[\s]*[-•*]\s/gmu;
const RE_NUMBERED_LINES = /^[\s]*\d+[.)]\s/gmu;

// Entity metric regex
const RE_SPECIFIC_NUMS = uniRe(
  String.raw`\b\d{1,2}(?:\.\d+)?\b|\$\d+|\b\d{4}\b|\b\d+%`,
);

// Domain detection
const RE_NEWS_AGENCIES = uniRe(String.raw`\b(?:REUTERS|AP|AFP|BBC|CNN)\b`, 'u');

const ACADEMIC_WORDS = new Set([
  'hypothesis', 'methodology', 'findings', 'empirical',
  'theoretical', 'correlation', 'literature', 'et al',
  'framework', 'paradigm', 'variables', 'significant',
  'гипотеза', 'методология', 'эмпирический', 'корреляция',
]);

const LEGAL_WORDS = new Set([
  'herein', 'thereof', 'pursuant', 'notwithstanding',
  'hereunder', 'aforementioned', 'jurisdiction',
  'warrant', 'plaintiff', 'defendant', 'statute',
  'настоящим', 'надлежащий', 'нижеследующий', 'истец',
]);

const INFORMAL_MARKERS = new Set([
  'lol', 'omg', 'tbh', 'imo', 'btw', 'lmao',
  'лол', 'кек', 'имхо', 'ахах',
]);

const BLOG_PERSONAL = new Set(['i', 'my', 'me', 'я', 'мой', 'мне']);

// Discourse metric marker sets
const CONCLUSION_MARKERS = [
  'in conclusion', 'to summarize', 'in summary', 'overall',
  'to conclude', 'in short', 'ultimately', 'all in all',
  'в заключение', 'подводя итог', 'таким образом', 'итого',
  'резюмируя', 'в итоге', 'підсумовуючи', 'на завершення',
];

const INTRO_MARKERS = [
  "in today's", 'in the modern', 'in recent years',
  'the importance of', 'it is widely', 'has become',
  'plays a crucial', 'is one of', 'has emerged',
  'в современном', 'на сегодняшний день', 'в последние годы',
  'является одним из', 'играет ключевую роль',
  'у сучасному', 'на сьогоднішній',
];

const DISCOURSE_TRANSITIONS = [
  'however', 'furthermore', 'moreover', 'additionally',
  'in addition', 'on the other hand', 'consequently',
  'first', 'second', 'third', 'finally',
  'однако', 'кроме того', 'более того', 'во-первых',
  'во-вторых', 'в-третьих', 'наконец',
];

const FLAT_CONCLUSION_WORDS = [
  'conclusion', 'summarize', 'summary', 'overall',
  'заключение', 'итог', 'таким образом', 'підсумовуючи',
];

const FLAT_INTRO_WORDS = [
  "today's", 'modern', 'importance', 'crucial',
  'современном', 'сьогоднішній', 'ключевую',
];

// Entity metric marker sets
const GENERIC_QUANTS = new Set([
  'various', 'numerous', 'several', 'many', 'multiple',
  'significant', 'substantial', 'considerable', 'widespread',
  'a number of', 'a variety of', 'a wide range',
  'различные', 'многочисленные', 'многие', 'множество',
  'значительный', 'существенный', 'ряд', 'широкий спектр',
  'різні', 'численні', 'багато', 'безліч',
]);

const GENERIC_QUANT_PHRASES = [
  'a number of', 'a variety of', 'a wide range',
  'широкий спектр', 'ряд', 'целый ряд',
];

const PERSONAL_REFS = new Set([
  'i', 'my', 'me', 'we', 'our', 'mine',
  'я', 'мой', 'моя', 'моё', 'мне', 'меня', 'мы', 'наш',
  'мій', 'моє', 'мені', 'мене', 'ми',
]);

const HEDGE_WORDS = new Set([
  'arguably', 'potentially', 'relatively', 'particularly',
  'generally', 'typically', 'essentially', 'fundamentally',
  'по сути', 'в целом', 'как правило', 'в значительной степени',
  'в основному', 'як правило', 'загалом',
]);

// Openings metric
const SUBJECT_PRONOUNS = new Set([
  'i', 'he', 'she', 'it', 'they', 'we', 'you', 'the', 'this',
  'я', 'он', 'она', 'оно', 'они', 'мы', 'вы', 'это', 'эти',
  'він', 'вона', 'воно', 'вони', 'ми', 'ви', 'це', 'ці',
]);

// ═══════════════════════════════════════════════════════════════
//  Sentence splitting
// ═══════════════════════════════════════════════════════════════

// Common abbreviations that should not terminate a sentence.
const RE_ABBREV_TAIL =
  /(?:^|[\s(«"'])(?:mr|mrs|ms|dr|prof|sr|jr|inc|ltd|corp|etc|vs|approx|no|vol|fig|e\.g|i\.e|см|напр|т\.д|т\.п|т\.е)\.$|(?:^|[\s(«"'])\p{Lu}\.$/iu;

/**
 * Split text into sentences. Simple regex splitter: breaks after
 * [.!?…] followed by whitespace, plus newline boundaries. Merges back
 * splits after common abbreviations and single-letter initials, drops
 * fragments with no letters. Cyrillic-safe.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  if (!text || !text.trim()) return [];
  const rawParts = text.split(/(?<=[.!?…])\s+|\n+/u);

  // Merge parts that end in an abbreviation/initial with the following part.
  const merged = [];
  for (const part of rawParts) {
    const prev = merged.length ? merged[merged.length - 1] : null;
    if (prev !== null && RE_ABBREV_TAIL.test(prev)) {
      merged[merged.length - 1] = `${prev} ${part}`;
    } else {
      merged.push(part);
    }
  }

  const out = [];
  for (const p of merged) {
    const s = p.trim();
    if (!s || s.length < 2) continue;
    if (!RE_LETTER.test(s)) continue; // drop number/punctuation-only fragments
    out.push(s);
  }
  return out;
}

/** Crude script-based language sniff (only used when no lang is given). */
function sniffLang(text) {
  const sample = text.slice(0, 4000);
  const cyr = (sample.match(RE_CYRILLIC) || []).length;
  const lat = (sample.match(RE_LATIN) || []).length;
  if (cyr > lat) {
    return /[іїєґІЇЄҐ]/.test(sample) ? 'uk' : 'ru';
  }
  return 'en';
}

// ═══════════════════════════════════════════════════════════════
//  Detector
// ═══════════════════════════════════════════════════════════════

/** Metric weights (zipf/coherence/topic_sentence dropped from the Python set). */
const WEIGHTS = {
  pattern: 0.20,
  burstiness: 0.14,
  stylometry: 0.09,
  voice: 0.08,
  entity: 0.07,
  opening: 0.06,
  grammar: 0.05,
  entropy: 0.04,
  discourse: 0.04,
  vocabulary: 0.04,
  rhythm: 0.04,
  perplexity: 0.03,
  semantic_rep: 0.03,
  readability: 0.02,
  punctuation: 0.02,
};

/** Domain-specific weight adjustments (as in Python). */
const DOMAIN_WEIGHT_MODS = {
  academic: { grammar: 0.02, voice: 0.01, pattern: -0.04, entity: -0.02, burstiness: 0.03 },
  news: { entity: 0.03, discourse: -0.02, voice: 0.02 },
  blog: { entity: 0.02, grammar: 0.03, pattern: 0.03 },
  legal: { grammar: 0.01, voice: 0.01, pattern: -0.06, vocabulary: -0.03 },
  social: { grammar: 0.04, pattern: 0.04, burstiness: 0.03, discourse: 0.03 },
  code_docs: { voice: 0.01, pattern: -0.05, readability: -0.02 },
};

const HUMAN_EXPLANATION_KEYS = new Set([
  'entropy', 'burstiness', 'vocabulary', 'pattern', 'opening', 'rhythm',
]);

/**
 * Statistical AI-text detector (heuristic ensemble, no ML).
 */
export class AIDetector {
  /**
   * @param {{lang?: string, langPack?: LangPack|null}} [defaults]
   *   Optional default lang / langPack applied when detect() gets none.
   */
  constructor(defaults = {}) {
    this._defaultLang = defaults.lang || null;
    this._defaultPack = defaults.langPack || null;
  }

  /**
   * Detect the probability that `text` was AI-generated.
   *
   * @param {string} text
   * @param {{lang?: string, langPack?: LangPack|null}} [options]
   *   lang — ISO code ("en", "ru", "uk", …). If omitted, a crude
   *   script sniff picks en/ru/uk. langPack — plain object (see LangPack)
   *   or null for universal mode (pack-dependent metrics return 0.5).
   * @returns {DetectionResult}
   */
  detect(text, options = {}) {
    const langPack =
      options.langPack !== undefined ? options.langPack : this._defaultPack;
    let lang = options.lang || this._defaultLang || null;
    if (!lang || lang === 'auto') lang = text ? sniffLang(text) : 'en';
    lang = String(lang).toLowerCase().slice(0, 2);

    const base = {
      verdict: 'unknown',
      aiProbability: 0.0,
      confidence: 0.0,
      domain: 'general',
      scores: {},
      explanations: [],
      wordCount: 0,
      sentenceCount: 0,
      lang,
    };

    if (!text || text.trim().length < 50) {
      base.explanations.push({
        metric: 'meta', score: 0, textKey: 'meta.too_short',
      });
      return base;
    }

    const sentences = splitSentences(text);
    const words = tokens(text);
    base.wordCount = words.length;
    base.sentenceCount = sentences.length;

    if (sentences.length < 2) {
      base.confidence = 0.1;
      base.explanations.push({
        metric: 'meta', score: 0, textKey: 'meta.too_few_sentences',
      });
      return base;
    }

    // ── Compute metrics ──
    const scores = {
      entropy: this._calcEntropy(text, words, lang),
      burstiness: this._calcBurstiness(sentences),
      vocabulary: this._calcVocabulary(text, words, langPack),
      stylometry: this._calcStylometry(text, words, sentences, langPack),
      pattern: this._calcAiPatterns(text, words, sentences, lang, langPack),
      punctuation: this._calcPunctuation(text, sentences),
      grammar: this._calcGrammar(text, sentences),
      opening: this._calcOpenings(sentences),
      readability: this._calcReadabilityConsistency(sentences),
      rhythm: this._calcRhythm(sentences),
      perplexity: this._calcPerplexity(text, sentences, lang),
      discourse: this._calcDiscourse(text, sentences),
      semantic_rep: this._calcSemanticRepetition(text, sentences),
      entity: this._calcEntitySpecificity(text, words),
      voice: this._calcVoice(text, sentences),
    };

    // ── Domain detection & adaptive weights ──
    const domain = AIDetector.detectDomain(text, words);
    const adaptiveWeights = this._getAdaptiveWeights(domain);

    // ── Ensemble aggregation + calibration ──
    const rawProbability = this._ensembleAggregate(scores, adaptiveWeights);
    let calibrated = this._calibrate(rawProbability);

    // Damping for short texts (< 50 words): pull toward 0.5.
    const nWords = words.length;
    if (nWords < 50) {
      const damping = nWords / 50.0;
      calibrated = 0.5 + (calibrated - 0.5) * damping;
    }

    const aiProbability = calibrated;

    // ── Confidence ──
    const textLengthFactor = Math.min(words.length / 100, 1.0);
    const metricValues = Object.values(scores);
    const metricAgreement = 1.0 - sampleStdev(metricValues);
    const extremeBonus = Math.abs(aiProbability - 0.5) * 0.6;

    const thresholdForAi = 0.55;
    let nAgree;
    if (aiProbability > 0.5) {
      nAgree = metricValues.filter((v) => v >= thresholdForAi).length;
    } else {
      nAgree = metricValues.filter((v) => v < thresholdForAi).length;
    }
    const agreementRatio = metricValues.length
      ? nAgree / metricValues.length
      : 0;

    const confidence = Math.min(
      textLengthFactor * 0.35
        + metricAgreement * 0.2
        + extremeBonus
        + agreementRatio * 0.25,
      1.0,
    );

    // ── Verdict ──
    const keyMetrics = [
      'pattern', 'burstiness', 'stylometry', 'voice',
      'entity', 'grammar', 'opening', 'discourse',
    ];
    const nAiLeaning = keyMetrics.filter(
      (m) => (scores[m] ?? 0.5) > 0.55,
    ).length;

    let verdict;
    if (aiProbability > 0.60 || (aiProbability > 0.42 && nAiLeaning >= 4)) {
      verdict = 'ai';
    } else if (aiProbability > 0.38 && nAiLeaning >= 5) {
      verdict = 'ai';
    } else if (aiProbability > 0.32) {
      verdict = 'mixed';
    } else {
      verdict = 'human';
    }

    return {
      verdict,
      aiProbability,
      confidence,
      domain,
      // Stubbed metrics reported as neutral 0.5 (not part of weighting).
      scores: { ...scores, zipf: 0.5, coherence: 0.5, topic_sentence: 0.5 },
      explanations: this._generateExplanations(scores),
      wordCount: words.length,
      sentenceCount: sentences.length,
      lang,
    };
  }

  // ─── Domain detection ─────────────────────────────────────

  /**
   * Auto-detect text domain for adaptive thresholds.
   * @param {string} text
   * @param {string[]} words
   * @returns {string}
   */
  static detectDomain(text, words) {
    const textLower = text.toLowerCase();
    const total = words.length || 1;

    // Academic markers
    let academicCount = 0;
    for (const w of words) {
      if (ACADEMIC_WORDS.has(stripChars(w.toLowerCase(), '.,;:'))) academicCount++;
    }
    if (academicCount / total > 0.02) return 'academic';

    // Legal markers
    let legalCount = 0;
    for (const w of words) {
      if (LEGAL_WORDS.has(w.toLowerCase())) legalCount++;
    }
    if (legalCount >= 2) return 'legal';

    // Code/tech docs
    if (
      countSub(text, '```') >= 2
      || countSub(text, '`') > 5
      || (textLower.includes('function') && textLower.includes('return'))
      || (textLower.includes('class ') && textLower.includes('def '))
    ) {
      return 'code_docs';
    }

    // Social media / informal
    let informalCount = 0;
    for (const w of words) {
      if (INFORMAL_MARKERS.has(w.toLowerCase())) informalCount++;
    }
    if (
      informalCount >= 1
      || countSub(text, '!') > 3
      || countSub(text, '😂') + countSub(text, '🤣') > 0
    ) {
      return 'social';
    }

    // News (datelines)
    if (RE_NEWS_AGENCIES.test(text)) return 'news';
    // Short paragraphs with quotes = news style
    const paragraphs = text.split('\n').filter((p) => p.trim());
    const hasQuotes = countSub(text, '"') >= 4 || countSub(text, '«') >= 2;
    const avgParaLen = paragraphs.length
      ? mean(paragraphs.map((p) => tokens(p).length))
      : 50;
    if (hasQuotes && avgParaLen < 30 && paragraphs.length > 3) return 'news';

    // Blog = personal pronouns
    let personalCount = 0;
    for (const w of words) {
      if (BLOG_PERSONAL.has(w.toLowerCase())) personalCount++;
    }
    if (personalCount / total > 0.03) return 'blog';

    return 'general';
  }

  /** Domain-adjusted metric weights (renormalized to sum 1). */
  _getAdaptiveWeights(domain) {
    const weights = { ...WEIGHTS };
    const mods = DOMAIN_WEIGHT_MODS[domain] || {};
    for (const [metric, delta] of Object.entries(mods)) {
      if (metric in weights) {
        weights[metric] = Math.max(0.005, weights[metric] + delta);
      }
    }
    let total = 0;
    for (const v of Object.values(weights)) total += v;
    if (total > 0) {
      for (const k of Object.keys(weights)) weights[k] /= total;
    }
    return weights;
  }

  // ─── 1. Entropy ───────────────────────────────────────────

  _calcEntropy(text, words, lang) {
    if (words.length < 10) return 0.5;

    // Character-level Shannon entropy
    const charFreq = new Map();
    let totalChars = 0;
    for (const ch of text.toLowerCase()) {
      charFreq.set(ch, (charFreq.get(ch) || 0) + 1);
      totalChars++;
    }
    let charEntropy = 0;
    for (const c of charFreq.values()) {
      const p = c / totalChars;
      charEntropy -= p * Math.log2(p);
    }

    // Word-level entropy (empty-after-strip tokens included, as in Python)
    const wordFreq = new Map();
    for (const w of words) {
      const key = stripPunct(w.toLowerCase());
      wordFreq.set(key, (wordFreq.get(key) || 0) + 1);
    }
    const totalWords = words.length;
    let wordEntropy = 0;
    for (const c of wordFreq.values()) {
      const p = c / totalWords;
      wordEntropy -= p * Math.log2(p);
    }

    // Conditional entropy (bigram entropy - unigram entropy)
    const wordList = [];
    for (const w of words) {
      if (stripPunct(w)) wordList.push(stripPunct(w.toLowerCase()));
    }
    const bigrams = new Map();
    for (let i = 0; i < wordList.length - 1; i++) {
      const key = wordList[i] + '\u001f' + wordList[i + 1];
      bigrams.set(key, (bigrams.get(key) || 0) + 1);
    }
    let totalBigrams = 0;
    for (const c of bigrams.values()) totalBigrams += c;

    let conditionalEntropy;
    if (totalBigrams > 0) {
      let bigramEntropy = 0;
      for (const c of bigrams.values()) {
        const p = c / totalBigrams;
        bigramEntropy -= p * Math.log2(p);
      }
      conditionalEntropy = bigramEntropy - wordEntropy;
    } else {
      conditionalEntropy = wordEntropy;
    }

    // Language-specific baselines
    let charScore;
    let wordScore;
    let condScore;
    if (lang === 'ru' || lang === 'uk') {
      charScore = Math.max(0, 1.0 - (charEntropy - 4.0) / 1.5);
      wordScore = Math.max(0, 1.0 - (wordEntropy - 5.0) / 3.0);
      condScore = Math.max(0, 1.0 - conditionalEntropy / 4.0);
    } else {
      charScore = Math.max(0, 1.0 - (charEntropy - 3.0) / 2.0);
      wordScore = Math.max(0, 1.0 - (wordEntropy - 5.0) / 5.0);
      condScore = Math.max(0, 1.0 - conditionalEntropy / 3.0);
    }

    return clamp01(charScore * 0.2 + wordScore * 0.5 + condScore * 0.3);
  }

  // ─── 2. Burstiness ────────────────────────────────────────

  _calcBurstiness(sentences) {
    if (sentences.length < 4) return 0.5;

    const lengths = sentences.map((s) => tokens(s).length);
    const avg = mean(lengths);
    if (avg === 0) return 0.5;

    const stdev = lengths.length > 1 ? sampleStdev(lengths) : 0;
    const cv = stdev / avg;

    let score = Math.max(0, 1.0 - (cv - 0.1) / 0.7);
    if (avg < 10) score *= 0.7;

    const short = lengths.filter((l) => l <= 5).length;
    const longCnt = lengths.filter((l) => l >= 30).length;
    const extremes = lengths.length ? (short + longCnt) / lengths.length : 0;

    if (extremes < 0.05) score = Math.min(score + 0.07, 1.0);
    else if (extremes > 0.2) score = Math.max(score - 0.1, 0.0);

    return clamp01(score);
  }

  // ─── 3. Vocabulary diversity ──────────────────────────────

  _calcVocabulary(text, words, langPack) {
    if (!langPack) return 0.5; // universal mode
    if (words.length < 20) return 0.5;

    const stopWords = new Set(
      keysOf(langPack.stop_words).map((w) => w.toLowerCase()),
    );
    const contentWords = [];
    for (const w of words) {
      const lowStripped = stripPunct(w.toLowerCase());
      if (!stopWords.has(lowStripped) && stripPunct(w).length > 2) {
        contentWords.push(lowStripped);
      }
    }

    if (contentWords.length < 10) return 0.5;

    // TTR
    const typesSet = new Set(contentWords);
    const types = typesSet.size;
    const nTokens = contentWords.length;
    const ttr = types / nTokens;

    // MATTR (window 25)
    const window = 25;
    let mattr;
    if (nTokens >= window) {
      const mattrValues = [];
      for (let i = 0; i <= nTokens - window; i++) {
        mattrValues.push(
          new Set(contentWords.slice(i, i + window)).size / window,
        );
      }
      mattr = mean(mattrValues);
    } else {
      mattr = ttr;
    }

    // Yule's K
    const freq = new Map();
    for (const w of contentWords) freq.set(w, (freq.get(w) || 0) + 1);
    const spectrum = new Map();
    for (const c of freq.values()) spectrum.set(c, (spectrum.get(c) || 0) + 1);
    const N = nTokens;
    let M = 0;
    for (const [i, cnt] of spectrum) M += i * i * cnt;
    const yuleK = N > 1 ? (10000 * (M - N)) / (N * N) : 0;

    // Hapax legomena ratio
    let hapaxCount = 0;
    for (const c of freq.values()) if (c === 1) hapaxCount++;
    const hapaxRatio = types > 0 ? hapaxCount / types : 0;

    const lengthReliability = Math.min(nTokens / 150, 1.0);

    const ttrScore = Math.max(0, 1.0 - (ttr - 0.3) / 0.4);
    const mattrScore = Math.max(0, 1.0 - (mattr - 0.6) / 0.3);
    const yuleScore = Math.min(yuleK / 150, 1.0);
    const hapaxScore = Math.max(0, 1.0 - hapaxRatio / 0.5);

    const rawScore =
      ttrScore * 0.2 + mattrScore * 0.3 + yuleScore * 0.25 + hapaxScore * 0.25;

    return clamp01(0.5 + (rawScore - 0.5) * lengthReliability);
  }

  // ─── 5. Stylometry ────────────────────────────────────────

  _calcStylometry(text, words, sentences, langPack) {
    if (!langPack) return 0.5; // universal mode
    if (words.length < 20) return 0.5;

    const stopWords = new Set(
      keysOf(langPack.stop_words).map((w) => w.toLowerCase()),
    );
    const wordLengths = [];
    for (const w of words) {
      const stripped = stripPunct(w);
      if (stripped) wordLengths.push(stripped.length);
    }

    // 1. Average word length (AI prefers longer words)
    const avgWordLen = wordLengths.length ? mean(wordLengths) : 0;
    const wordLenScore = Math.max(0, (avgWordLen - 4.0) / 3.0);

    // 2. Word length variation (AI more uniform)
    let wordVarScore;
    if (wordLengths.length > 5) {
      const wordLenCv = avgWordLen > 0 ? sampleStdev(wordLengths) / avgWordLen : 0;
      wordVarScore = Math.max(0, 1.0 - wordLenCv / 0.7);
    } else {
      wordVarScore = 0.5;
    }

    // 3. Long-word ratio (> 8 letters)
    const longWords = wordLengths.filter((wl) => wl > 8).length;
    const longRatio = wordLengths.length ? longWords / wordLengths.length : 0;
    const longScore = Math.min(longRatio / 0.15, 1.0);

    // 4. Average sentence length
    const sentLengths = sentences.map((s) => tokens(s).length);
    const avgSentLen = sentLengths.length ? mean(sentLengths) : 0;
    const sentLenScore = Math.max(0, (avgSentLen - 10) / 15);

    // 5. Stop-word ratio (AI often lower)
    let stopCount = 0;
    for (const w of words) {
      if (stopWords.has(stripPunct(w.toLowerCase()))) stopCount++;
    }
    const stopRatio = words.length ? stopCount / words.length : 0;
    const stopScore = Math.max(0, 1.0 - (stopRatio - 0.25) / 0.3);

    return clamp01(
      wordLenScore * 0.2
        + wordVarScore * 0.15
        + longScore * 0.2
        + sentLenScore * 0.25
        + stopScore * 0.2,
    );
  }

  // ─── 6. AI patterns (strongest signal) ────────────────────

  /** Build merged marker dict: built-ins for the language + langPack extras. */
  _getMarkerDict(lang, langPack) {
    const builtin = AI_MARKERS[lang] || AI_MARKERS.en;
    const merged = {
      adverbs: new Set(builtin.adverbs || []),
      adjectives: new Set(builtin.adjectives || []),
      verbs: new Set(builtin.verbs || []),
      connectors: new Set(builtin.connectors || []),
      phrases: new Set(builtin.phrases || []),
      bureaucratic: new Set(),
    };
    const formalStarters = new Set(FORMAL_STARTERS);

    if (langPack) {
      for (const k of keysOf(langPack.ai_connectors)) {
        merged.connectors.add(k);
        formalStarters.add(k.toLowerCase());
      }
      const singleWordSeen = new Set(
        [...merged.adverbs, ...merged.adjectives, ...merged.verbs,
          ...merged.connectors].map((w) => w.toLowerCase()),
      );
      for (const k of keysOf(langPack.bureaucratic)) {
        if (k.includes(' ')) merged.phrases.add(k);
        else if (k.length >= 5 && !singleWordSeen.has(k.toLowerCase())) {
          merged.bureaucratic.add(k);
        }
      }
      for (const k of keysOf(langPack.bureaucratic_phrases)) {
        merged.phrases.add(k);
      }
      // Only multi-word sentence starters are safe as formal-start markers.
      for (const k of keysOf(langPack.sentence_starters)) {
        if (k.includes(' ')) formalStarters.add(k.toLowerCase());
      }
    }
    return { merged, formalStarters };
  }

  _calcAiPatterns(text, words, sentences, lang, langPack) {
    if (words.length < 20) return 0.5;

    const textLower = text.toLowerCase();
    const totalWords = words.length;
    const { merged, formalStarters } = this._getMarkerDict(lang, langPack);

    let weightedHits = 0.0;

    // 1. AI-overused words (substring counts, like Python)
    const categoryWeights = [
      ['adverbs', 1.5], ['adjectives', 1.3], ['verbs', 1.5],
      ['connectors', 2.0], ['bureaucratic', 1.5],
    ];
    for (const [category, weight] of categoryWeights) {
      for (const w of merged[category]) {
        const count = countSub(textLower, w.toLowerCase());
        if (count > 0) weightedHits += count * weight;
      }
    }

    // 2. AI phrases (strongest signal, triple weight)
    for (const phrase of merged.phrases) {
      const count = countSub(textLower, phrase.toLowerCase());
      if (count > 0) weightedHits += count * 3.0;
    }

    const density = totalWords > 0 ? weightedHits / totalWords : 0;

    // 3. Connector density (presence per connector, / sentences)
    let connectorCount = 0;
    for (const conn of merged.connectors) {
      if (textLower.includes(conn.toLowerCase())) connectorCount++;
    }
    const connectorDensity = sentences.length
      ? connectorCount / sentences.length
      : 0;

    // 4. Formal connectors at sentence starts
    let formalStarts = 0;
    for (const sent of sentences) {
      const firstWords = rstripChars(
        tokens(sent).slice(0, 3).join(' ').toLowerCase(),
        '.,;:',
      );
      for (const starter of formalStarters) {
        if (firstWords.startsWith(starter)) {
          formalStarts++;
          break;
        }
      }
    }
    const formalStartRatio = sentences.length
      ? formalStarts / sentences.length
      : 0;

    const densityScore = Math.min(density / 0.05, 1.0);
    const connectorScore = Math.min(connectorDensity / 0.15, 1.0);
    const formalScore = Math.min(formalStartRatio / 0.2, 1.0);

    // 5. Impersonal / hedging constructions
    let hedgeCount = 0;
    for (const re of HEDGING_PATTERNS) hedgeCount += countMatches(textLower, re);
    const hedgeScore = Math.min(
      hedgeCount / Math.max(sentences.length * 0.15, 1),
      1.0,
    );

    // 6. Enumeration patterns
    let enumCount = 0;
    for (const re of ENUM_PATTERNS) enumCount += countMatches(textLower, re);
    const enumScore = Math.min(enumCount / 3, 1.0);

    // 7. Paragraph symmetry (split on single newlines; population CV)
    const paragraphs = text.split('\n').map((p) => p.trim()).filter(Boolean);
    let symmetryScore = 0.0;
    if (paragraphs.length >= 3) {
      const paraLens = paragraphs.map((p) => tokens(p).length);
      if (paraLens.length) {
        const meanLen = mean(paraLens);
        if (meanLen > 0) {
          let dev = 0;
          for (const x of paraLens) dev += (x - meanLen) ** 2;
          const cv = Math.sqrt(dev / paraLens.length) / meanLen;
          symmetryScore = Math.max(0, 1.0 - cv * 2);
        }
      }
    }

    return clamp01(
      densityScore * 0.20
        + connectorScore * 0.12
        + formalScore * 0.15
        + hedgeScore * 0.30
        + enumScore * 0.10
        + symmetryScore * 0.13,
    );
  }

  // ─── 7. Punctuation profile ───────────────────────────────

  _calcPunctuation(text, sentences) {
    if (text.length < 50) return 0.5;

    const totalChars = text.length;
    const semicolons = countSub(text, ';');
    const colons = countSub(text, ':');
    const emDashes = countSub(text, '—') + countSub(text, '–');
    const ellipsis = countSub(text, '...') + countSub(text, '…');
    const exclamations = countSub(text, '!');
    const questions = countSub(text, '?');
    const parens = countSub(text, '(');

    const k = 1000 / totalChars;
    const semiRate = semicolons * k;
    const colonRate = colons * k;
    const dashRate = emDashes * k;
    const ellipsisRate = ellipsis * k;
    const exclRate = exclamations * k;

    const semiScore = Math.min(semiRate / 3.0, 1.0);
    const colonScore = Math.min(colonRate / 3.0, 1.0);
    const dashScore = Math.min(dashRate / 4.0, 1.0);
    const ellipsisScore = Math.max(0, 1.0 - ellipsisRate / 2.0);
    const exclScore = Math.max(0, 1.0 - exclRate / 2.0);

    const punctTypes = [
      semicolons, colons, emDashes, ellipsis, exclamations, questions, parens,
    ].filter((v) => v > 0).length;
    const diversityScore = Math.max(0, 1.0 - punctTypes / 5.0);

    return clamp01(
      semiScore * 0.2
        + colonScore * 0.15
        + dashScore * 0.15
        + ellipsisScore * 0.15
        + exclScore * 0.1
        + diversityScore * 0.25,
    );
  }

  // ─── 9. Grammar "perfection" ──────────────────────────────

  _calcGrammar(text, sentences) {
    if (sentences.length < 3) return 0.5;

    const indicators = [];

    // 1. All sentences start uppercase?
    const allUppercase = sentences.filter(
      (s) => s && RE_UPPER_FIRST.test(s),
    ).length;
    const upperRatio = sentences.length ? allUppercase / sentences.length : 0;
    indicators.push(
      upperRatio === 1.0 ? 1.0 : Math.max(0, upperRatio - 0.9) * 10,
    );

    // 2. All sentences end with punctuation?
    const allPunctEnd = sentences.filter((s) => {
      const t = s.trimEnd();
      return t && '.!?…'.includes(t[t.length - 1]);
    }).length;
    const punctRatio = sentences.length ? allPunctEnd / sentences.length : 0;
    indicators.push(
      punctRatio === 1.0 ? 1.0 : Math.max(0, punctRatio - 0.85) * 6.7,
    );

    // 3. Balanced parentheses — AI always closes them
    const openParens = countSub(text, '(');
    const closeParens = countSub(text, ')');
    const parenBalance = Math.abs(openParens - closeParens);
    indicators.push(parenBalance === 0 && openParens > 0 ? 1.0 : 0.0);

    // 4. No contractions in EN text — AI writes full forms
    if (/[A-Za-z]/.test(text)) {
      const contractions = countMatches(text, RE_CONTRACTIONS);
      const totalW = tokens(text).length;
      const contractionRatio = totalW > 0 ? contractions / totalW : 0;
      indicators.push(Math.max(0, 1.0 - contractionRatio / 0.03));
    }

    // 5. Uniform paragraph lengths
    const paragraphs = text.split('\n\n').map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length > 2) {
      const paraLengths = paragraphs.map((p) => tokens(p).length);
      const avgPara = mean(paraLengths);
      if (avgPara > 0) {
        const paraCv =
          paraLengths.length > 1 ? sampleStdev(paraLengths) / avgPara : 0;
        indicators.push(Math.max(0, 1.0 - paraCv / 0.5));
      }
    }

    // 6. Oxford comma usage
    const oxfordMatches = countMatches(text, RE_OXFORD);
    const listAnds = countMatches(text, RE_AND);
    if (listAnds > 2) {
      const oxfordRatio = oxfordMatches / listAnds;
      indicators.push(Math.min(oxfordRatio / 0.3, 1.0));
    }

    // 7. Absence of sentence fragments (< 4 words)
    const fragmentCount = sentences.filter((s) => tokens(s).length < 4).length;
    const fragmentRatio = sentences.length
      ? fragmentCount / sentences.length
      : 0;
    indicators.push(Math.max(0, 1.0 - fragmentRatio / 0.15));

    // 8. No informal punctuation (!! … ???)
    const informalPunct = countMatches(text, RE_INFORMAL_PUNCT);
    if (sentences.length > 5) {
      const punctInformality = informalPunct / sentences.length;
      indicators.push(Math.max(0, 1.0 - punctInformality / 0.1));
    }

    // 9. Structured lists present
    const bulletLines = countMatches(text, RE_BULLET_LINES);
    const numberedLines = countMatches(text, RE_NUMBERED_LINES);
    if (bulletLines + numberedLines >= 3) indicators.push(0.8);

    let score = indicators.length ? mean(indicators) : 0.5;
    // Weak signal: dampen toward 0.5
    score = 0.5 + (score - 0.5) * 0.5;
    return clamp01(score);
  }

  // ─── 10. Sentence openings ────────────────────────────────

  _calcOpenings(sentences) {
    if (sentences.length < 5) return 0.5;

    const firstWords = [];
    for (const s of sentences) {
      const ws = tokens(s);
      if (ws.length) {
        firstWords.push(rstripChars(ws[0].toLowerCase(), '.,;:'));
      }
    }
    if (!firstWords.length) return 0.5;

    // 1. Uniqueness of first words
    const nFirst = firstWords.length;
    const uniqueRatio = nFirst ? new Set(firstWords).size / nFirst : 0;
    const uniqueScore = Math.max(0, 1.0 - (uniqueRatio - 0.2) / 0.6);

    // 2. Max repetition of a single opening
    const counter = new Map();
    for (const w of firstWords) counter.set(w, (counter.get(w) || 0) + 1);
    let maxRepeat = 0;
    for (const c of counter.values()) if (c > maxRepeat) maxRepeat = c;
    const repeatRatio = nFirst ? maxRepeat / nFirst : 0;
    const repeatScore = Math.min(repeatRatio / 0.3, 1.0);

    // 3. Subject-first starts
    const subjectStarts = firstWords.filter((w) =>
      SUBJECT_PRONOUNS.has(w),
    ).length;
    const subjectRatio = firstWords.length
      ? subjectStarts / firstWords.length
      : 0;
    const subjectScore = Math.min(subjectRatio / 0.5, 1.0);

    // 4. Consecutive identical starts
    let consecutiveSame = 0;
    for (let i = 1; i < firstWords.length; i++) {
      if (firstWords[i] === firstWords[i - 1]) consecutiveSame++;
    }
    const consecRatio =
      firstWords.length > 1 ? consecutiveSame / (firstWords.length - 1) : 0;
    const consecScore = Math.min(consecRatio / 0.15, 1.0);

    return clamp01(
      uniqueScore * 0.3
        + repeatScore * 0.25
        + subjectScore * 0.2
        + consecScore * 0.25,
    );
  }

  // ─── 11. Readability consistency ──────────────────────────

  _calcReadabilityConsistency(sentences) {
    if (sentences.length < 6) return 0.5;

    const windowSize = 3;
    const windows = [];
    for (let i = 0; i + windowSize <= sentences.length; i += windowSize) {
      const windowText = sentences.slice(i, i + windowSize).join(' ');
      const ws = tokens(windowText);
      if (ws.length) {
        const avgWordLen = mean(ws.map((w) => w.length));
        const avgSentLen = mean(
          sentences.slice(i, i + windowSize).map((s) => tokens(s).length),
        );
        windows.push(avgWordLen * 0.5 + avgSentLen * 0.5);
      }
    }

    if (windows.length < 3) return 0.5;

    const avgR = mean(windows);
    const stdevR = windows.length > 1 ? sampleStdev(windows) : 0;
    const cvR = stdevR / avgR;

    return clamp01(Math.max(0, 1.0 - cvR / 0.2));
  }

  // ─── 12. Rhythm ───────────────────────────────────────────

  _calcRhythm(sentences) {
    if (sentences.length < 5) return 0.5;

    const lengths = sentences.map((s) => tokens(s).length);
    const n = lengths.length;
    const meanL = mean(lengths);
    const varL = n > 1 ? sampleVariance(lengths) : 1;

    // 1. Lag-1 autocorrelation
    let autocorr;
    if (varL === 0) {
      autocorr = 1.0;
    } else {
      let numerator = 0;
      for (let i = 0; i < n - 1; i++) {
        numerator += (lengths[i] - meanL) * (lengths[i + 1] - meanL);
      }
      numerator /= n - 1;
      autocorr = numerator / varL;
    }
    const autocorrScore = Math.max(0, (autocorr + 0.1) / 0.7);

    // 2. Runs of same length category
    const categories = lengths.map((l) => (l <= 8 ? 'S' : l <= 20 ? 'M' : 'L'));
    let runs = 1;
    for (let i = 1; i < categories.length; i++) {
      if (categories[i] !== categories[i - 1]) runs++;
    }
    const runRatio = n > 0 ? runs / n : 0;
    const runScore = Math.max(0, 1.0 - runRatio / 0.8);

    // 3. Length "couplets" (adjacent within ±3 words)
    let pairs = 0;
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(lengths[i] - lengths[i + 1]) <= 3) pairs++;
    }
    const pairRatio = n > 1 ? pairs / (n - 1) : 0;
    const pairScore = Math.min(pairRatio / 0.5, 1.0);

    return clamp01(autocorrScore * 0.4 + runScore * 0.3 + pairScore * 0.3);
  }

  // ─── 13. N-gram perplexity ────────────────────────────────

  _calcPerplexity(text, sentences, lang) {
    if (sentences.length < 4) return 0.5;

    // Character trigram model over the whole text
    const textLower = text.toLowerCase();
    const trigramCounts = new Map();
    const bigramCounts = new Map();
    for (let i = 0; i < textLower.length - 2; i++) {
      const trigram = textLower.slice(i, i + 3);
      const bigram = textLower.slice(i, i + 2);
      trigramCounts.set(trigram, (trigramCounts.get(trigram) || 0) + 1);
      bigramCounts.set(bigram, (bigramCounts.get(bigram) || 0) + 1);
    }
    if (!bigramCounts.size) return 0.5;

    const vocab = trigramCounts.size;
    const sentPerplexities = [];
    for (const sent of sentences) {
      const sentLower = sent.toLowerCase().trim();
      if (sentLower.length < 5) continue;

      let logProbSum = 0;
      let nTrigrams = 0;
      for (let i = 0; i < sentLower.length - 2; i++) {
        const trigram = sentLower.slice(i, i + 3);
        const bigram = sentLower.slice(i, i + 2);
        const triCount = trigramCounts.get(trigram) || 0;
        const biCount = bigramCounts.get(bigram) || 0;
        if (biCount > 0) {
          const prob = (triCount + 1) / (biCount + vocab + 1);
          logProbSum += Math.log(prob);
          nTrigrams++;
        }
      }
      if (nTrigrams > 0) {
        sentPerplexities.push(Math.exp(-(logProbSum / nTrigrams)));
      }
    }

    if (sentPerplexities.length < 3) return 0.5;

    const avgPerplexity = mean(sentPerplexities);
    const perplexityStd = sampleStdev(sentPerplexities);
    const perplexityCv = avgPerplexity > 0 ? perplexityStd / avgPerplexity : 0;

    const avgScore = Math.max(0, 1.0 - (avgPerplexity - 3.0) / 15.0);
    const cvScore = Math.max(0, 1.0 - perplexityCv / 0.4);

    // Cross-perplexity against embedded reference corpus
    const xp = crossPerplexity(text, lang);
    const refPp = getReferencePerplexity(lang);
    const xpDeviation = refPp > 0 ? Math.abs(xp - refPp) / refPp : 0;
    const xpScore = Math.max(0, 1.0 - xpDeviation / 0.5);

    return clamp01(avgScore * 0.35 + cvScore * 0.35 + xpScore * 0.30);
  }

  // ─── 14. Discourse structure ──────────────────────────────

  _calcDiscourse(text, sentences) {
    const paragraphs = text.split('\n\n').map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length < 3) {
      return this._calcDiscourseFlat(text, sentences);
    }

    const indicators = [];

    // 1. Conclusion markers in the last paragraph
    const lastPara = paragraphs[paragraphs.length - 1].toLowerCase();
    const hasConclusion = CONCLUSION_MARKERS.some((m) => lastPara.includes(m));
    indicators.push(hasConclusion ? 1.0 : 0.0);

    // 2. Intro markers in the first paragraph
    const firstPara = paragraphs[0].toLowerCase();
    const hasIntro = INTRO_MARKERS.some((m) => firstPara.includes(m));
    indicators.push(hasIntro ? 0.9 : 0.1);

    // 3. Uniform body paragraph lengths
    if (paragraphs.length > 3) {
      const body = paragraphs.slice(1, -1);
      const bodyLengths = body.map((p) => tokens(p).length);
      if (bodyLengths.length >= 2) {
        const avgBl = mean(bodyLengths);
        if (avgBl > 0) {
          const cvBl = sampleStdev(bodyLengths) / avgBl;
          indicators.push(Math.max(0, 1.0 - cvBl / 0.5));
        }
      }
    }

    // 4. Paragraphs starting with transition words
    if (paragraphs.length > 2) {
      let transCount = 0;
      for (const p of paragraphs.slice(1)) {
        const firstW = tokens(p).slice(0, 3).join(' ').toLowerCase();
        if (DISCOURSE_TRANSITIONS.some((t) => firstW.startsWith(t))) {
          transCount++;
        }
      }
      const ratio = transCount / (paragraphs.length - 1);
      indicators.push(Math.min(ratio / 0.4, 1.0));
    }

    // 5. Parallel structure: same first word across paragraphs
    if (paragraphs.length >= 4) {
      const firstWords = [];
      for (const p of paragraphs) {
        const ws = tokens(p);
        if (ws.length) firstWords.push(rstripChars(ws[0].toLowerCase(), '.,;:'));
      }
      const counter = new Map();
      for (const w of firstWords) counter.set(w, (counter.get(w) || 0) + 1);
      let maxSame = 0;
      for (const c of counter.values()) if (c > maxSame) maxSame = c;
      const parallelism = firstWords.length ? maxSame / firstWords.length : 0;
      indicators.push(Math.min(parallelism / 0.3, 1.0));
    }

    return indicators.length ? clamp01(mean(indicators)) : 0.5;
  }

  _calcDiscourseFlat(text, sentences) {
    if (sentences.length < 5) return 0.5;

    const indicators = [];
    const firstSent = sentences[0].toLowerCase();
    const lastSent = sentences[sentences.length - 1].toLowerCase();

    indicators.push(
      FLAT_CONCLUSION_WORDS.some((w) => lastSent.includes(w)) ? 0.8 : 0.2,
    );
    indicators.push(
      FLAT_INTRO_WORDS.some((w) => firstSent.includes(w)) ? 0.7 : 0.3,
    );

    return indicators.length ? clamp01(mean(indicators)) : 0.5;
  }

  // ─── 15. Semantic repetition ──────────────────────────────

  _calcSemanticRepetition(text, sentences) {
    if (sentences.length < 5) return 0.5;

    const sentWords = [];
    for (const s of sentences) {
      const set = new Set();
      for (const w of tokens(s)) {
        if (stripPunct(w).length > 3) set.add(stripPunct(w.toLowerCase()));
      }
      if (set.size) sentWords.push(set);
    }

    if (sentWords.length < 4) return 0.5;

    let highSimCount = 0;
    let totalPairs = 0;
    const simValues = [];

    for (let i = 0; i < sentWords.length; i++) {
      for (let j = i + 2; j < Math.min(i + 6, sentWords.length); j++) {
        let intersection = 0;
        for (const w of sentWords[i]) if (sentWords[j].has(w)) intersection++;
        const union = sentWords[i].size + sentWords[j].size - intersection;
        if (union > 0) {
          const sim = intersection / union;
          simValues.push(sim);
          totalPairs++;
          if (sim > 0.35) highSimCount++;
        }
      }
    }

    if (!simValues.length) return 0.5;

    const avgSim = mean(simValues);
    const highSimRatio = totalPairs > 0 ? highSimCount / totalPairs : 0;

    const simScore = Math.min(avgSim / 0.2, 1.0);
    const ratioScore = Math.min(highSimRatio / 0.15, 1.0);

    return clamp01(simScore * 0.5 + ratioScore * 0.5);
  }

  // ─── 16. Entity specificity ───────────────────────────────

  _calcEntitySpecificity(text, words) {
    if (words.length < 20) return 0.5;

    const total = words.length;
    const textLower = text.toLowerCase();
    const indicators = [];

    // 1. Generic quantifiers
    let genericCount = 0;
    for (const w of words) {
      if (GENERIC_QUANTS.has(w.toLowerCase())) genericCount++;
    }
    for (const phrase of GENERIC_QUANT_PHRASES) {
      genericCount += countSub(textLower, phrase);
    }
    indicators.push(Math.min(genericCount / total / 0.03, 1.0));

    // 2. Specific numbers / proper nouns (human markers)
    const specificNums = countMatches(text, RE_SPECIFIC_NUMS);
    let properNouns = 0;
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      if (
        RE_UPPER_FIRST.test(w)
        && RE_ALPHA_ONLY.test(w)
        && w.length > 1
      ) {
        const prev = words[i - 1];
        if (!/[.!?:"\n]$/.test(prev)) properNouns++;
      }
    }
    const specificity = (specificNums + properNouns) / total;
    indicators.push(Math.max(0, 1.0 - specificity / 0.08));

    // 3. Personal references
    let personalCount = 0;
    for (const w of words) {
      if (PERSONAL_REFS.has(w.toLowerCase())) personalCount++;
    }
    indicators.push(Math.max(0, 1.0 - personalCount / total / 0.04));

    // 4. Hedging language
    let hedgeCount = 0;
    for (const w of words) {
      if (HEDGE_WORDS.has(w.toLowerCase())) hedgeCount++;
    }
    for (const phrase of HEDGE_WORDS) {
      if (phrase.includes(' ')) hedgeCount += countSub(textLower, phrase);
    }
    indicators.push(Math.min(hedgeCount / total / 0.02, 1.0));

    return indicators.length ? clamp01(mean(indicators)) : 0.5;
  }

  // ─── 17. Voice (passive vs active) ────────────────────────

  _calcVoice(text, sentences) {
    if (sentences.length < 4) return 0.5;

    const textLower = text.toLowerCase();
    const totalClauses = sentences.length;

    let passiveCount = 0;
    for (const re of PASSIVE_PATTERNS) {
      passiveCount += countMatches(textLower, re);
    }

    let nominalizationCount = 0;
    for (const re of NOMINALIZATION_PATTERNS) {
      nominalizationCount += countMatches(textLower, re);
    }

    const passiveRatio = totalClauses > 0 ? passiveCount / totalClauses : 0;
    const passiveScore = Math.min(passiveRatio / 0.4, 1.0);

    const wordCount = tokens(text).length;
    const nomRatio = wordCount > 0 ? nominalizationCount / wordCount : 0;
    const nomScore = Math.min(nomRatio / 0.07, 1.0);

    let activeMarkers = 0;
    for (const re of ACTIVE_MARKER_PATTERNS) {
      activeMarkers += countMatches(text, re);
    }
    const activeRatio = totalClauses > 0 ? activeMarkers / totalClauses : 0;
    const activeScore = Math.max(0, 1.0 - activeRatio / 0.3);

    return clamp01(passiveScore * 0.35 + nomScore * 0.35 + activeScore * 0.30);
  }

  // ─── Ensemble aggregation ─────────────────────────────────

  _ensembleAggregate(scores, weights) {
    const w = weights || WEIGHTS;

    // 1. Weighted sum (base learner)
    let weightedSum = 0;
    for (const k of Object.keys(scores)) weightedSum += scores[k] * w[k];
    let totalWeight = 0;
    for (const v of Object.values(w)) totalWeight += v;
    const baseScore = weightedSum / totalWeight;

    // 2. Strong signal detector
    const strongMetrics = [
      'pattern', 'burstiness', 'opening', 'stylometry',
      'discourse', 'voice', 'grammar',
    ];
    const strongVals = strongMetrics.map((m) => scores[m] ?? 0.5);
    const strongAvg = mean(strongVals);

    let strongScore;
    if (strongAvg > 0.55) strongScore = 0.5 + (strongAvg - 0.5) * 1.8;
    else if (strongAvg < 0.35) strongScore = 0.5 + (strongAvg - 0.5) * 1.5;
    else strongScore = strongAvg;
    strongScore = clamp01(strongScore);

    // 3. Majority voting
    const aiThreshold = 0.55;
    const values = Object.values(scores);
    const nAi = values.filter((v) => v >= aiThreshold).length;
    const voteRatio = values.length ? nAi / values.length : 0.5;

    let voteScore;
    if (voteRatio > 0.6 || voteRatio < 0.4) {
      voteScore = 0.5 + (voteRatio - 0.5) * 1.5;
    } else {
      voteScore = voteRatio;
    }
    voteScore = clamp01(voteScore);

    return clamp01(baseScore * 0.40 + strongScore * 0.40 + voteScore * 0.20);
  }

  // ─── Calibration ──────────────────────────────────────────

  _calibrate(raw) {
    const k = 5.0;
    const center = 0.45;
    return 1.0 / (1.0 + Math.exp(-k * (raw - center)));
  }

  // ─── Explanations ─────────────────────────────────────────

  /**
   * Simplified explanations: {metric, score, textKey}. Localization
   * happens in the UI via textKey ("ai.<metric>" / "human.<metric>").
   * @param {Object<string, number>} scores computed metric scores
   * @returns {Explanation[]}
   */
  _generateExplanations(scores) {
    const explanations = [];
    const threshold = 0.6;

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

    for (const [metric, score] of sorted) {
      if (score >= threshold) {
        explanations.push({
          metric,
          score: Math.round(score * 10000) / 10000,
          textKey: `ai.${metric}`,
        });
      }
    }

    // Human-like indicators (first 3 low scorers, subset only — as Python)
    const humanFeatures = sorted.filter(([, s]) => s < 0.3).slice(0, 3);
    for (const [metric, score] of humanFeatures) {
      if (HUMAN_EXPLANATION_KEYS.has(metric)) {
        explanations.push({
          metric,
          score: Math.round(score * 10000) / 10000,
          textKey: `human.${metric}`,
        });
      }
    }

    return explanations;
  }
}

/**
 * Convenience wrapper.
 *
 * @param {string} text
 * @param {{lang?: string, langPack?: LangPack|null}} [options]
 * @returns {DetectionResult}
 */
export function detectAi(text, options = {}) {
  return new AIDetector().detect(text, options);
}

export default AIDetector;
