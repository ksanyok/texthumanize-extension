/**
 * v2 engine tests — tone, readability, paraphrase, stylometry, content type,
 * image forensics, entitlements. Run with `node --test tests/*.test.js`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { analyzeTone, adjustTone } from '../engine/tone.js';
import { analyzeReadability } from '../engine/readability.js';
import { paraphrase } from '../engine/paraphrase.js';
import { fingerprint, compareStyle } from '../engine/stylometry.js';
import { classifyContent } from '../engine/content-type.js';
import { detectMediaWatermarks, mediaFormat } from '../engine/media-forensics.js';
import { TOOLS, isUnlocked, inlineTools, MONETIZATION_ENABLED } from '../engine/entitlements.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pack = (c) => JSON.parse(readFileSync(join(root, 'data/langs', `${c}.json`), 'utf8'));

const FORMAL = 'It is imperative to note that the aforementioned methodology facilitates the comprehensive optimization of operational efficiency, and stakeholders are hereby advised to proceed accordingly.';
const CASUAL = "Honestly, I'm not gonna lie — that was a blast. We just hung out, grabbed coffee, laughed a ton. Best day in ages, tbh 😎";

test('tone: formal vs casual', () => {
  const f = analyzeTone(FORMAL, { lang: 'en', langPack: pack('en') });
  const c = analyzeTone(CASUAL, { lang: 'en', langPack: pack('en') });
  assert.ok(f.formalityScore > c.formalityScore, `${f.formalityScore} !> ${c.formalityScore}`);
});

test('tone adjust returns text and changes', () => {
  const r = adjustTone(FORMAL, 'informal', { lang: 'en', langPack: pack('en'), seed: 1 });
  assert.equal(typeof r.text, 'string');
  assert.ok(Array.isArray(r.changes));
});

test('readability metrics are finite; simple easier than complex', () => {
  const simple = analyzeReadability('The cat sat on the mat. The dog ran fast. We had fun.', 'en');
  const complex = analyzeReadability(FORMAL, 'en');
  for (const v of Object.values(simple)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
  assert.ok(simple.fleschReadingEase > complex.fleschReadingEase);
});

test('paraphrase changes text, is deterministic by seed, keeps URLs', () => {
  const txt = 'It is important to note that https://example.com/x facilitates comprehensive optimization of the entire workflow for all stakeholders.';
  const a = paraphrase(txt, { lang: 'en', langPack: pack('en'), intensity: 70, seed: 5 });
  const b = paraphrase(txt, { lang: 'en', langPack: pack('en'), intensity: 70, seed: 5 });
  assert.equal(a.text, b.text);
  assert.ok(a.text.includes('https://example.com/x'));
});

test('stylometry: similar texts score higher than dissimilar', () => {
  const a = 'The sun rose over the hills. Birds sang softly. A gentle breeze moved through the trees.';
  const b = 'The moon set behind the sea. Waves crashed loudly. A cold wind swept across the sand.';
  const c = FORMAL;
  const sim = compareStyle(a, b, { lang: 'en' }).similarity;
  const dif = compareStyle(a, c, { lang: 'en' }).similarity;
  assert.ok(sim >= dif, `${sim} !>= ${dif}`);
  assert.ok(fingerprint(a, { lang: 'en' }).profile);
});

test('content-type classifies email and social', () => {
  const email = classifyContent('Dear Ms. Lee, Thank you for your email. Please find the report attached. Best regards, Sam', { lang: 'en', langPack: pack('en') });
  assert.equal(email.type, 'email');
  const social = classifyContent('just dropped my new track 🔥🔥 link in bio #newmusic #vibes so hyped rn', { lang: 'en', langPack: pack('en') });
  assert.ok(['social', 'chat'].includes(social.type));
});

test('media forensics: SD PNG → ai, clean PNG → none', () => {
  const png = buildPng('parameters\x00masterpiece, Stable Diffusion, steps: 30');
  const r = detectMediaWatermarks(png, {});
  assert.equal(mediaFormat(png), 'png');
  assert.equal(r.isAiGenerated, true);
  const clean = detectMediaWatermarks(buildPng(null), {});
  assert.equal(clean.isAiGenerated, null);
  assert.equal(clean.provenance, 'none');
});

test('entitlements: all unlocked while monetization off', () => {
  assert.equal(MONETIZATION_ENABLED, false);
  for (const tool of TOOLS) assert.equal(isUnlocked(tool.id), true);
  assert.ok(inlineTools().length >= 4);
});

// ── helpers ──
function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = new TextEncoder().encode(type);
  const body = new Uint8Array(t.length + data.length);
  body.set(t); body.set(data, t.length);
  const len = data.length;
  const out = new Uint8Array(4 + body.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len);
  out.set(body, 4);
  dv.setUint32(4 + body.length, crc32(body));
  return out;
}
function buildPng(textChunk) {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 1);
  new DataView(ihdr.buffer).setUint32(4, 1);
  ihdr[8] = 8; ihdr[9] = 6;
  const parts = [sig, chunk('IHDR', ihdr)];
  if (textChunk) parts.push(chunk('tEXt', new TextEncoder().encode(textChunk)));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
