/**
 * Smoke test for engine/detector.js.
 * Run: node engine/detector.test.mjs
 */
import { AIDetector, detectAi, splitSentences } from './detector.js';

// ── Sample texts ──────────────────────────────────────────────

// 1. Blatantly AI-flavored English (connectors, hedging, uniform structure).
const AI_EN = `In today's rapidly evolving digital landscape, artificial intelligence plays a crucial role in transforming numerous industries. It is important to note that organizations must leverage comprehensive strategies to remain competitive. Furthermore, the implementation of innovative solutions facilitates significant improvements in operational efficiency.

Moreover, it should be noted that a wide range of stakeholders benefit from these transformative technologies. The integration of robust frameworks enables companies to streamline their processes effectively. Additionally, fostering a culture of innovation is of paramount importance for sustainable growth. Consequently, businesses that utilize cutting-edge tools gain substantial advantages over their competitors.

In conclusion, the significance of embracing digital transformation cannot be overstated. Ultimately, organizations should delve into these opportunities to harness their full potential. Therefore, a comprehensive analysis of emerging trends is essential for long-term success.`;

// 2. Casual human English (contractions, fragments, specifics, varied rhythm).
const HUMAN_EN = `So I finally got around to fixing that flaky test on Tuesday. Took me 3 hours. Turns out the whole thing was a race condition in the mock server — classic. My teammate Dave had bet me $5 it was a timezone bug, and honestly? I almost believed him.

Here's the annoying part... the fix was literally two lines. Two! I'd been staring at stack traces since 9am, drinking way too much coffee from that sad little machine on floor 2. You know the one.

Anyway, we shipped it Thursday. QA found nothing. Sarah from support says ticket volume dropped like a rock — down 40% since the patch. Not bad for two lines, huh? Next sprint I'm tackling the login flow. Wish me luck, that code is ancient.`;

// 3. AI-flavored Russian (канцелярит, коннекторы, шаблонная структура).
const AI_RU = `В современном мире цифровые технологии играют ключевую роль в развитии общества. Необходимо отметить, что искусственный интеллект представляет собой одним из наиболее перспективных направлений исследований. Кроме того, комплексный подход к внедрению инноваций обеспечивает повышение эффективности бизнес-процессов.

Более того, следует отметить, что данный метод способствует оптимизации рабочих процессов. Внедрение современных решений оказывает существенное влияние на конкурентоспособность организаций. Таким образом, компании должны осуществлять систематический анализ рыночных тенденций. Помимо этого, широкий спектр возможностей открывается перед организациями, которые реализовывают инновационные стратегии.

В заключение необходимо подчеркнуть, что цифровая трансформация имеет первостепенное значение для устойчивого развития. Следовательно, инвестиции в технологии являются одним из важнейших факторов успеха.`;

// Small mock EN lang pack (shape matches TextHumanize packs).
const MOCK_EN_PACK = {
  stop_words: [
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'and', 'or', 'but',
    'if', 'this', 'that', 'these', 'those', 'it', 'its', 'my', 'i', 'we',
    'they', 'he', 'she', 'you', 'not', 'no', 'so', 'than', 'too', 'very',
    'just', 'about', 'which', 'their', 'our', 'his', 'her',
  ],
  ai_connectors: {
    However: [], Furthermore: [], Moreover: [], Additionally: [],
    Consequently: [], Therefore: [], Thus: [], 'In conclusion': [],
  },
  bureaucratic: {
    utilize: ['use'], leverage: ['use'], facilitate: ['help'],
    implementation: ['setup'], comprehensive: ['full'],
  },
  bureaucratic_phrases: {
    'it is important to note that': ['note that'],
    'it should be noted that': ['note that'],
    'a wide range of': ['many'],
  },
  sentence_starters: { This: [], It: [], The: [] },
};

// ── Helpers ───────────────────────────────────────────────────

let failures = 0;
function check(label, cond) {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${mark}] ${label}`);
}

function show(name, r) {
  console.log(`\n=== ${name} ===`);
  console.log(
    `verdict=${r.verdict}  aiProbability=${r.aiProbability.toFixed(3)}  ` +
    `confidence=${r.confidence.toFixed(3)}  domain=${r.domain}  ` +
    `words=${r.wordCount}  sentences=${r.sentenceCount}  lang=${r.lang}`,
  );
  const top = Object.entries(r.scores)
    .filter(([k]) => !['zipf', 'coherence', 'topic_sentence'].includes(k))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(' ');
  console.log(`scores: ${top}`);
  console.log(
    'explanations:',
    r.explanations.map((e) => `${e.textKey}(${e.score})`).join(', ') || '(none)',
  );
}

// ── splitSentences sanity ─────────────────────────────────────

console.log('=== splitSentences ===');
const s1 = splitSentences('Hello world! How are you? Fine. Mr. Smith went home.');
console.log(' ', JSON.stringify(s1));
check('splits EN into 4 sentences (abbrev-safe)', s1.length === 4);
const s2 = splitSentences('Привет! Как дела? Всё хорошо… Точно.');
console.log(' ', JSON.stringify(s2));
check('splits Cyrillic into 4 sentences', s2.length === 4);

// ── Detection runs (langPack = null, universal mode) ──────────

const det = new AIDetector();
const rAiEn = det.detect(AI_EN, { lang: 'en', langPack: null });
const rHumanEn = det.detect(HUMAN_EN, { lang: 'en', langPack: null });
const rAiRu = det.detect(AI_RU, { lang: 'ru', langPack: null });

show('AI English (langPack=null)', rAiEn);
show('Human English (langPack=null)', rHumanEn);
show('AI Russian (langPack=null)', rAiRu);

// With a mock lang pack (exercises vocabulary/stylometry + marker merge)
const rAiEnPack = det.detect(AI_EN, { lang: 'en', langPack: MOCK_EN_PACK });
const rHumanEnPack = det.detect(HUMAN_EN, { lang: 'en', langPack: MOCK_EN_PACK });
show('AI English (mock langPack)', rAiEnPack);
show('Human English (mock langPack)', rHumanEnPack);

// Auto lang sniff + wrapper
const rAuto = detectAi(AI_RU);
console.log(`\nauto-sniff lang for RU text: ${rAuto.lang} (verdict=${rAuto.verdict})`);

// Edge cases
const rShort = detectAi('Too short.');
const rEmpty = detectAi('');

// ── Assertions ────────────────────────────────────────────────

console.log('\n=== Checks ===');
check(
  `AI EN prob (${rAiEn.aiProbability.toFixed(3)}) > human EN prob (${rHumanEn.aiProbability.toFixed(3)})`,
  rAiEn.aiProbability > rHumanEn.aiProbability,
);
check(
  `AI EN prob > human EN prob with pack (${rAiEnPack.aiProbability.toFixed(3)} vs ${rHumanEnPack.aiProbability.toFixed(3)})`,
  rAiEnPack.aiProbability > rHumanEnPack.aiProbability,
);
check(`AI EN verdict is "ai" (got ${rAiEn.verdict})`, rAiEn.verdict === 'ai');
check(
  `human EN verdict is human/mixed (got ${rHumanEn.verdict})`,
  rHumanEn.verdict === 'human' || rHumanEn.verdict === 'mixed',
);
check(
  `AI RU verdict is "ai" (got ${rAiRu.verdict}, prob ${rAiRu.aiProbability.toFixed(3)})`,
  rAiRu.verdict === 'ai',
);
check(
  `AI RU prob (${rAiRu.aiProbability.toFixed(3)}) > 0.6`,
  rAiRu.aiProbability > 0.6,
);
check(`RU auto-sniff detected ru (got ${rAuto.lang})`, rAuto.lang === 'ru');
check(`short text verdict unknown (got ${rShort.verdict})`, rShort.verdict === 'unknown');
check(`empty text verdict unknown (got ${rEmpty.verdict})`, rEmpty.verdict === 'unknown');
check(
  'all probabilities within [0,1]',
  [rAiEn, rHumanEn, rAiRu, rAiEnPack, rHumanEnPack].every(
    (r) =>
      r.aiProbability >= 0 && r.aiProbability <= 1
      && r.confidence >= 0 && r.confidence <= 1
      && Object.values(r.scores).every((v) => v >= 0 && v <= 1),
  ),
);
check(
  'AI EN explanations include pattern signal',
  rAiEn.explanations.some((e) => e.textKey === 'ai.pattern'),
);

// Anti-evasion: homoglyph + zero-width insertion must not collapse the score.
const attacked = AI_EN
  .replace(/o/g, 'о').replace(/a/g, 'а').replace(/e/g, 'е')
  .replace(/ /g, '​ ');
const rClean = new AIDetector().detect(AI_EN, { lang: 'en' });
const rAttacked = new AIDetector().detect(attacked, { lang: 'en' });
check(
  `homoglyph evasion resisted (clean ${rClean.aiProbability.toFixed(2)} vs attacked ${rAttacked.aiProbability.toFixed(2)})`,
  Math.abs(rClean.aiProbability - rAttacked.aiProbability) < 0.08,
);
check(
  'genuine Cyrillic text is not corrupted by normalization',
  new AIDetector().detect(AI_RU, { lang: 'ru' }).aiProbability > 0.6,
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
