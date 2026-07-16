/**
 * Self-test for engine/paraphrase.js.
 * Run: node engine/paraphrase.test.mjs
 */
import { readFileSync } from 'node:fs';
import { ParaphraseEngine, paraphrase } from './paraphrase.js';

/** @param {string} code */
function loadPack(code) {
  try {
    return JSON.parse(readFileSync(new URL(`../data/langs/${code}.json`, import.meta.url), 'utf8'));
  } catch {
    return null;
  }
}
const EN = loadPack('en');
const RU = loadPack('ru');

let failures = 0;
function check(label, cond) {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`);
  if (!cond) failures++;
}

/** True if the string contains a leaked masking sentinel (U+E000/U+E001). */
function hasSentinel(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 0xE000 || c === 0xE001) return true;
  }
  return false;
}

// ── Sample texts ──────────────────────────────────────────────
const URL = 'https://example.com/guide?ref=42';
const EMAIL = 'hello.team@example.org';

const AI_EN = `In order to remain competitive, it is important to note that organizations must leverage a wide range of tools. Furthermore, the new framework plays a crucial role in operational efficiency. Undoubtedly, this approach clearly demonstrates the value of automation. For more details, visit ${URL} or reach out at ${EMAIL}. Moreover, teams should take into account the vast majority of stakeholders.`;

const AI_RU = `В настоящее время необходимо отметить, что цифровые технологии играют важную роль. Кроме того, данный подход обеспечивает рост эффективности. Более того, несомненно, это существенно влияет на результат. Подробности — на ${URL}.`;

const CODE_TEXT = 'Run the build. The command is `npm run build` and it works. In order to deploy, see https://ci.example.com/pipeline for the logs.';

// ── 1. AI clerical EN text is transformed ─────────────────────
console.log('=== paraphrase EN (built-in tables, langPack=null) ===');
const enOut = paraphrase(AI_EN, { lang: 'en', langPack: null, intensity: 60, seed: 0 });
console.log('  changes:', enOut.changes.length);
console.log('  sample:', JSON.stringify(enOut.text.slice(0, 120)));
check('EN output differs from input', enOut.text !== AI_EN);
check('EN produced >=1 recorded change', enOut.changes.length >= 1);
check('EN preserves URL', enOut.text.includes(URL));
check('EN preserves email', enOut.text.includes(EMAIL));
check('EN did not leak sentinel chars', !hasSentinel(enOut.text));

// ── 2. Same seed -> identical output; different seed may differ ─
const run1 = paraphrase(AI_EN, { lang: 'en', intensity: 60, seed: 123 });
const run2 = paraphrase(AI_EN, { lang: 'en', intensity: 60, seed: 123 });
check('same seed -> identical output', run1.text === run2.text);

// engine re-run is also reproducible (transform resets its PRNG)
const eng = new ParaphraseEngine(null, { lang: 'en', intensity: 60, seed: 5 });
check('engine.transform is idempotent across calls', eng.transform(AI_EN) === eng.transform(AI_EN));

// ── 3. RU clerical text is transformed, URL preserved ─────────
console.log('=== paraphrase RU (langPack=ru) ===');
const ruOut = paraphrase(AI_RU, { lang: 'ru', langPack: RU, intensity: 65, seed: 0 });
console.log('  changes:', ruOut.changes.length);
console.log('  sample:', JSON.stringify(ruOut.text.slice(0, 120)));
check('RU output differs from input', ruOut.text !== AI_RU);
check('RU produced >=1 recorded change', ruOut.changes.length >= 1);
check('RU preserves URL', ruOut.text.includes(URL));

// ── 4. Code spans + URLs protected ────────────────────────────
const codeOut = paraphrase(CODE_TEXT, { lang: 'en', intensity: 80, seed: 1 });
check('inline code span preserved', codeOut.text.includes('`npm run build`'));
check('URL in code text preserved', codeOut.text.includes('https://ci.example.com/pipeline'));

// ── 5. Graceful degradation on edge input ─────────────────────
check('empty string returns empty', paraphrase('', {}).text === '');
check('whitespace-only returns unchanged', paraphrase('   \n  ', {}).text === '   \n  ');
check('intensity 0 is a near no-op on plain text',
  paraphrase('The cat sat on the mat and slept.', { intensity: 0, seed: 0 }).text
  === 'The cat sat on the mat and slept.');

// ── 6. Unknown language degrades via langPack.bureaucratic_phrases ─
const PL = loadPack('pl');
if (PL) {
  const plOut = paraphrase('Test. ' + Object.keys(PL.bureaucratic_phrases || {})[0] + ' coś tam.',
    { lang: 'pl', langPack: PL, intensity: 90, seed: 2 });
  check('unknown-lang path runs without throwing', typeof plOut.text === 'string');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
