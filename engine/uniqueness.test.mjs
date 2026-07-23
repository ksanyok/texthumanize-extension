/**
 * Self-test for engine/uniqueness.js.
 * Run: node engine/uniqueness.test.mjs
 */
import assert from 'node:assert/strict';
import { uniquenessScore, compareTexts } from './uniqueness.js';

const DIVERSE = `The old lighthouse keeper watched storms roll across the bay each winter. He kept a worn journal, sketching gulls and scribbling half-finished poems about the tide. Nobody visited, yet he never felt truly alone up there.`;

// Same clause repeated — should read as highly repetitive / low uniqueness.
const REPEATED = `The team will deliver value. The team will deliver value. The team will deliver value. The team will deliver value. The team will deliver value.`;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

const diverse = uniquenessScore(DIVERSE, { lang: 'en' });
const repeated = uniquenessScore(REPEATED, { lang: 'en' });
const empty = uniquenessScore('', {});
const tiny = uniquenessScore('hi', {});

console.log('=== Uniqueness ===');
console.log(`DIVERSE  score=${diverse.score} ngramDiversity=${diverse.ngramDiversity} totalNgrams=${diverse.totalNgrams} repeated=${diverse.repeatedNgrams.length}`);
console.log(`REPEATED score=${repeated.score} ngramDiversity=${repeated.ngramDiversity} totalNgrams=${repeated.totalNgrams} repeated=${repeated.repeatedNgrams.length}`);
console.log(`  top repeated: ${JSON.stringify(repeated.repeatedNgrams.slice(0, 3))}`);

// ── Shape & finiteness ──
for (const [label, r] of [['DIVERSE', diverse], ['REPEATED', repeated], ['EMPTY', empty], ['TINY', tiny]]) {
  assert.ok(finite(r.score) && r.score >= 0 && r.score <= 1, `${label}: score in 0..1 (got ${r.score})`);
  assert.ok(finite(r.ngramDiversity) && r.ngramDiversity >= 0 && r.ngramDiversity <= 1, `${label}: ngramDiversity in 0..1`);
  assert.ok(Number.isInteger(r.totalNgrams) && r.totalNgrams >= 0, `${label}: totalNgrams non-negative int`);
  assert.ok(Array.isArray(r.repeatedNgrams), `${label}: repeatedNgrams is array`);
  for (const e of r.repeatedNgrams) {
    assert.ok(typeof e.ngram === 'string' && Number.isInteger(e.count) && e.count > 1, `${label}: repeated entry shape`);
  }
}

// ── Repeated text has low uniqueness ──
assert.ok(repeated.score < diverse.score, `repeated score (${repeated.score}) < diverse score (${diverse.score})`);
assert.ok(repeated.ngramDiversity < diverse.ngramDiversity, 'repeated less n-gram-diverse than varied');
assert.ok(repeated.repeatedNgrams.length > 0, 'repeated text surfaces repeated n-grams');
assert.equal(diverse.repeatedNgrams.length, 0, 'varied text has no repeated 3-grams');

// repeatedNgrams sorted by count desc.
const counts = repeated.repeatedNgrams.map((e) => e.count);
assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'repeatedNgrams sorted by count desc');

// Empty input is trivially unique with no n-grams.
assert.equal(empty.totalNgrams, 0, 'empty totalNgrams is 0');
assert.equal(empty.score, 1, 'empty score is 1');

// ── compareTexts ──
const same = compareTexts(DIVERSE, DIVERSE);
const diff = compareTexts(DIVERSE, REPEATED);
const partial = compareTexts(REPEATED, `The team will deliver results. The crew will deliver value soon.`);
const bothEmpty = compareTexts('', '');
const shortSame = compareTexts('hi there', 'hi there');

console.log('\n=== compareTexts ===');
console.log(`same=${same.similarity} (shared ${same.sharedNgrams})  diff=${diff.similarity}  partial=${partial.similarity}`);

for (const [label, r] of [['same', same], ['diff', diff], ['partial', partial], ['bothEmpty', bothEmpty], ['shortSame', shortSame]]) {
  assert.ok(finite(r.similarity) && r.similarity >= 0 && r.similarity <= 1, `${label}: similarity in 0..1 (got ${r.similarity})`);
  assert.ok(Number.isInteger(r.sharedNgrams) && r.sharedNgrams >= 0, `${label}: sharedNgrams non-negative int`);
}

assert.ok(same.similarity > 0.99, `identical texts ~1 (got ${same.similarity})`);
assert.ok(diff.similarity < same.similarity, 'different texts less similar than identical');
assert.ok(diff.similarity < 0.5, `unrelated texts clearly dissimilar (got ${diff.similarity})`);
assert.ok(partial.similarity > diff.similarity, 'partial overlap scores above unrelated');
assert.equal(bothEmpty.similarity, 1, 'two empty texts compare as identical');
assert.ok(shortSame.similarity > 0.99, 'identical short texts compare ~1 (unigram fallback)');

console.log('\nALL PASSED');
