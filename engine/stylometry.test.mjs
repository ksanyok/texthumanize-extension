/**
 * Self-test for engine/stylometry.js.
 * Run: node engine/stylometry.test.mjs
 */
import { readFileSync } from 'node:fs';
import { Stylometry, compareStyle, fingerprint } from './stylometry.js';

function loadPack(code) {
  try {
    return JSON.parse(readFileSync(new URL(`../data/langs/${code}.json`, import.meta.url), 'utf8'));
  } catch {
    return null;
  }
}
const EN = loadPack('en');

let failures = 0;
function check(label, cond) {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`);
  if (!cond) failures++;
}

// ── Sample texts ──────────────────────────────────────────────
// A1 / A2: same author register — long, formal, subordinate-clause heavy,
// high function-word ratio, sparse punctuation variety.
const A1 = `The committee determined that the proposed regulation would, in most respects, achieve the intended outcome. Although several members expressed reservations, the prevailing view held that the measure was both necessary and proportionate. It is worth observing that similar frameworks, adopted in comparable jurisdictions, have generally produced favourable results over the medium term. The report therefore recommends adoption, subject to periodic review and to the collection of evidence that would allow the policy to be evaluated with appropriate rigour.`;

const A2 = `The working group concluded that the revised guidance would, on balance, serve the public interest. While a number of participants raised concerns, the general consensus maintained that the approach was measured and defensible. One should note that analogous initiatives, implemented in neighbouring regions, have on the whole yielded encouraging outcomes across successive years. Accordingly, the document advises that the guidance be endorsed, provided that its effects are monitored and that data are gathered to permit a thorough assessment in due course.`;

// B: sharply different author — terse, punchy, casual, exclamatory, fragments.
const B = `Ok so. New phone day! Battery's insane. Camera? Meh. Bit slow honestly. Bought it Tuesday. Regret it already lol. Screen's nice though. Cheap case, big mistake. Ugh. Anyway — back to work. Coffee first. Always coffee first!`;

// ── 1. Profiles are complete and finite ───────────────────────
console.log('=== profiles ===');
const st = new Stylometry('en');
const pA1 = st.profile(A1, { langPack: EN });
const pB = st.profile(B, { langPack: EN });
console.log('  A1 avgSentenceLength', pA1.avgSentenceLength.toFixed(2),
  ' functionWordRatio', pA1.functionWordRatio.toFixed(3),
  ' avgSyllables', pA1.avgSyllables.toFixed(2),
  ' ttr', pA1.ttr.toFixed(3));
console.log('  B  avgSentenceLength', pB.avgSentenceLength.toFixed(2),
  ' functionWordRatio', pB.functionWordRatio.toFixed(3),
  ' avgSyllables', pB.avgSyllables.toFixed(2),
  ' ttr', pB.ttr.toFixed(3));

const FEATURE_KEYS = [
  'avgWordLength', 'wordLengthStd', 'ttr', 'hapaxRatio', 'avgSyllables',
  'avgSentenceLength', 'sentenceLengthCv', 'sentenceLengthVariance',
  'avgClauseDepth', 'commaRate', 'semicolonRate', 'dashRate',
  'exclamationRate', 'questionRate', 'parenthesisRate', 'functionWordRatio',
  'pronounStartRatio', 'articleStartRatio', 'conjunctionStartRatio',
  'avgParagraphLength',
];
const allFinite = (p) => FEATURE_KEYS.every((k) => Number.isFinite(p[k]));
check('A1 profile: all features finite', allFinite(pA1));
check('B profile: all features finite', allFinite(pB));
check('empty text yields finite zeroed profile',
  allFinite(st.profile('')) && st.profile('').sampleWordCount === 0);
check('single-word text does not throw / stays finite', allFinite(st.profile('Hi.')));

// ── 2. Similar texts score higher than dissimilar ones ────────
console.log('=== comparisons ===');
const simAA = compareStyle(A1, A2, { lang: 'en', langPack: EN });
const simAB = compareStyle(A1, B, { lang: 'en', langPack: EN });
const simSelf = compareStyle(A1, A1, { lang: 'en', langPack: EN });
console.log(`  sim(A1,A2)=${simAA.similarity}  likelihood=${simAA.sameAuthorLikelihood}  verdict=${simAA.verdict}`);
console.log(`  sim(A1,B) =${simAB.similarity}  likelihood=${simAB.sameAuthorLikelihood}  verdict=${simAB.verdict}`);
console.log(`  sim(A1,A1)=${simSelf.similarity}  (self)`);

check('similar pair scores higher than dissimilar pair',
  simAA.similarity > simAB.similarity);
check('self-comparison is near-identical (>=0.98)', simSelf.similarity >= 0.98);
check('similar-pair likelihood exceeds dissimilar-pair likelihood',
  simAA.sameAuthorLikelihood > simAB.sameAuthorLikelihood);
check('all similarity outputs within [0,1]',
  [simAA, simAB, simSelf].every((r) =>
    r.similarity >= 0 && r.similarity <= 1
    && r.sameAuthorLikelihood >= 0 && r.sameAuthorLikelihood <= 1
    && r.confidence >= 0 && r.confidence <= 1));

// perFeature deviations are all finite numbers
const devsFinite = Object.values(simAB.perFeature)
  .every((f) => Number.isFinite(f.deviation) && Number.isFinite(f.similarity));
check('perFeature deviations/similarities finite', devsFinite);
check('perFeature covers every feature', Object.keys(simAB.perFeature).length === FEATURE_KEYS.length);

// ── 3. fingerprint() wrapper ──────────────────────────────────
const fp = fingerprint(A1, { lang: 'en', langPack: EN });
check('fingerprint returns profile + summary string',
  fp.profile && typeof fp.summary === 'string' && fp.summary.includes('avg sentence length'));

// ── 4. buildProfile averages multiple texts ───────────────────
const merged = st.buildProfile([A1, A2], { langPack: EN });
check('buildProfile sums word counts', merged.sampleWordCount === pA1.sampleWordCount + st.profile(A2, { langPack: EN }).sampleWordCount);
check('buildProfile features finite', allFinite(merged));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
