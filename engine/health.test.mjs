/**
 * Self-test for engine/health.js.
 * Run: node engine/health.test.mjs
 */
import assert from 'node:assert/strict';
import { contentHealth, gradeFromScore } from './health.js';

// Natural, varied, first-person human writing.
const HUMAN = `I still remember the first time I tried to bake bread at home. The dough stuck to everything — my hands, the counter, even my hair somehow. I laughed, swore a little, and started over. My grandmother used to say that bread teaches you patience, and she was right about that. These days I bake almost every weekend. It calms me down after a long, noisy week. Nothing beats the smell of a warm loaf coming out of the oven on a quiet Sunday morning.`;

// Dense AI-style bureaucratese, connector-heavy and generic.
const AI = `Furthermore, the comprehensive implementation of innovative methodologies facilitates the optimization of organizational processes. Moreover, it is important to note that these strategic initiatives demonstrate significant potential for stakeholders. Additionally, organizations must leverage robust frameworks to ensure sustainable and scalable outcomes. Consequently, the systematic utilization of data-driven approaches enhances overall operational efficiency. In conclusion, it is essential to facilitate continuous improvement across all organizational departments. Therefore, these considerations ultimately underscore the importance of a holistic and comprehensive approach.`;

const GRADES = new Set(['A+', 'A', 'B', 'C', 'D', 'F']);
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

function checkReport(label, r) {
  assert.ok(finite(r.score), `${label}: score finite`);
  assert.ok(r.score >= 0 && r.score <= 100, `${label}: score in 0..100 (got ${r.score})`);
  assert.ok(GRADES.has(r.grade), `${label}: valid grade (got ${r.grade})`);
  assert.ok(Array.isArray(r.components) && r.components.length > 0, `${label}: has components`);
  for (const c of r.components) {
    assert.ok(typeof c.name === 'string' && c.name.length > 0, `${label}: component has name`);
    assert.ok(finite(c.score) && c.score >= 0 && c.score <= 100, `${label}: ${c.name} score in 0..100 (got ${c.score})`);
    assert.ok(finite(c.weight) && c.weight > 0, `${label}: ${c.name} weight positive`);
    assert.equal(r.summary[c.name], c.score, `${label}: summary matches ${c.name}`);
  }
  assert.equal(r.grade, gradeFromScore(r.score), `${label}: grade consistent with score`);
}

const human = contentHealth(HUMAN, { lang: 'en' });
const ai = contentHealth(AI, { lang: 'en' });
const empty = contentHealth('', { lang: 'en' });
const nullish = contentHealth(undefined);

console.log('=== Content Health ===');
console.log(`HUMAN  score=${human.score} grade=${human.grade}  ${human.components.map((c) => `${c.name}=${c.score}`).join('  ')}`);
console.log(`AI     score=${ai.score} grade=${ai.grade}  ${ai.components.map((c) => `${c.name}=${c.score}`).join('  ')}`);
console.log(`EMPTY  score=${empty.score} grade=${empty.grade}`);

checkReport('HUMAN', human);
checkReport('AI', ai);
checkReport('EMPTY', empty);
checkReport('NULLISH', nullish);

// Core expectation: quality human writing is healthier than AI bureaucratese.
assert.ok(human.score > ai.score, `human health (${human.score}) > AI health (${ai.score})`);

// The two differentiating components should point the right way.
const comp = (r, name) => r.components.find((c) => c.name === name)?.score;
assert.ok(comp(human, 'ai_naturalness') > comp(ai, 'ai_naturalness'), 'human more natural (less AI) than AI text');
assert.ok(comp(human, 'readability') >= comp(ai, 'readability'), 'human at least as readable as dense AI text');

// Grade-band boundaries.
assert.equal(gradeFromScore(95), 'A+');
assert.equal(gradeFromScore(85), 'A');
assert.equal(gradeFromScore(75), 'B');
assert.equal(gradeFromScore(60), 'C');
assert.equal(gradeFromScore(40), 'D');
assert.equal(gradeFromScore(39.9), 'F');

// Empty input stays finite and sane.
assert.ok(empty.score >= 0 && empty.score <= 100, 'empty score bounded');

console.log('\nALL PASSED');
