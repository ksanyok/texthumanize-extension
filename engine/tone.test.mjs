/**
 * Smoke test for engine/tone.js.
 * Run: node engine/tone.test.mjs
 */
import {
  TONE_LEVELS,
  ToneAnalyzer,
  ToneAdjuster,
  analyzeTone,
  adjustTone,
} from './tone.js';

// ── Sample texts ──────────────────────────────────────────────

// Formal bureaucratese (formal/academic/very_formal markers + long words).
const FORMAL_EN = `Pursuant to the aforementioned agreement, the committee shall utilize comprehensive methodologies to facilitate the implementation of the proposed framework. Furthermore, the organization must obtain the requisite authorization and demonstrate compliance with established regulations. Consequently, we shall commence the procedure and establish the necessary infrastructure in accordance with the applicable provisions.`;

// Casual, colloquial English (informal + subjective markers, contractions, emoji).
const INFORMAL_EN = `Honestly, I'm gonna be real with you — this stuff is kinda awesome, lol. Yeah, I think it's pretty cool and, like, totally worth it. We're gonna crush it, no cap! 😎 Super excited, not gonna lie.`;

// Neutral-ish plain English.
const NEUTRAL_EN = `The team met on Tuesday to review the quarterly report. Sales rose in three regions and fell in one. The group agreed to revisit the plan next month after collecting more data from the field offices.`;

// Mildly formal (few markers) — used to show adjust drives formality DOWN.
const MILD_FORMAL_EN = `We shall utilize the new platform to obtain the results our clients expect. The team will demonstrate the process to management and establish a clear plan. Please commence the review shortly and purchase the tools that the project requires.`;

// Mock EN lang pack (shape matches TextHumanize packs).
const MOCK_EN_PACK = {
  code: 'en',
  colloquial_markers: ['no cap', 'for real', 'tbh', 'ngl', 'kinda', 'sorta'],
  bureaucratic: {
    utilize: ['use'], facilitate: ['help'], commence: ['start'],
    aforementioned: ['this'], pursuant: ['under'],
  },
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
    `level=${r.level}  score=${r.score.toFixed(3)}  ` +
    `formality=${r.formalityScore.toFixed(3)}  confidence=${r.confidence.toFixed(3)}`,
  );
  const top = Object.entries(r.signals.scores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(' ');
  console.log(`scores: ${top}`);
  console.log(`indicators: ${r.indicators.join(' | ') || '(none)'}`);
}

const FORMAL_FAMILY = new Set([
  TONE_LEVELS.FORMAL, TONE_LEVELS.ACADEMIC, TONE_LEVELS.PROFESSIONAL,
]);
const INFORMAL_FAMILY = new Set([TONE_LEVELS.CASUAL, TONE_LEVELS.FRIENDLY]);

const finiteSignals = (r) =>
  Object.values(r.signals).every(
    (v) => typeof v !== 'number' || Number.isFinite(v),
  );

// ── Export sanity ─────────────────────────────────────────────

console.log('=== TONE_LEVELS ===');
console.log(' ', JSON.stringify(TONE_LEVELS));
check('TONE_LEVELS has 7 tones', Object.keys(TONE_LEVELS).length === 7);
check('TONE_LEVELS frozen', Object.isFrozen(TONE_LEVELS));

// ── Analysis (langPack = null) ────────────────────────────────

const an = new ToneAnalyzer('en');
const rFormal = an.analyze(FORMAL_EN, { langPack: null });
const rInformal = an.analyze(INFORMAL_EN, { langPack: null });
const rNeutral = an.analyze(NEUTRAL_EN, { langPack: null });

show('Formal EN (langPack=null)', rFormal);
show('Informal EN (langPack=null)', rInformal);
show('Neutral EN (langPack=null)', rNeutral);

// With mock lang pack (exercises colloquial/bureaucratic enrichment).
const rInformalPack = an.analyze(INFORMAL_EN, { langPack: MOCK_EN_PACK });
const rFormalPack = an.analyze(FORMAL_EN, { langPack: MOCK_EN_PACK });
show('Informal EN (mock langPack)', rInformalPack);
show('Formal EN (mock langPack)', rFormalPack);

// ── Assertions: analysis ──────────────────────────────────────

console.log('\n=== Checks: analyze ===');
check(
  `formal text → formal-family level (got ${rFormal.level})`,
  FORMAL_FAMILY.has(rFormal.level),
);
check(
  `formal text → high formality (${rFormal.formalityScore.toFixed(3)} > 0.6)`,
  rFormal.formalityScore > 0.6,
);
check(
  `informal text → informal-family level (got ${rInformal.level})`,
  INFORMAL_FAMILY.has(rInformal.level),
);
check(
  `informal text → low formality (${rInformal.formalityScore.toFixed(3)} < 0.4)`,
  rInformal.formalityScore < 0.4,
);
check(
  `formal formality > informal formality (${rFormal.formalityScore.toFixed(3)} > ${rInformal.formalityScore.toFixed(3)})`,
  rFormal.formalityScore > rInformal.formalityScore,
);
check('informal text detects emoji signal', rInformal.signals.emojiCount > 0);
check(
  'informal text detects contractions',
  rInformal.signals.contractions > 0,
);
check(
  'informal text flags 1st/2nd-person pronouns',
  rInformal.signals.firstSecondPerson > 0,
);
check('all formal signals finite', finiteSignals(rFormal));
check('all informal signals finite', finiteSignals(rInformal));
check(
  'mock langPack finds colloquial marker "no cap"',
  (rInformalPack.signals.markers.informal || []).includes('no cap'),
);
check(
  'short text → neutral default',
  an.analyze('Too short.').level === TONE_LEVELS.NEUTRAL,
);

// ── Adjustment ────────────────────────────────────────────────

console.log('\n=== Checks: adjust ===');

const adjuster = new ToneAdjuster('en', 7);
const before = an.analyze(MILD_FORMAL_EN).formalityScore;
const res = adjuster.adjust(MILD_FORMAL_EN, 'informal', { intensity: 1.0 });
const after = an.analyze(res.text).formalityScore;

console.log(`\nmild-formal → informal @ intensity 1.0`);
console.log(`  before formality: ${before.toFixed(3)}`);
console.log(`  after  formality: ${after.toFixed(3)}`);
console.log(`  changes (${res.changes.length}):`, res.changes.map((c) => `${c.from}→${c.to}`).join(', '));

check('adjust produced at least one change', res.changes.length > 0);
check(
  `adjust lowered formality (${after.toFixed(3)} < ${before.toFixed(3)})`,
  after < before,
);
check('adjust changed the text', res.text !== MILD_FORMAL_EN);
check(
  'adjust output is a non-empty string',
  typeof res.text === 'string' && res.text.length > 0,
);

// A saturated formal text still yields concrete formal→informal swaps.
const satRes = adjuster.adjust(FORMAL_EN, 'casual', { intensity: 1.0 });
console.log(`  saturated formal changes (${satRes.changes.length}):`, satRes.changes.map((c) => `${c.from}→${c.to}`).join(', '));
check('saturated formal text still gets swaps', satRes.changes.length > 0);

// same-tone target → no-op
const noop = adjuster.adjust(FORMAL_EN, TONE_LEVELS.FORMAL, { intensity: 1.0 });
check('adjust to current tone is a no-op', noop.changes.length === 0 && noop.text === FORMAL_EN);

// convenience wrappers
const cw = analyzeTone(INFORMAL_EN, { lang: 'en' });
check('analyzeTone wrapper works', INFORMAL_FAMILY.has(cw.level));
const aw = adjustTone(FORMAL_EN, 'casual', { lang: 'en', seed: 1, intensity: 1.0 });
check('adjustTone wrapper works', typeof aw.text === 'string');

// RU quick check (built-in markers, langPack=null)
const rRu = analyzeTone(
  'Настоящим уведомляем, что необходимо осуществлять контроль и обеспечивать соблюдение установленных требований в соответствии с регламентом.',
  { lang: 'ru' },
);
console.log(`\nRU formal sample → level=${rRu.level} formality=${rRu.formalityScore.toFixed(3)}`);
check('RU formal sample → high formality', rRu.formalityScore > 0.6);

// ── Summary ───────────────────────────────────────────────────

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
