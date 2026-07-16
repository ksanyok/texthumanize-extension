/**
 * Sentence-level paraphrase engine for deep text humanization.
 *
 * Ported from the TextHumanize library (`texthumanize/paraphrase_engine.py`,
 * class `ParaphraseEngine`). Performs structural rewrites that go beyond
 * word-level synonym swaps:
 *   1. Multi-word expression (MWE) simplification ("in order to" -> "to")
 *   2. Connector deletion (drop AI-typical sentence-initial discourse markers)
 *   3. Hedging modulation ("clearly demonstrates" -> "suggests")
 *   4. Perspective rotation ("The study shows X" -> "X, as the study shows")
 *   5. Clause embedding (merge two adjacent sentences into one)
 *   6. Fragment creation (rhetorical short fragments for naturalness)
 *
 * Built-in rule tables cover EN, RU, UK, FR, ES, DE (as in the Python source).
 * For any other language a supplied `langPack` is used to derive MWE / connector
 * rules from its `bureaucratic_phrases` / `ai_connectors`; when `langPack` is
 * null the engine degrades gracefully (falls back to the English tables for the
 * word-level transforms and skips language-specific structural rewrites).
 *
 * Determinism: all random choices go through the seeded {@link Rng} from
 * `util.js`, so a given (text, lang, intensity, seed) always yields the same
 * output. Meaning preservation is prioritised over aggressiveness. URLs, emails
 * and code spans are masked before transformation and restored afterwards.
 *
 * Zero dependencies.
 * @module engine/paraphrase
 */

import { Rng, splitSentences, escapeRegex } from './util.js';

// ═══════════════════════════════════════════════════════════════
//  Multi-word expression simplification tables  [pattern, replacement]
// ═══════════════════════════════════════════════════════════════

/** @type {Array<[string, string]>} */
const MWE_EN = [
  ['in order to', 'to'],
  ['in the context of', 'about'],
  ['in light of the fact that', 'since'],
  ['due to the fact that', 'because'],
  ['owing to the fact that', 'because'],
  ['on the basis of', 'based on'],
  ['with regard to', 'about'],
  ['with respect to', 'about'],
  ['in terms of', 'for'],
  ['in the event that', 'if'],
  ['in the case of', 'for'],
  ['in spite of the fact that', 'although'],
  ['for the purpose of', 'to'],
  ['by means of', 'by'],
  ['as a result of', 'from'],
  ['at the present time', 'now'],
  ['at this point in time', 'now'],
  ['in the near future', 'soon'],
  ['a significant number of', 'many'],
  ['a considerable amount of', 'much'],
  ['the vast majority of', 'most'],
  ['a wide range of', 'many'],
  ['a wide variety of', 'many'],
  ['an extensive range of', 'many'],
  ['it is important to note that', 'notably,'],
  ['it is worth noting that', 'notably,'],
  ['it should be noted that', 'note that'],
  ['it is essential to', 'we must'],
  ['it is necessary to', 'we need to'],
  ['it is crucial to', 'we must'],
  ['it is evident that', 'clearly,'],
  ['it is clear that', 'clearly,'],
  ['it is undeniable that', 'indeed,'],
  ['there is no doubt that', 'certainly,'],
  ['it can be argued that', 'perhaps'],
  ['it goes without saying that', 'of course,'],
  ['has the potential to', 'can'],
  ['has the ability to', 'can'],
  ['is capable of', 'can'],
  ['is able to', 'can'],
  ['plays a crucial role in', 'matters for'],
  ['plays a pivotal role in', 'matters for'],
  ['plays a significant role in', 'matters for'],
  ['is a key factor in', 'shapes'],
  ['serves as a catalyst for', 'drives'],
  ['lays the groundwork for', 'prepares for'],
  ['paves the way for', 'enables'],
  ['give rise to', 'cause'],
  ['take into account', 'consider'],
  ['take into consideration', 'consider'],
  ['make use of', 'use'],
  ['make a contribution to', 'contribute to'],
  ['come to the conclusion that', 'conclude that'],
  ['reach the conclusion that', 'conclude that'],
  ['first and foremost', 'first'],
  ['last but not least', 'finally'],
  ['in conclusion', 'overall'],
  ['to summarize', 'overall'],
  ['all things considered', 'overall'],
  ['as a consequence', 'so'],
  ['as a matter of fact', 'actually'],
  ['needless to say', 'of course'],
  ['on the other hand', 'but'],
  ['at the same time', 'also'],
  ['for this reason', 'so'],
  ['in addition to this', 'also'],
  ['in this regard', 'here'],
];

/** @type {Array<[string, string]>} */
const MWE_RU = [
  ['в связи с тем, что', 'потому что'],
  ['в связи с тем что', 'потому что'],
  ['в силу того, что', 'потому что'],
  ['в силу того что', 'потому что'],
  ['по причине того, что', 'из-за того что'],
  ['исходя из того, что', 'раз'],
  ['вследствие того, что', 'из-за того что'],
  ['с целью обеспечения', 'чтобы обеспечить'],
  ['для того чтобы', 'чтобы'],
  ['с тем чтобы', 'чтобы'],
  ['в целях обеспечения', 'чтобы'],
  ['необходимо отметить, что', 'заметим, что'],
  ['необходимо подчеркнуть, что', 'важно, что'],
  ['следует отметить, что', 'стоит сказать, что'],
  ['важно понимать, что', 'надо понимать:'],
  ['в настоящее время', 'сейчас'],
  ['на сегодняшний день', 'сегодня'],
  ['в первую очередь', 'прежде всего'],
  ['в рамках данного', 'в этом'],
  ['представляет собой', 'это'],
  ['является ключевым', 'важен'],
  ['является одним из', 'один из'],
  ['в конечном счёте', 'в итоге'],
  ['таким образом', 'так'],
  ['вместе с тем', 'при этом'],
  ['в частности', 'например'],
  ['помимо этого', 'ещё'],
  ['кроме того', 'ещё'],
  ['более того', 'и даже'],
  ['по мнению экспертов', 'по оценкам'],
  ['согласно данным', 'по данным'],
  ['значительное количество', 'много'],
  ['в значительной степени', 'во многом'],
  ['на протяжении длительного времени', 'долго'],
  ['играет ключевую роль', 'важен'],
  ['имеет большое значение', 'важно'],
  ['оказывает влияние на', 'влияет на'],
  ['оказывает воздействие на', 'действует на'],
  ['принимая во внимание', 'учитывая'],
  ['с учётом того, что', 'раз'],
  ['на основании вышеизложенного', 'итак'],
  ['в соответствии с', 'по'],
  ['в совокупности с', 'вместе с'],
  ['в процессе реализации', 'при выполнении'],
  ['на данном этапе', 'пока'],
  ['в данном контексте', 'тут'],
  ['при всём при том', 'и всё же'],
  ['не представляется возможным', 'нельзя'],
  ['имеет место быть', 'есть'],
  ['осуществлять деятельность', 'работать'],
  ['предпринимать действия', 'действовать'],
  ['оказывать содействие', 'помогать'],
  ['осуществлять контроль', 'контролировать'],
  ['обеспечивать реализацию', 'выполнять'],
  ['производить оценку', 'оценивать'],
  ['выполнять функции', 'работать как'],
  ['на регулярной основе', 'регулярно'],
  ['в обязательном порядке', 'обязательно'],
  ['в кратчайшие сроки', 'быстро'],
  ['в должной мере', 'достаточно'],
  ['надлежащим образом', 'как следует'],
  ['в полной мере', 'полностью'],
  ['в той или иной степени', 'в какой-то мере'],
  ['тем не менее', 'но'],
  ['наряду с этим', 'а ещё'],
  ['об этом свидетельствует', 'это показывает'],
  ['способствует формированию', 'помогает создать'],
  ['обуславливает необходимость', 'делает нужным'],
  ['характеризуется наличием', 'имеет'],
  ['обладает способностью', 'может'],
  ['демонстрирует тенденцию', 'склоняется к'],
  ['по мере возможности', 'если получится'],
  ['без каких-либо исключений', 'без исключений'],
  ['исключительно важным является', 'очень важно'],
  ['ключевым аспектом является', 'главное тут'],
  ['в контексте рассматриваемой', 'если говорить про'],
  ['данный подход позволяет', 'так можно'],
  ['вышеуказанный метод', 'этот способ'],
  ['нижеследующий перечень', 'список ниже'],
  ['в целом и общем', 'в общем'],
  ['по существу вопроса', 'по делу'],
  ['что касается вопроса', 'насчёт'],
  ['в отношении данного', 'про это'],
  ['применительно к данному', 'для этого'],
  ['как правило', 'обычно'],
  ['само собой разумеется', 'конечно'],
  ['не вызывает сомнений', 'ясно'],
  ['нет никаких сомнений', 'ясно, что'],
  ['ввиду вышесказанного', 'поэтому'],
  ['сопряжён с определёнными', 'связан с кое-какими'],
  ['влечёт за собой', 'ведёт к'],
  ['обусловлен рядом факторов', 'зависит от нескольких вещей'],
  ['заслуживает особого внимания', 'стоит обратить внимание'],
  ['приобретает всё большее значение', 'становится важнее'],
  ['выходит на первый план', 'становится главным'],
  ['занимает особое место', 'стоит особняком'],
  ['носит комплексный характер', 'сложный'],
  ['представляется целесообразным', 'пожалуй, стоит'],
];

/** @type {Array<[string, string]>} */
const MWE_UK = [
  ["у зв'язку з тим, що", 'тому що'],
  ["у зв'язку з тим що", 'тому що'],
  ['внаслідок того, що', 'через те що'],
  ['з метою забезпечення', 'щоб забезпечити'],
  ['для того щоб', 'щоб'],
  ['з тим щоб', 'щоб'],
  ['необхідно зазначити, що', 'зазначимо, що'],
  ['слід відзначити, що', 'варто сказати, що'],
  ['важливо розуміти, що', 'треба розуміти:'],
  ['на сьогоднішній день', 'сьогодні'],
  ['в першу чергу', 'насамперед'],
  ['в рамках даного', 'у цьому'],
  ['являє собою', 'це'],
  ['є ключовим', 'важливий'],
  ['є одним із', 'один із'],
  ['таким чином', 'так'],
  ['разом з тим', 'при цьому'],
  ['зокрема', 'наприклад'],
  ['крім того', 'ще'],
  ['більш того', 'і навіть'],
  ['відіграє ключову роль', 'важливий'],
  ['має велике значення', 'важливо'],
  ['чинить вплив на', 'впливає на'],
  ['зважаючи на те, що', 'оскільки'],
  ['значна кількість', 'багато'],
  ['на підставі вищевикладеного', 'отже'],
  ['відповідно до', 'за'],
  ['у сукупності з', 'разом з'],
  ['у процесі реалізації', 'під час виконання'],
  ['на даному етапі', 'поки що'],
  ['у даному контексті', 'тут'],
  ['не видається можливим', 'не можна'],
  ['має місце бути', 'є'],
  ['здійснювати діяльність', 'працювати'],
  ['вживати заходів', 'діяти'],
  ['надавати сприяння', 'допомагати'],
  ['здійснювати контроль', 'контролювати'],
  ['забезпечувати реалізацію', 'виконувати'],
  ['проводити оцінку', 'оцінювати'],
  ['виконувати функції', 'працювати як'],
  ['на регулярній основі', 'регулярно'],
  ["в обов'язковому порядку", "обов'язково"],
  ['у найкоротші терміни', 'швидко'],
  ['належним чином', 'як слід'],
  ['повною мірою', 'повністю'],
  ['тією чи іншою мірою', 'якоюсь мірою'],
  ['тим не менш', 'але'],
  ['поряд з цим', 'а ще'],
  ['про це свідчить', 'це показує'],
  ['сприяє формуванню', 'допомагає створити'],
  ['зумовлює необхідність', 'робить потрібним'],
  ['характеризується наявністю', 'має'],
  ['володіє здатністю', 'може'],
  ['демонструє тенденцію', 'схиляється до'],
  ['по можливості', 'якщо вийде'],
  ['без жодних винятків', 'без винятків'],
  ['винятково важливим є', 'дуже важливо'],
  ['ключовим аспектом є', 'головне тут'],
  ['у контексті розглядуваної', 'якщо говорити про'],
  ['даний підхід дозволяє', 'так можна'],
  ['вищевказаний метод', 'цей спосіб'],
  ['загалом і в цілому', 'загалом'],
  ['що стосується питання', 'щодо'],
  ['стосовно даного', 'про це'],
  ['як правило', 'зазвичай'],
  ['само собою зрозуміло', 'звісно'],
  ['не викликає сумнівів', 'зрозуміло'],
  ['зважаючи на вищесказане', 'тому'],
  ["пов'язаний з певними", "пов'язаний з деякими"],
  ['тягне за собою', 'веде до'],
  ['заслуговує на особливу увагу', 'варто звернути увагу'],
  ['набуває дедалі більшого значення', 'стає важливішим'],
  ['виходить на перший план', 'стає головним'],
  ['посідає особливе місце', 'стоїть окремо'],
  ['має комплексний характер', 'складний'],
  ['видається доцільним', 'мабуть, варто'],
];

/** @type {Array<[string, string]>} */
const MWE_FR = [
  ['dans le cadre de', 'dans'],
  ['en vue de', 'pour'],
  ['afin de', 'pour'],
  ['de manière significative', 'beaucoup'],
  ['de façon significative', 'beaucoup'],
  ['il convient de noter que', 'notons que'],
  ['il est important de souligner que', 'soulignons que'],
  ['il est essentiel de', 'il faut'],
  ['il est nécessaire de', 'il faut'],
  ['il est à noter que', 'notons que'],
  ['il va sans dire que', 'bien sûr,'],
  ['dans un premier temps', "d'abord"],
  ['dans un second temps', 'ensuite'],
  ["à l'heure actuelle", "aujourd'hui"],
  ["au jour d'aujourd'hui", "aujourd'hui"],
  ['en ce qui concerne', 'pour'],
  ['eu égard à', 'vu'],
  ['compte tenu de', 'vu'],
  ['en dépit de', 'malgré'],
  ['à cet égard', 'ici'],
  ['par conséquent', 'donc'],
  ['en outre', 'aussi'],
  ['de surcroît', 'aussi'],
  ['néanmoins', 'mais'],
  ['toutefois', 'mais'],
  ['par ailleurs', 'aussi'],
  ['en définitive', 'au final'],
  ["en l'occurrence", 'ici'],
  ['dans la mesure où', 'puisque'],
  ['au sein de', 'dans'],
  ['a pour objectif de', 'vise à'],
  ['joue un rôle crucial dans', 'compte pour'],
  ['joue un rôle déterminant dans', 'pèse sur'],
  ['représente un enjeu majeur', 'est important'],
  ['constitue un élément fondamental', 'est essentiel'],
  ['un nombre considérable de', 'beaucoup de'],
  ['une quantité significative de', 'beaucoup de'],
  ['la grande majorité de', 'la plupart de'],
];

/** @type {Array<[string, string]>} */
const MWE_ES = [
  ['en el marco de', 'en'],
  ['con el objetivo de', 'para'],
  ['con el fin de', 'para'],
  ['a fin de', 'para'],
  ['de manera significativa', 'mucho'],
  ['de forma significativa', 'mucho'],
  ['es importante señalar que', 'cabe señalar que'],
  ['es necesario destacar que', 'destaquemos que'],
  ['es fundamental que', 'es clave que'],
  ['es imprescindible', 'hay que'],
  ['cabe destacar que', 'hay que notar que'],
  ['resulta evidente que', 'está claro que'],
  ['no cabe duda de que', 'sin duda,'],
  ['en la actualidad', 'hoy'],
  ['hoy en día', 'hoy'],
  ['en primer lugar', 'primero'],
  ['en segundo lugar', 'segundo'],
  ['en lo que respecta a', 'sobre'],
  ['con respecto a', 'sobre'],
  ['en relación con', 'sobre'],
  ['a pesar de', 'aunque'],
  ['no obstante', 'pero'],
  ['sin embargo', 'pero'],
  ['por consiguiente', 'así que'],
  ['en consecuencia', 'por eso'],
  ['además', 'también'],
  ['asimismo', 'también'],
  ['por otra parte', 'además'],
  ['en definitiva', 'al final'],
  ['en el ámbito de', 'en'],
  ['desempeña un papel fundamental', 'es clave'],
  ['desempeña un papel crucial', 'es importante'],
  ['constituye un elemento esencial', 'es esencial'],
  ['un número significativo de', 'muchos'],
  ['una cantidad considerable de', 'mucho'],
  ['la gran mayoría de', 'la mayoría de'],
  ['tiene como objetivo', 'busca'],
  ['por lo tanto', 'así que'],
];

/** @type {Array<[string, string]>} */
const MWE_DE = [
  ['aufgrund der Tatsache, dass', 'weil'],
  ['aufgrund der Tatsache dass', 'weil'],
  ['im Hinblick auf', 'für'],
  ['in Bezug auf', 'zu'],
  ['im Rahmen von', 'bei'],
  ['zum Zwecke der', 'für'],
  ['mit dem Ziel', 'um zu'],
  ['in Anbetracht der Tatsache, dass', 'da'],
  ['unter Berücksichtigung von', 'mit Blick auf'],
  ['es ist wichtig zu beachten, dass', 'beachtenswert ist, dass'],
  ['es ist hervorzuheben, dass', 'wichtig ist, dass'],
  ['es sei darauf hingewiesen, dass', 'hinzuzufügen ist, dass'],
  ['es ist unbestreitbar, dass', 'klar ist, dass'],
  ['es steht außer Frage, dass', 'zweifellos'],
  ['zum gegenwärtigen Zeitpunkt', 'derzeit'],
  ['in der heutigen Zeit', 'heute'],
  ['darüber hinaus', 'außerdem'],
  ['des Weiteren', 'außerdem'],
  ['nichtsdestotrotz', 'trotzdem'],
  ['nichtsdestoweniger', 'trotzdem'],
  ['demzufolge', 'daher'],
  ['infolgedessen', 'daher'],
  ['dessen ungeachtet', 'trotzdem'],
  ['im Übrigen', 'übrigens'],
  ['in erster Linie', 'vor allem'],
  ['in diesem Zusammenhang', 'hierbei'],
  ['spielt eine entscheidende Rolle', 'ist entscheidend'],
  ['spielt eine wesentliche Rolle', 'ist wichtig'],
  ['stellt einen wesentlichen Faktor dar', 'ist ein wichtiger Faktor'],
  ['eine beträchtliche Anzahl von', 'viele'],
  ['eine erhebliche Menge an', 'viel'],
  ['die überwiegende Mehrheit der', 'die meisten'],
  ['hat zum Ziel', 'zielt darauf ab'],
  ['es lässt sich feststellen, dass', 'man kann sagen, dass'],
  ['abschließend lässt sich sagen', 'zusammenfassend'],
];

/** @type {Record<string, Array<[string, string]>>} */
const MWE_TABLES = {
  en: MWE_EN, ru: MWE_RU, uk: MWE_UK, fr: MWE_FR, es: MWE_ES, de: MWE_DE,
};

// ═══════════════════════════════════════════════════════════════
//  Sentence-initial connector-strip alternations (built as RegExp)
// ═══════════════════════════════════════════════════════════════

/** @type {Record<string, string[]>} */
const CONNECTOR_STRIP_WORDS = {
  en: ['Furthermore', 'Moreover', 'Additionally', 'Consequently', 'Subsequently',
    'In addition', 'What is more', 'Correspondingly', 'Importantly', 'Notably',
    'Significantly', 'Specifically', 'Essentially', 'Fundamentally'],
  ru: ['Более того', 'Кроме того', 'Помимо этого', 'Вследствие этого',
    'В дополнение к этому', 'Следовательно', 'Соответственно', 'Необходимо отметить'],
  uk: ['Більш того', 'Крім того', 'Окрім цього', 'Внаслідок цього',
    'На додаток до цього', 'Відповідно', 'Необхідно зазначити'],
  fr: ['En outre', 'De surcroît', 'Par conséquent', 'Néanmoins', 'Toutefois',
    'Par ailleurs', 'De plus', 'Qui plus est', 'En définitive',
    'Il convient de noter que', 'En ce qui concerne',
    'Dans cette perspective', 'Force est de constater que'],
  es: ['Además', 'Sin embargo', 'No obstante', 'Por consiguiente',
    'En consecuencia', 'Asimismo', 'Por otra parte', 'Por lo tanto',
    'Cabe destacar que', 'Es importante señalar que',
    'En este sentido', 'Resulta evidente que'],
  de: ['Darüber hinaus', 'Des Weiteren', 'Nichtsdestotrotz',
    'Demzufolge', 'Infolgedessen', 'Dessen ungeachtet', 'Im Übrigen',
    'Zusammenfassend lässt sich sagen', 'Es ist hervorzuheben',
    'In diesem Zusammenhang', 'Ferner', 'Überdies'],
};

/**
 * Compile a sentence-initial connector-strip regex from an alternation list.
 * @param {string[]} words @returns {RegExp}
 */
function buildConnectorRegex(words) {
  const alt = words.map(escapeRegex).join('|');
  return new RegExp(`^(${alt}),?\\s+`, 'i');
}

// ═══════════════════════════════════════════════════════════════
//  Hedging modulation tables. Each entry: [regexSource, alternatives].
//  Word boundaries use Unicode-aware lookarounds (JS \b is ASCII-only and
//  would mis-fire around Cyrillic). A `{}` token in a replacement is filled
//  with capture group 1 (morphological suffix), mirroring Python's .format().
// ═══════════════════════════════════════════════════════════════

const L = '\\p{L}';          // any Unicode letter
const B0 = `(?<![${L}])`;    // leading boundary
const B1 = `(?![${L}])`;     // trailing boundary

/** @type {Array<[string, string[]]>} */
const HEDGE_EN = [
  [`${B0}clearly\\s+demonstrates?${B1}`, ['suggests', 'shows', 'indicates']],
  [`${B0}clearly\\s+indicates?${B1}`, ['suggests', 'hints at', 'points to']],
  [`${B0}undeniably${B1}`, ['arguably', 'likely']],
  [`${B0}undoubtedly${B1}`, ['probably', 'likely']],
  [`${B0}significantly\\s+impact`, ['affect', 'influence']],
  [`${B0}fundamentally\\s+transform`, ['change', 'reshape']],
  [`${B0}profoundly\\s+affect`, ['influence', 'shape']],
  [`${B0}crucially${B1}`, ['importantly']],
  [`${B0}paramount${B1}`, ['very important', 'critical']],
  [`${B0}invaluable${B1}`, ['very useful', 'helpful']],
  [`${B0}indispensable${B1}`, ['essential', 'needed']],
  [`${B0}pivotal${B1}`, ['important', 'key']],
  [`${B0}groundbreaking${B1}`, ['innovative', 'new']],
  [`${B0}seamlessly${B1}`, ['smoothly', 'easily']],
  [`${B0}meticulously${B1}`, ['carefully', 'with care']],
  [`${B0}comprehensively${B1}`, ['fully', 'broadly']],
  [`${B0}systematically${B1}`, ['step by step', 'methodically']],
  [`${B0}holistic${B1}`, ['broad', 'complete']],
  [`${B0}multifaceted${B1}`, ['complex', 'layered']],
];

const RU_ADJ = '(ый|ая|ое|ые|ого|ой|ому|ую|ым|ом|ых|ыми)';
const RU_ADJ_IK = '(ий|ая|ое|ие|ого|ой|ому|ую|им|ом|их|ими)';

/** @type {Array<[string, string[]]>} */
const HEDGE_RU = [
  [`${B0}безусловно${B1}`, ['скорее всего', 'вероятно']],
  [`${B0}несомненно${B1}`, ['вероятно', 'похоже']],
  [`${B0}существенно${B1}`, ['заметно', 'ощутимо']],
  [`${B0}значительно${B1}`, ['заметно', 'во многом']],
  [`${B0}принципиально${B1}`, ['по сути', 'во многом']],
  [`${B0}кардинально${B1}`, ['сильно', 'заметно']],
  [`${B0}колоссальн${RU_ADJ}${B1}`, ['огромн{}', 'серьёзн{}']],
  [`${B0}фундаментальн${RU_ADJ}${B1}`, ['основн{}', 'базов{}']],
  [`${B0}беспрецедентн${RU_ADJ}${B1}`, ['небывал{}', 'уникальн{}']],
  [`${B0}очевидно${B1}`, ['видимо', 'по всей видимости']],
  [`${B0}неизбежно${B1}`, ['скорее всего', 'видимо']],
  [`${B0}абсолютно${B1}`, ['совершенно', 'полностью']],
  [`${B0}категорически${B1}`, ['решительно', 'твёрдо']],
  [`${B0}исключительно${B1}`, ['только', 'лишь']],
  [`${B0}глобальн${RU_ADJ}${B1}`, ['общ{}', 'масштабн{}']],
  [`${B0}комплексн${RU_ADJ}${B1}`, ['сложн{}', 'составн{}']],
  [`${B0}систематическ${RU_ADJ_IK}${B1}`, ['планомерн{}', 'постоянн{}']],
  [`${B0}максимально${B1}`, ['как можно больше', 'по полной']],
  [`${B0}минимально${B1}`, ['как можно меньше', 'по минимуму']],
];

const UK_ADJ = '(ий|а|е|і|ого|ій|ому|у|им|ім|их|ими)';

/** @type {Array<[string, string[]]>} */
const HEDGE_UK = [
  [`${B0}безумовно${B1}`, ['мабуть', 'ймовірно']],
  [`${B0}безперечно${B1}`, ['ймовірно', 'схоже']],
  [`${B0}суттєво${B1}`, ['помітно', 'відчутно']],
  [`${B0}значно${B1}`, ['помітно', 'багато в чому']],
  [`${B0}принципово${B1}`, ['по суті', 'багато в чому']],
  [`${B0}кардинально${B1}`, ['сильно', 'помітно']],
  [`${B0}фундаментальн${UK_ADJ}${B1}`, ['основн{}', 'базов{}']],
  [`${B0}безпрецедентн${UK_ADJ}${B1}`, ['небувал{}', 'унікальн{}']],
  [`${B0}очевидно${B1}`, ['видимо', 'вочевидь']],
  [`${B0}невідворотно${B1}`, ['мабуть', 'видимо']],
  [`${B0}абсолютно${B1}`, ['цілком', 'повністю']],
  [`${B0}категорично${B1}`, ['рішуче', 'твердо']],
  [`${B0}виключно${B1}`, ['тільки', 'лише']],
  [`${B0}глобальн${UK_ADJ}${B1}`, ['загальн{}', 'масштабн{}']],
  [`${B0}комплексн${UK_ADJ}${B1}`, ['складн{}', 'складен{}']],
  [`${B0}систематичн${UK_ADJ}${B1}`, ['планомірн{}', 'постійн{}']],
  [`${B0}максимально${B1}`, ['якнайбільше', 'на повну']],
  [`${B0}мінімально${B1}`, ['якнайменше', 'по мінімуму']],
];

/** @type {Array<[string, string[]]>} */
const HEDGE_FR = [
  [`${B0}incontestablement${B1}`, ['sans doute', 'probablement']],
  [`${B0}indéniablement${B1}`, ['probablement', 'vraisemblablement']],
  [`${B0}indubitablement${B1}`, ['sans doute', 'probablement']],
  [`${B0}fondamentalement${B1}`, ['en grande partie', 'surtout']],
  [`${B0}considérablement${B1}`, ['beaucoup', 'nettement']],
  [`${B0}significativement${B1}`, ['nettement', 'bien']],
  [`${B0}crucial(?:e|es|ement)?${B1}`, ['important', 'clé']],
  [`${B0}indispensable${B1}`, ['essentiel', 'nécessaire']],
  [`${B0}primordial(?:e|es)?${B1}`, ['important', 'central']],
  [`${B0}exhaustiv(?:e|es|ement)?${B1}`, ['complet', 'large']],
  [`${B0}systématiquement${B1}`, ['régulièrement', 'souvent']],
  [`${B0}méticuleusement${B1}`, ['avec soin', 'soigneusement']],
];

/** @type {Array<[string, string[]]>} */
const HEDGE_ES = [
  [`${B0}indudablemente${B1}`, ['probablemente', 'seguramente']],
  [`${B0}innegablemente${B1}`, ['posiblemente', 'quizás']],
  [`${B0}incuestionablemente${B1}`, ['probablemente', 'seguramente']],
  [`${B0}fundamentalmente${B1}`, ['en gran medida', 'sobre todo']],
  [`${B0}considerablemente${B1}`, ['mucho', 'bastante']],
  [`${B0}significativamente${B1}`, ['notablemente', 'bastante']],
  [`${B0}crucial(?:es|mente)?${B1}`, ['importante', 'clave']],
  [`${B0}indispensable${B1}`, ['esencial', 'necesario']],
  [`${B0}primordial(?:es|mente)?${B1}`, ['importante', 'central']],
  [`${B0}exhaustiv(?:o|a|os|as|amente)?${B1}`, ['completo', 'amplio']],
  [`${B0}sistemáticamente${B1}`, ['regularmente', 'a menudo']],
  [`${B0}meticulosamente${B1}`, ['con cuidado', 'cuidadosamente']],
];

/** @type {Array<[string, string[]]>} */
const HEDGE_DE = [
  [`${B0}zweifellos${B1}`, ['wahrscheinlich', 'vermutlich']],
  [`${B0}unbestreitbar${B1}`, ['wohl', 'möglicherweise']],
  [`${B0}unbestritten${B1}`, ['wahrscheinlich', 'offenbar']],
  [`${B0}grundlegend${B1}`, ['weitgehend', 'vor allem']],
  [`${B0}erheblich${B1}`, ['deutlich', 'merklich']],
  [`${B0}maßgeblich${B1}`, ['weitgehend', 'wesentlich']],
  [`${B0}entscheidend${B1}`, ['wichtig', 'wesentlich']],
  [`${B0}unverzichtbar${B1}`, ['wichtig', 'nötig']],
  [`${B0}systematisch${B1}`, ['regelmäßig', 'Schritt für Schritt']],
  [`${B0}akribisch${B1}`, ['sorgfältig', 'gründlich']],
  [`${B0}umfassend${B1}`, ['breit', 'weitgehend']],
  [`${B0}bahnbrechend${B1}`, ['innovativ', 'neuartig']],
];

/**
 * Compile a raw hedge table into `{ re, alts }` records.
 * @param {Array<[string, string[]]>} table @returns {Array<{re: RegExp, alts: string[]}>}
 */
function compileHedges(table) {
  return table.map(([src, alts]) => ({ re: new RegExp(src, 'iu'), alts }));
}

/** @type {Record<string, Array<{re: RegExp, alts: string[]}>>} */
const HEDGE_TABLES = {
  en: compileHedges(HEDGE_EN),
  ru: compileHedges(HEDGE_RU),
  uk: compileHedges(HEDGE_UK),
  fr: compileHedges(HEDGE_FR),
  es: compileHedges(HEDGE_ES),
  de: compileHedges(HEDGE_DE),
};

// ═══════════════════════════════════════════════════════════════
//  Perspective rotation patterns. Templates use $1/$2 backreferences.
// ═══════════════════════════════════════════════════════════════

/** @type {Record<string, Array<{re: RegExp, templates: string[]}>>} */
const PERSPECTIVE_TABLES = {
  en: [
    {
      re: /^(The\s+\w+(?:\s+\w+)?)\s+(?:shows?|demonstrates?|indicates?|reveals?|suggests?)\s+(?:that\s+)?(.+)$/i,
      templates: ['$2 — as $1 shows', 'According to $1, $2', 'Based on $1, $2'],
    },
    {
      re: /^[Ii]t\s+is\s+(?:important|worth|essential|crucial|noteworthy)\s+(?:to\s+(?:note|consider|mention|recognize|highlight)\s+)?that\s+(.+)$/,
      templates: ['Notably, $1', '$1'],
    },
    {
      re: /^(.+?)\s+ensures?\s+(?:that\s+)?(.+)$/i,
      templates: ['$2, thanks to $1', 'With $1, $2'],
    },
  ],
  ru: [
    {
      re: /^(.+?)\s+(?:показыва(?:ет|ют)|демонстрир(?:ует|уют)|свидетельству(?:ет|ют)|указыва(?:ет|ют)|подтвержда(?:ет|ют))(?:\s*,?\s*(?:о\s+том\s*,?\s*)?(?:что)\s+)(.+)$/i,
      templates: ['$2 — так следует из того, что $1', 'Согласно $1, $2', 'Судя по $1, $2'],
    },
    {
      re: /^(?:Важно|Стоит|Необходимо|Нужно)\s+(?:отметить|учитывать|подчеркнуть|учесть)(?:\s*,?\s*что\s+)(.+)$/i,
      templates: ['$1'],
    },
    {
      re: /^(.+?)\s+обеспечива(?:ет|ют)\s*(?:то\s*,?\s*)?(?:что\s+)?(.+)$/i,
      templates: ['Благодаря тому, что $1, $2', 'За счёт $1 $2'],
    },
  ],
  uk: [
    {
      re: /^(.+?)\s+(?:показу(?:є|ють)|демонстру(?:є|ють)|свідч(?:ить|ать)|вказу(?:є|ють)|підтвердж(?:ує|ують))(?:\s*,?\s*(?:те\s*,?\s*)?(?:що)\s+)(.+)$/i,
      templates: ['$2 — так випливає з $1', 'Згідно з $1, $2', 'Судячи з $1, $2'],
    },
    {
      re: /^(?:Важливо|Варто|Необхідно|Потрібно)\s+(?:зазначити|відзначити|підкреслити|врахувати)(?:\s*,?\s*що\s+)(.+)$/i,
      templates: ['$1'],
    },
    {
      re: /^(.+?)\s+забезпеч(?:ує|ють)\s*(?:те\s*,?\s*)?(?:що\s+)?(.+)$/i,
      templates: ['Завдяки тому, що $1, $2', 'За рахунок $1 $2'],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
//  Clause-embedding connectors (merge two sentences into one).
//  {0} = first sentence (trimmed), {1} = second sentence (lowercased).
// ═══════════════════════════════════════════════════════════════

/** @type {Record<string, string[]>} */
const EMBED_CONNECTORS = {
  ru: ['{0}, и {1}', '{0} — {1}', '{0}; {1}', '{0}, причём {1}'],
  uk: ['{0}, і {1}', '{0} — {1}', '{0}; {1}', '{0}, причому {1}'],
  de: ['{0}, und {1}', '{0} — {1}', '{0}; {1}', '{0}, wobei {1}'],
  fr: ['{0}, et {1}', '{0} — {1}', '{0}; {1}', '{0}, car {1}'],
  es: ['{0}, y {1}', '{0} — {1}', '{0}; {1}', '{0}, ya que {1}'],
  it: ['{0}, e {1}', '{0} — {1}', '{0}; {1}', '{0}, poiché {1}'],
  pl: ['{0}, i {1}', '{0} — {1}', '{0}; {1}', '{0}, gdyż {1}'],
  pt: ['{0}, e {1}', '{0} — {1}', '{0}; {1}', '{0}, pois {1}'],
  nl: ['{0}, en {1}', '{0} — {1}', '{0}; {1}'],
  sv: ['{0}, och {1}', '{0} — {1}', '{0}; {1}'],
  en: ['{0}, and {1}', '{0} — {1}', '{0}; {1}'],
};

/** Second-sentence opener words that block a merge. */
const EMBED_SKIP_STARTERS = new Set([
  'furthermore', 'moreover', 'additionally', 'however',
  'consequently', 'therefore', 'nevertheless', 'meanwhile',
  'кроме', 'более', 'помимо', 'следовательно', 'тем',
  'крім', 'більше', 'окрім', 'відповідно', 'тим',
]);

// ═══════════════════════════════════════════════════════════════
//  Fragment-creation triggers  (word -> rhetorical fragments)
// ═══════════════════════════════════════════════════════════════

/** @type {Record<string, Record<string, string[]>>} */
const FRAGMENT_TRIGGERS = {
  en: {
    result: ['The result?', 'And the result?', 'What came out of it?'],
    problem: ['The problem?', 'But the problem?', 'One issue though:'],
    reason: ['The reason?', 'Why?', 'The reason is simple:'],
    answer: ['The answer?', 'Simple answer:', 'Short answer:'],
    solution: ['The fix?', 'The solution?', 'One way around this:'],
    point: ['The point?', 'The key thing?', 'Bottom line:'],
    catch: ['The catch?', "But here's the catch:", 'One caveat:'],
    truth: ['The truth?', 'Honestly?', 'The honest answer:'],
  },
  ru: {
    потому: ['И вот почему.', 'Причина проста.'],
    однако: ['Но есть нюанс.', 'Впрочем.'],
    важно: ['И вот что ещё.', 'Ключевой момент.'],
    результат: ['И что в итоге?', 'Результат?'],
  },
  uk: {
    тому: ['І ось чому.', 'Причина проста.'],
    однак: ['Але є нюанс.', 'Втім.'],
    важливо: ['І ось що ще.', 'Ключовий момент.'],
    результат: ['І що в підсумку?', 'Результат?'],
  },
};

// ═══════════════════════════════════════════════════════════════
//  Protected-span masking (URLs, emails, code) — robust sentinel.
//  Tokens have no surrounding whitespace and use Private-Use codepoints,
//  so they survive trimming, sentence splitting and capitalisation.
// ═══════════════════════════════════════════════════════════════

const MASK_PATTERNS = [
  /```[\s\S]*?```|`[^`\n]+`/g,                          // fenced / inline code
  /(?:https?:\/\/|www\.)[^\s<>"'）)]+/gi,               // URLs
  /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,  // emails
];

// Sentinel delimiters use Private-Use codepoints (built via char codes so no
// raw PUA lands in source). Tokens never collide with real digits (years,
// percentages) and survive trimming / capitalisation / sentence splitting.
const MASK_OPEN = String.fromCharCode(0xE000);
const MASK_CLOSE = String.fromCharCode(0xE001);
const MASK_RESTORE_RE = new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g');

/**
 * Replace protected spans with restorable sentinels.
 * @param {string} text
 * @returns {{ masked: string, restore: (t: string) => string }}
 */
function maskSpans(text) {
  /** @type {string[]} */
  const slots = [];
  let masked = text;
  for (const re of MASK_PATTERNS) {
    masked = masked.replace(re, (m) => {
      const token = `${MASK_OPEN}${slots.length}${MASK_CLOSE}`;
      slots.push(m);
      return token;
    });
  }
  const restore = (t) => t.replace(MASK_RESTORE_RE, (_, i) => slots[Number(i)] ?? '');
  return { masked, restore };
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

/** @param {string} s @returns {string} first letter upper-cased. */
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Expand a `$1`/`$2` template against a RegExp match.
 * @param {string} tpl @param {RegExpExecArray} m @returns {string}
 */
function expandTemplate(tpl, m) {
  return tpl.replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? '');
}

// ═══════════════════════════════════════════════════════════════
//  Main paraphrase engine
// ═══════════════════════════════════════════════════════════════

/**
 * Sentence-level paraphrase engine for deep humanization.
 *
 * Transformations, in order: MWE simplification, connector deletion, hedging
 * modulation, perspective rotation, clause embedding, fragment creation.
 */
export class ParaphraseEngine {
  /**
   * @param {object|null} langPack Language pack (plain object) or null.
   * @param {object} [opts]
   * @param {string} [opts.lang] Language code (defaults to langPack.code or 'en').
   * @param {number} [opts.intensity=60] Aggressiveness 0..100.
   * @param {number} [opts.seed=0] PRNG seed for reproducibility.
   */
  constructor(langPack, { lang, intensity = 60, seed = 0 } = {}) {
    this.langPack = langPack || null;
    this.lang = String(lang || (langPack && langPack.code) || 'en').toLowerCase();
    this.intensity = Math.max(0, Math.min(100, intensity));
    this.seed = seed | 0;
    this._rng = new Rng(this.seed);
    /** @type {string[]} */
    this._changes = [];
  }

  /** @returns {string[]} Changes applied during the last transform(). */
  get changes() {
    return [...this._changes];
  }

  /**
   * Resolve the MWE table for the active language, degrading via langPack.
   * @returns {Array<[string, string]>}
   */
  _mweList() {
    if (MWE_TABLES[this.lang]) return MWE_TABLES[this.lang];
    const bp = this.langPack && this.langPack.bureaucratic_phrases;
    if (bp && typeof bp === 'object') {
      return Object.entries(bp).map(([phrase, alts]) => [
        phrase, Array.isArray(alts) ? (alts[0] ?? phrase) : String(alts),
      ]);
    }
    return MWE_EN; // last-resort fallback (matches the Python default)
  }

  /**
   * Resolve the connector-strip regex for the active language.
   * @returns {RegExp|null}
   */
  _connectorRegex() {
    if (CONNECTOR_STRIP_WORDS[this.lang]) {
      return buildConnectorRegex(CONNECTOR_STRIP_WORDS[this.lang]);
    }
    const ac = this.langPack && this.langPack.ai_connectors;
    if (ac && typeof ac === 'object') {
      const keys = Object.keys(ac).filter((k) => k.length > 1);
      if (keys.length) return buildConnectorRegex(keys);
    }
    return buildConnectorRegex(CONNECTOR_STRIP_WORDS.en);
  }

  /**
   * Apply paraphrase transformations to text.
   * @param {string} text
   * @returns {string} Paraphrased text with structural changes.
   */
  transform(text) {
    if (!text || !text.trim()) return text;
    this._changes = [];
    this._rng = new Rng(this.seed); // reset so repeated calls are reproducible

    const { masked, restore } = maskSpans(text);

    // Preserve paragraph structure — process each paragraph independently.
    const paragraphs = masked.split(/(\n\s*\n)/);
    const out = paragraphs.map((part) =>
      part.trim() ? this._transformParagraph(part) : part);

    return restore(out.join(''));
  }

  /**
   * Apply transforms to a single paragraph.
   * @param {string} text @returns {string}
   */
  _transformParagraph(text) {
    const prob = this.intensity / 100;

    // Step 1: MWE simplification (high probability — always attempted).
    text = this._simplifyMwe(text, Math.min(prob * 1.5, 0.95));

    // Step 2: split into sentences for per-sentence transforms.
    const sentences = splitSentences(text.trim());
    if (sentences.length === 0) return text;

    /** @type {string[]} */
    const result = [];
    let i = 0;
    while (i < sentences.length) {
      let sent = sentences[i];

      // Step 3: connector deletion (high probability — strong AI tell).
      if (this._rng.random() < prob * 1.2) sent = this._stripConnector(sent);

      // Step 4: hedging modulation.
      if (this._rng.random() < prob * 0.7) sent = this._modulateHedging(sent);

      // Step 5: perspective rotation.
      if (this._rng.random() < prob * 0.5) sent = this._rotatePerspective(sent);

      // Step 6: clause embedding (merge with the next sentence).
      if (i + 1 < sentences.length
          && this._rng.random() < prob * 0.3
          && wordCount(sent) + wordCount(sentences[i + 1]) < 40) {
        const merged = this._embedClause(sent, sentences[i + 1]);
        if (merged) {
          sent = merged;
          i += 1; // skip the next sentence (merged in)
        }
      }

      // Step 7: fragment creation (low probability, high impact).
      if (this._rng.random() < prob * 0.15) {
        const frag = this._createFragment(sent);
        if (frag) sent = frag;
      }

      result.push(sent);
      i += 1;
    }

    return result.join(' ');
  }

  // ── Multi-word expression simplification ──────────────────────

  /**
   * Replace multi-word expressions with simpler alternatives.
   * @param {string} text @param {number} prob @returns {string}
   */
  _simplifyMwe(text, prob) {
    const mweList = this._mweList();
    for (const [pattern, replacement] of mweList) {
      if (this._rng.random() >= prob) continue;
      const lowerText = text.toLowerCase();
      const idx = lowerText.indexOf(pattern.toLowerCase());
      if (idx < 0) continue;

      const end = idx + pattern.length;
      const old = text.slice(idx, end);

      // Capitalise the replacement if it starts a sentence.
      let atStart = idx === 0;
      if (!atStart && idx > 0) {
        const before = text.slice(0, idx).replace(/\s+$/, '');
        if (before && '.!?\n'.includes(before[before.length - 1])) atStart = true;
      }
      let neo = atStart ? capitalize(replacement) : replacement;

      let after = text.slice(end);
      // Strip a trailing ", " left by connector-style MWEs (e.g. "Кроме того, …").
      if (after.startsWith(', ') && !neo.endsWith(',') && neo.split(/\s+/).length <= 3) {
        after = ' ' + after.slice(2);
      }
      text = text.slice(0, idx) + neo + after;
      this._changes.push(`mwe: '${old}' → '${neo}'`);
    }
    return text;
  }

  // ── Connector deletion ────────────────────────────────────────

  /**
   * Remove AI-typical sentence-initial connectors.
   * @param {string} sent @returns {string}
   */
  _stripConnector(sent) {
    const re = this._connectorRegex();
    const m = re.exec(sent);
    if (m && m.index === 0) {
      const rest = sent.slice(m[0].length);
      if (rest && rest.length > 5) {
        this._changes.push(`connector_strip: removed '${m[0].trim()}'`);
        return capitalize(rest);
      }
    }
    return sent;
  }

  // ── Hedging modulation ────────────────────────────────────────

  /**
   * Replace AI-confident language with natural hedging.
   * @param {string} sent @returns {string}
   */
  _modulateHedging(sent) {
    const hedges = HEDGE_TABLES[this.lang];
    if (!hedges) return sent; // no built-in table -> leave meaning intact
    for (const { re, alts } of hedges) {
      const m = re.exec(sent);
      if (!m) continue;
      const old = m[0];
      let replacement = this._rng.choice(alts);
      // Morphological suffix substitution ({} token <- capture group 1).
      if (m[1] !== undefined && replacement.includes('{}')) {
        replacement = replacement.replace('{}', m[1]);
      }
      if (old[0] === old[0].toUpperCase() && old[0] !== old[0].toLowerCase()) {
        replacement = capitalize(replacement);
      }
      sent = sent.slice(0, m.index) + replacement + sent.slice(m.index + old.length);
      this._changes.push(`hedge: '${old}' → '${replacement}'`);
      break; // one hedge per sentence
    }
    return sent;
  }

  // ── Perspective rotation ──────────────────────────────────────

  /**
   * Rotate sentence perspective (topic-focus rewrite).
   * @param {string} sent @returns {string}
   */
  _rotatePerspective(sent) {
    const patterns = PERSPECTIVE_TABLES[this.lang];
    if (!patterns) return sent;
    const stripped = sent.replace(/[.!?]+$/, '');
    for (const { re, templates } of patterns) {
      const m = re.exec(stripped);
      if (!m || m.index !== 0) continue;
      const template = this._rng.choice(templates);
      let neo = expandTemplate(template, m);
      if (!/[.!?]$/.test(neo)) neo = neo.replace(/[,;\s]+$/, '') + '.';
      neo = capitalize(neo);
      this._changes.push(`perspective: rotated '${sent.slice(0, 40)}...'`);
      return neo;
    }
    return sent;
  }

  // ── Clause embedding (merge two sentences) ────────────────────

  /**
   * Try to merge two sentences into one by embedding.
   * @param {string} sent1 @param {string} sent2 @returns {string|null}
   */
  _embedClause(sent1, sent2) {
    const s1 = sent1.replace(/[.!?]+$/, '').trim();
    const s2 = sent2.trim();
    if (!s1 || !s2) return null;

    // Don't merge numbered list items.
    if (/(?:^|\n)\d+[.)]\s?/.test(sent1) || /(?:^|\n)\d+[.)]\s?/.test(sent2)
        || /\d+[.)]$/.test(s1) || /\d+[.)]$/.test(s2)) {
      return null;
    }

    const words2 = s2.split(/\s+/);
    const firstWord = words2.length ? words2[0].toLowerCase() : '';
    if (EMBED_SKIP_STARTERS.has(firstWord)) return null;

    const s2Lower = s2 ? s2[0].toLowerCase() + s2.slice(1) : s2;
    const templates = EMBED_CONNECTORS[this.lang] || EMBED_CONNECTORS.en;
    let result = this._rng.choice(templates)
      .replace('{0}', s1)
      .replace('{1}', s2Lower);
    if (!/[.!?]$/.test(result)) result += '.';

    this._changes.push('embed: merged 2 sentences');
    return result;
  }

  // ── Fragment creation ─────────────────────────────────────────

  /**
   * Create a rhetorical fragment for naturalness.
   * @param {string} sent @returns {string|null}
   */
  _createFragment(sent) {
    const triggers = FRAGMENT_TRIGGERS[this.lang];
    if (!triggers) return null;
    const words = sent.toLowerCase().split(/\s+/);

    for (const [trigger, fragments] of Object.entries(triggers)) {
      if (!words.includes(trigger)) continue;
      const sentClean = sent.replace(/[.!?]+$/, '');
      const idx = sentClean.toLowerCase().indexOf(trigger);
      if (idx > 10) {
        const before = sentClean.slice(0, idx).replace(/[ ,;:—-]+$/, '').trim();
        const after = sentClean.slice(idx).trim();
        const fragment = this._rng.choice(fragments);
        const result = `${before}. ${fragment} ${capitalize(after)}.`;
        this._changes.push(`fragment: created at '${trigger}'`);
        return result;
      }
    }
    return null;
  }
}

/** @param {string} s @returns {number} whitespace-delimited word count. */
function wordCount(s) {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

// ═══════════════════════════════════════════════════════════════
//  Convenience API
// ═══════════════════════════════════════════════════════════════

/**
 * Paraphrase text with structural transformations.
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.lang] Language code.
 * @param {object|null} [opts.langPack] Language pack or null.
 * @param {number} [opts.intensity=60] Aggressiveness 0..100.
 * @param {number} [opts.seed=0] PRNG seed.
 * @returns {{ text: string, changes: string[] }}
 */
export function paraphrase(text, { lang, langPack = null, intensity = 60, seed = 0 } = {}) {
  const engine = new ParaphraseEngine(langPack, { lang, intensity, seed });
  const result = engine.transform(text);
  return { text: result, changes: engine.changes };
}
