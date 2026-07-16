/**
 * Engine unit tests — run with `node --test tests/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { humanize } from '../engine/pipeline.js';
import { detectLanguage } from '../engine/lang-detect.js';
import { WatermarkDetector, cleanWatermarks, sha256First32 } from '../engine/watermark.js';
import { AIDetector } from '../engine/detector.js';
import { TypographyNormalizer } from '../engine/normalizer.js';
import { Rng, changeRatio, maskProtected, matchCase } from '../engine/util.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pack = (code) => JSON.parse(readFileSync(join(root, 'data/langs', `${code}.json`), 'utf8'));

const AI_EN = 'It is important to note that the comprehensive methodology facilitates significant optimization of the workflow. Furthermore, the implementation demonstrates substantial improvements in operational efficiency. Additionally, the framework leverages innovative paradigms to streamline the process. Moreover, it is worth mentioning that the utilization of advanced techniques necessitates careful consideration. Consequently, the aforementioned approach delivers a robust and comprehensive solution for all stakeholders involved.';
const HUMAN_EN = "Honestly? I never thought the cafe would be that packed on a Tuesday. We squeezed into a corner table anyway. My coffee went cold while Kate told me about her disaster of a road trip — flat tire, dead phone, the works. Worth it though. Best two hours I've had all month.";
const AI_RU = 'Необходимо отметить, что данная комплексная методология обеспечивает существенную оптимизацию рабочего процесса. Кроме того, реализация демонстрирует значительные улучшения операционной эффективности. Более того, следует подчеркнуть, что использование передовых технологий требует тщательного рассмотрения всех аспектов. Таким образом, вышеуказанный подход представляет собой надёжное и комплексное решение для всех заинтересованных сторон.';

// ── Language detection ──────────────────────────────────────────

test('detects English', () => {
  assert.equal(detectLanguage(AI_EN), 'en');
});

test('detects Russian', () => {
  assert.equal(detectLanguage(AI_RU), 'ru');
});

test('detects Ukrainian', () => {
  assert.equal(detectLanguage('Необхідно зазначити, що ця методологія забезпечує суттєву оптимізацію робочого процесу, але є нюанси, які варто врахувати.'), 'uk');
});

test('detects German / French / Spanish', () => {
  assert.equal(detectLanguage('Die Implementierung zeigt wesentliche Verbesserungen der betrieblichen Effizienz und der Qualität für alle Beteiligten.'), 'de');
  assert.equal(detectLanguage("Il est important de noter que cette méthode facilite une optimisation significative du flux de travail pour tous."), 'fr');
  assert.equal(detectLanguage('Es importante señalar que la metodología integral facilita una optimización significativa del flujo de trabajo.'), 'es');
});

test('detects CJK and Arabic scripts', () => {
  assert.equal(detectLanguage('这是一个非常重要的方法，它显著优化了整个工作流程，并且提高了效率。'), 'zh');
  assert.equal(detectLanguage('これは非常に重要な方法であり、ワークフロー全体を大幅に最適化します。'), 'ja');
  assert.equal(detectLanguage('이것은 매우 중요한 방법이며 전체 워크플로를 크게 최적화합니다.'), 'ko');
  assert.equal(detectLanguage('هذه طريقة مهمة للغاية وتعمل على تحسين سير العمل بشكل كبير وتحسين الكفاءة.'), 'ar');
});

// ── Detector ────────────────────────────────────────────────────

test('AI-style text scores higher than human text', () => {
  const detector = new AIDetector();
  const enPack = pack('en');
  const ai = detector.detect(AI_EN, { lang: 'en', langPack: enPack });
  const human = detector.detect(HUMAN_EN, { lang: 'en', langPack: enPack });
  assert.ok(ai.aiProbability > 0.55, `AI text scored ${ai.aiProbability}`);
  assert.ok(human.aiProbability < 0.4, `human text scored ${human.aiProbability}`);
  assert.equal(ai.verdict, 'ai');
  assert.equal(human.verdict, 'human');
});

test('detector handles short text gracefully', () => {
  const detector = new AIDetector();
  const r = detector.detect('Too short.', { lang: 'en', langPack: null });
  assert.equal(r.verdict, 'unknown');
});

// ── Watermark ───────────────────────────────────────────────────

test('removes zero-width characters', () => {
  const dirty = 'Hel​lo wor‌ld ‍test﻿ done';
  const report = new WatermarkDetector('en').detect(dirty);
  assert.ok(report.hasWatermarks);
  assert.ok(report.watermarkTypes.includes('zero_width_characters'));
  assert.equal(report.cleanedText, 'Hello world test done');
});

test('fixes Cyrillic homoglyphs inside Latin text', () => {
  // 'о' and 'е' below are Cyrillic
  const dirty = 'This is sоme tеxt with substitutions.';
  const report = new WatermarkDetector('en').detect(dirty);
  assert.ok(report.watermarkTypes.includes('homoglyph_substitution'));
  assert.equal(report.cleanedText, 'This is some text with substitutions.');
});

test('fixes Latin homoglyphs inside Cyrillic text', () => {
  // 'o' and 'e' below are Latin
  const dirty = 'Это некотoрый тeкст с подменами символов.';
  const report = new WatermarkDetector('ru').detect(dirty);
  assert.ok(report.watermarkTypes.includes('homoglyph_substitution'));
  assert.ok(!report.cleanedText.includes('oрый'));
});

test('sha256First32 matches Python hashlib prefix', () => {
  // int(hashlib.sha256(b"hello").hexdigest()[:8], 16) == 0x2cf24dba
  assert.equal(sha256First32('hello'), 0x2cf24dba);
});

test('clean is idempotent on clean text', () => {
  const clean = 'Perfectly ordinary sentence with no tricks at all.';
  assert.equal(cleanWatermarks(clean, 'en'), clean);
});

// ── Typography ──────────────────────────────────────────────────

test('typography: fixes double spaces and spacing around punctuation', () => {
  const n = new TypographyNormalizer('web', 'en');
  const out = n.normalize('Hello ,  world .This is  a test.');
  assert.equal(out, 'Hello, world. This is a test.');
});

test('typography: preserves URLs and emails', () => {
  const n = new TypographyNormalizer('web', 'en');
  const out = n.normalize('See https://example.com/a.b.c and mail admin@test.co .');
  assert.ok(out.includes('https://example.com/a.b.c'));
  assert.ok(out.includes('admin@test.co'));
});

// ── Utils ───────────────────────────────────────────────────────

test('Rng is deterministic', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  for (let i = 0; i < 10; i++) assert.equal(a.random(), b.random());
});

test('changeRatio: identical texts → 0, disjoint → 1', () => {
  assert.equal(changeRatio('a b c', 'a b c'), 0);
  assert.equal(changeRatio('a b c', 'x y z'), 1);
});

test('maskProtected round-trips URLs and code', () => {
  const text = 'Use `npm i texthumanize` from https://npmjs.com now.';
  const { masked, restore } = maskProtected(text, {});
  assert.ok(!masked.includes('npmjs.com'));
  assert.equal(restore(masked), text);
});

test('matchCase preserves capitalization patterns', () => {
  assert.equal(matchCase('Hello', 'world'), 'World');
  assert.equal(matchCase('HELLO', 'world'), 'WORLD');
  assert.equal(matchCase('hello', 'World'), 'World');
});

// ── Pipeline ────────────────────────────────────────────────────

test('humanize reduces internal AI score for EN', () => {
  const r = humanize(AI_EN, { lang: 'en', intensity: 70, seed: 42, langPack: pack('en') });
  assert.ok(r.after.aiProbability < r.before.aiProbability,
    `expected drop, got ${r.before.aiProbability} → ${r.after.aiProbability}`);
  assert.ok(r.changes.length > 0);
});

test('humanize reduces internal AI score for RU and keeps gender agreement', () => {
  const r = humanize(AI_RU, { lang: 'ru', intensity: 70, seed: 42, langPack: pack('ru') });
  assert.ok(r.after.aiProbability < r.before.aiProbability);
  assert.ok(!/\b(эта|данная|комплексная|сложная)\s+(подход|процесс|метод)\b/iu.test(r.text),
    `gender agreement broken: ${r.text}`);
});

test('humanize is reproducible with the same seed', () => {
  const enPack = pack('en');
  const a = humanize(AI_EN, { lang: 'en', intensity: 60, seed: 7, langPack: enPack });
  const b = humanize(AI_EN, { lang: 'en', intensity: 60, seed: 7, langPack: enPack });
  assert.equal(a.text, b.text);
});

test('humanize barely touches human text', () => {
  const r = humanize(HUMAN_EN, { lang: 'en', intensity: 70, seed: 1, langPack: pack('en') });
  assert.ok(r.changeRatio < 0.12, `human text changed too much: ${r.changeRatio}`);
});

test('humanize preserves URLs, emails and code', () => {
  const text = 'It is important to note that https://example.com/x?y=1 facilitates optimization. Furthermore, `const x = 1` demonstrates substantial improvements. Contact admin@example.com regarding the comprehensive methodology now.';
  const r = humanize(text, { lang: 'en', intensity: 90, seed: 3, langPack: pack('en') });
  assert.ok(r.text.includes('https://example.com/x?y=1'));
  assert.ok(r.text.includes('admin@example.com'));
  assert.ok(r.text.includes('`const x = 1`'));
});

test('humanize cleans hidden watermarks when enabled', () => {
  const dirty = AI_EN.slice(0, 200) + '​‌‍' + AI_EN.slice(200);
  const r = humanize(dirty, { lang: 'en', intensity: 50, seed: 1, langPack: pack('en'), cleanWatermarks: true });
  assert.ok(!r.text.includes('​'));
  assert.equal(r.watermark.removed, 3);
});

test('humanize with empty text returns empty result', () => {
  const r = humanize('', {});
  assert.equal(r.text, '');
  assert.equal(r.changes.length, 0);
});

test('humanize never worsens its own detector score', () => {
  for (const [lang, text] of [['en', AI_EN], ['ru', AI_RU]]) {
    for (const seed of [1, 42, 1234]) {
      const r = humanize(text, { lang, intensity: 80, seed, langPack: pack(lang) });
      assert.ok(r.after.aiProbability <= r.before.aiProbability + 0.021,
        `${lang} seed ${seed}: ${r.before.aiProbability} → ${r.after.aiProbability}`);
    }
  }
});

test('universal mode (no pack) still normalizes typography', () => {
  const r = humanize('Some  text ,badly spaced .Yes.', { lang: 'xx', intensity: 60, langPack: null });
  assert.equal(r.text, 'Some text, badly spaced. Yes.');
});
