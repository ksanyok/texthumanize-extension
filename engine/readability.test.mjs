/**
 * Smoke test for engine/readability.js.
 * Run: node engine/readability.test.mjs
 */
import {
  ReadabilityAnalyzer,
  analyzeReadability,
  countSyllables,
  readingLevelFromFRE,
} from './readability.js';

// ── Sample texts ──────────────────────────────────────────────

// Short, plain, monosyllabic → should read as very easy.
const SIMPLE_EN = `The cat sat on the mat. A dog ran fast. I see it now. We go home. The sun is up.`;

// Long, dense bureaucratese → should read as difficult, high grade.
const COMPLEX_EN = `Notwithstanding the aforementioned considerations, the comprehensive implementation of multifaceted organizational methodologies necessitates substantial interdisciplinary collaboration among numerous institutional stakeholders throughout the administrative infrastructure. Consequently, the systematic operationalization of these strategic initiatives invariably precipitates considerable bureaucratic complexity, thereby undermining the anticipated efficiency improvements originally envisioned by the executive leadership committee.`;

// Russian sample (Cyrillic syllable counting).
const RU_TEXT = `Внедрение современных технологий обеспечивает повышение эффективности бизнес-процессов. Организации осуществляют систематический анализ рыночных тенденций для достижения устойчивого развития.`;

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
    `FRE=${r.fleschReadingEase}  FK=${r.fleschKincaidGrade}  CLI=${r.colemanLiau}  ` +
    `ARI=${r.ari}  Fog=${r.gunningFog}  SMOG=${r.smog}`,
  );
  console.log(
    `avgSentLen=${r.avgSentenceLength}  avgWordLen=${r.avgWordLength}  ` +
    `avgSyl=${r.avgSyllablesPerWord}  complex=${r.complexWordRatio}  ` +
    `TTR=${r.lexicalDiversity}  grade=${r.gradeLevel}  level="${r.readingLevel}"`,
  );
}

const allFinite = (r) =>
  Object.values(r).every((v) => typeof v !== 'number' || Number.isFinite(v));

// ── countSyllables ────────────────────────────────────────────

console.log('=== countSyllables ===');
check('"cat" → 1', countSyllables('cat') === 1);
check('"make" → 1 (silent e)', countSyllables('make') === 1);
check(`"readability" → ${countSyllables('readability')} (>= 4)`, countSyllables('readability') >= 4);
check(`"organization" → ${countSyllables('organization')} (>= 4)`, countSyllables('organization') >= 4);
check('empty → 0', countSyllables('') === 0);
check(`RU "привет" → ${countSyllables('привет', 'ru')} (== 2)`, countSyllables('привет', 'ru') === 2);
check(`RU "хорошо" → ${countSyllables('хорошо', 'ru')} (== 3)`, countSyllables('хорошо', 'ru') === 3);

// ── readingLevelFromFRE bands ─────────────────────────────────

check('FRE 95 → very easy', readingLevelFromFRE(95) === 'very easy');
check('FRE 20 → very difficult', readingLevelFromFRE(20) === 'very difficult');

// ── Analysis ──────────────────────────────────────────────────

const simple = analyzeReadability(SIMPLE_EN, 'en');
const complex = analyzeReadability(COMPLEX_EN, 'en');
const ru = new ReadabilityAnalyzer('ru').analyze(RU_TEXT);
const empty = analyzeReadability('', 'en');

show('Simple EN', simple);
show('Complex EN', complex);
show('Russian', ru);

// ── Assertions ────────────────────────────────────────────────

console.log('\n=== Checks: metrics ===');
check(
  `simple FRE high (${simple.fleschReadingEase} > 70)`,
  simple.fleschReadingEase > 70,
);
check(
  `simple grade low (${simple.gradeLevel} < 6)`,
  simple.gradeLevel < 6,
);
check(`simple reading level easy-ish (got "${simple.readingLevel}")`,
  simple.readingLevel === 'very easy' || simple.readingLevel === 'easy');
check(
  `complex FRE low (${complex.fleschReadingEase} < 40)`,
  complex.fleschReadingEase < 40,
);
check(
  `complex grade high (${complex.gradeLevel} > 12)`,
  complex.gradeLevel > 12,
);
check(
  `complex FRE < simple FRE (${complex.fleschReadingEase} < ${simple.fleschReadingEase})`,
  complex.fleschReadingEase < simple.fleschReadingEase,
);
check(
  `complex grade > simple grade (${complex.gradeLevel} > ${simple.gradeLevel})`,
  complex.gradeLevel > simple.gradeLevel,
);
check(
  `complex has more complex words (${complex.complexWordRatio} > ${simple.complexWordRatio})`,
  complex.complexWordRatio > simple.complexWordRatio,
);

console.log('\n=== Checks: finiteness ===');
check('all simple metrics finite', allFinite(simple));
check('all complex metrics finite', allFinite(complex));
check('all Russian metrics finite', allFinite(ru));
check('all empty-text metrics finite', allFinite(empty));
check(
  'Russian avg syllables per word > 1',
  ru.avgSyllablesPerWord > 1,
);
check(
  'Russian metrics non-trivial (avgSentenceLength > 0)',
  ru.avgSentenceLength > 0,
);

// Full metric-set presence & finiteness (explicit keys).
const keys = [
  'fleschReadingEase', 'fleschKincaidGrade', 'colemanLiau', 'ari',
  'gunningFog', 'smog', 'avgSentenceLength', 'avgWordLength',
  'avgSyllablesPerWord', 'complexWordRatio', 'lexicalDiversity',
  'gradeLevel',
];
check(
  'every documented metric present & finite',
  keys.every((k) => Number.isFinite(complex[k])),
);
check('readingLevel is a non-empty string', typeof complex.readingLevel === 'string' && complex.readingLevel.length > 0);

// ── Summary ───────────────────────────────────────────────────

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
