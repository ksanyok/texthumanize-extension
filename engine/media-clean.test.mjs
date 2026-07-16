import assert from 'node:assert/strict';
import { cleanMediaWatermarks, detectMediaWatermarks, mediaFormat } from './media-forensics.js';

function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function chunk(type, data) {
  const t = new TextEncoder().encode(type);
  const body = new Uint8Array(t.length + data.length); body.set(t); body.set(data, t.length);
  const out = new Uint8Array(4 + body.length + 4); const d = new DataView(out.buffer);
  d.setUint32(0, data.length); out.set(body, 4); d.setUint32(4 + body.length, crc32(body)); return out;
}
function png(text) {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13); const d = new DataView(ihdr.buffer); d.setUint32(0, 1); d.setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [sig, chunk('IHDR', ihdr)];
  if (text) parts.push(chunk('tEXt', new TextEncoder().encode(text)));
  parts.push(chunk('IDAT', new Uint8Array([120, 156, 99, 0, 0, 0, 2, 0, 1]))); parts.push(chunk('IEND', new Uint8Array(0)));
  let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
function jpegWithXmp(xmp) {
  const soi = [0xff, 0xd8];
  const payload = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\x00' + xmp);
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload];
  const sos = [0xff, 0xda, 0x00, 0x03, 0x01, 0x11, 0x22, 0x33]; // minimal scan
  const eoi = [0xff, 0xd9];
  return Uint8Array.from([...soi, ...app1, ...sos, ...eoi]);
}

let pass = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓', name); pass++; }

// 1. SD-tagged PNG → cleaned, marker gone, still valid PNG
const dirty = png('parameters\x00masterpiece, Stable Diffusion, steps: 30');
assert.equal(detectMediaWatermarks(dirty).isAiGenerated, true);
const c1 = cleanMediaWatermarks(dirty);
ok('png: removed >= 1', c1.removed >= 1);
ok('png: cleaned still png', mediaFormat(c1.cleaned) === 'png');
ok('png: AI marker gone', detectMediaWatermarks(c1.cleaned).isAiGenerated === null);
ok('png: IHDR kept', c1.cleaned.length > 33);
ok('png: IEND present', String.fromCharCode(...c1.cleaned.subarray(-8, -4)) === 'IEND');

// 2. Clean PNG → nothing removed, idempotent
const clean = png(null);
const c2 = cleanMediaWatermarks(clean);
ok('png clean: removed === 0', c2.removed === 0);
ok('png clean: bytes preserved', c2.cleaned.length === clean.length);

// 3. JPEG with XMP trainedAlgorithmicMedia → cleaned removes AI
const jd = jpegWithXmp('digitalSourceType trainedAlgorithmicMedia');
assert.equal(detectMediaWatermarks(jd).isAiGenerated, true);
const c3 = cleanMediaWatermarks(jd);
ok('jpeg: removed >= 1', c3.removed >= 1);
ok('jpeg: cleaned is jpeg', mediaFormat(c3.cleaned) === 'jpeg');
ok('jpeg: AI marker gone', detectMediaWatermarks(c3.cleaned).isAiGenerated !== true);

console.log(`\nmedia-clean: ${pass} passed`);
