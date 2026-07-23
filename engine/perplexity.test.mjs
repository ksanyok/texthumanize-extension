/**
 * Self-test for engine/perplexity.js.
 * Run: node engine/perplexity.test.mjs
 */
import assert from 'node:assert/strict';
import { perplexityScore } from './perplexity.js';

// Human: varied vocabulary AND varied sentence lengths.
const HUMAN = `I wandered down to the harbor before dawn, half-awake. Fishermen were already hauling crates, shouting over the gulls. One of them, an old man with a crooked grin, tossed me a still-warm bun and waved off my thanks. The light came slow that morning, pink and reluctant. I stayed until my coffee went cold.`;

// Robotic: same clause repeated — uniform lengths, tiny vocabulary, very predictable.
const ROBOTIC = `The team will deliver value. The team will deliver value. The team will deliver value. The team will deliver value. The team will deliver value. The team will deliver value.`;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

function checkShape(label, r) {
  assert.ok(finite(r.perplexity) && r.perplexity >= 0, `${label}: perplexity finite & >= 0 (got ${r.perplexity})`);
  assert.ok(finite(r.burstiness) && r.burstiness >= 0, `${label}: burstiness finite & >= 0 (got ${r.burstiness})`);
  assert.ok(finite(r.predictability) && r.predictability >= 0 && r.predictability <= 1, `${label}: predictability in 0..1 (got ${r.predictability})`);
  assert.ok(Array.isArray(r.perSentence), `${label}: perSentence is array`);
  for (const s of r.perSentence) {
    assert.ok(typeof s.text === 'string', `${label}: perSentence text is string`);
    assert.ok(finite(s.perplexity) && s.perplexity >= 0, `${label}: perSentence perplexity finite (got ${s.perplexity})`);
    assert.ok(s.text.length <= 200, `${label}: perSentence text capped at 200`);
  }
}

const human = perplexityScore(HUMAN, { lang: 'en' });
const robotic = perplexityScore(ROBOTIC, { lang: 'en' });
const empty = perplexityScore('', {});
const tiny = perplexityScore('Hello there.', {});
const nullish = perplexityScore(undefined);

console.log('=== Perplexity ===');
console.log(`HUMAN   ppl=${human.perplexity} burstiness=${human.burstiness} predictability=${human.predictability} sents=${human.perSentence.length}`);
console.log(`ROBOTIC ppl=${robotic.perplexity} burstiness=${robotic.burstiness} predictability=${robotic.predictability} sents=${robotic.perSentence.length}`);
console.log(`EMPTY   ppl=${empty.perplexity} burstiness=${empty.burstiness} predictability=${empty.predictability}`);

checkShape('HUMAN', human);
checkShape('ROBOTIC', robotic);
checkShape('EMPTY', empty);
checkShape('TINY', tiny);
checkShape('NULLISH', nullish);

// ── Empty input ──
assert.deepEqual(empty, { perplexity: 0, burstiness: 0, predictability: 0, perSentence: [] }, 'empty → all-zero result');

// ── Robotic text is more predictable than varied human text ──
assert.ok(robotic.predictability > human.predictability, `robotic predictability (${robotic.predictability}) > human (${human.predictability})`);

// ── Human text is burstier (varied sentence lengths) than uniform robotic text ──
assert.ok(human.burstiness > robotic.burstiness, `human burstiness (${human.burstiness}) > robotic (${robotic.burstiness})`);
assert.ok(robotic.burstiness < 0.05, `uniform robotic text has ~0 burstiness (got ${robotic.burstiness})`);
assert.ok(human.burstiness > 0, 'human text has non-zero burstiness');

// ── Varied human text is more perplex (less predictable) at char level ──
assert.ok(human.perplexity > robotic.perplexity, `human perplexity (${human.perplexity}) > robotic (${robotic.perplexity})`);

// ── perSentence coverage ──
assert.ok(human.perSentence.length >= 4, 'human perSentence covers multiple sentences');
assert.equal(tiny.predictability, 0, 'sub-10-word input reports neutral predictability 0');

console.log('\nALL PASSED');
