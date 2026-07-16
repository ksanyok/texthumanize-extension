/**
 * Self-test for engine/media-forensics.js.
 * Builds real media containers (with correct CRC32/Adler32) in memory and
 * checks the forensic verdicts. Pure Node, zero deps.
 *
 * Run: node engine/media-forensics.test.mjs
 */
import {
  mediaFormat,
  detectMediaWatermarks,
  mediaWatermarkReport,
} from './media-forensics.js';

// ── tiny assert harness ───────────────────────────────────────
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log(`  ok   - ${msg}`); }
  else { failed++; console.error(`  FAIL - ${msg}`); }
}
function eq(actual, expected, msg) {
  ok(Object.is(actual, expected), `${msg} (got ${JSON.stringify(actual)})`);
}

// ── byte builders ─────────────────────────────────────────────
const enc = new TextEncoder();

/** CRC-32 (IEEE 802.3, PNG polynomial). */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xedb88320) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 checksum (for zlib streams). */
function adler32(bytes) {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function concat(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function u32be(v) {
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}
function u16be(v) {
  return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
}
function u16le(v) {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}

/** Build one PNG chunk: len + type + data + crc(type+data). */
function pngChunk(type, data) {
  const typeBytes = enc.encode(type);
  const body = concat([typeBytes, data]);
  return concat([u32be(data.length), body, u32be(crc32(body))]);
}

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 1×1 RGB IHDR. */
function ihdr() {
  return concat([
    u32be(1), u32be(1),
    new Uint8Array([8, 2, 0, 0, 0]), // bitdepth=8, colortype=2 (RGB), comp, filter, interlace
  ]);
}

/** A minimal valid zlib stream (stored block) wrapping `raw`. */
function zlibStored(raw) {
  const len = raw.length;
  return concat([
    new Uint8Array([0x78, 0x01]),          // zlib header
    new Uint8Array([0x01]),                // final stored block
    u16le(len), u16le((~len) & 0xffff),    // LEN / NLEN
    raw,
    u32be(adler32(raw)),
  ]);
}

/** Build a PNG from a list of [type, data] chunk specs (IHDR/IEND added). */
function buildPng(extraChunks = []) {
  const parts = [PNG_SIG, pngChunk('IHDR', ihdr())];
  for (const [type, data] of extraChunks) parts.push(pngChunk(type, data));
  // one IDAT so it's a genuine minimal image (detector ignores its content)
  parts.push(pngChunk('IDAT', zlibStored(new Uint8Array([0x00, 0x00, 0x00, 0x00]))));
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

/** Build a minimal JPEG: SOI + APP1(payload) + EOI. */
function buildJpegApp1(payload) {
  const segLen = payload.length + 2; // length field includes its own 2 bytes
  return concat([
    new Uint8Array([0xff, 0xd8]),           // SOI
    new Uint8Array([0xff, 0xe1]), u16be(segLen), payload,
    new Uint8Array([0xff, 0xd9]),           // EOI
  ]);
}

// ══════════════════════════════════════════════════════════════
console.log('Test 1: PNG with a Stable-Diffusion tEXt "parameters" chunk');
{
  const tEXt = concat([
    enc.encode('parameters'),
    new Uint8Array([0x00]),
    enc.encode('Stable Diffusion, steps: 20, sampler: Euler'),
  ]);
  const png = buildPng([['tEXt', tEXt]]);

  eq(mediaFormat(png), 'png', 'format is png');
  const r = detectMediaWatermarks(png);
  eq(r.isAiGenerated, true, 'isAiGenerated === true');
  eq(r.provenance, 'ai', 'provenance === ai');
  eq(r.generator, 'Stable Diffusion', 'generator === Stable Diffusion');
  ok(r.confidence >= 0.9, `confidence high (${r.confidence})`);
  eq(r.hasProvenance, true, 'hasProvenance === true');
  ok(r.signals.some((s) => s.kind === 'generation_params'), 'has a generation_params signal');
  ok(r.signals.some((s) => s.kind === 'generator'), 'has a generator signal');
}

console.log('Test 2: clean PNG with no text/metadata chunks');
{
  const png = buildPng([]);
  eq(mediaFormat(png), 'png', 'format is png');
  const r = mediaWatermarkReport(png);
  eq(r.provenance, 'none', 'provenance === none');
  eq(r.isAiGenerated, null, 'isAiGenerated === null (unknown, never "human")');
  eq(r.generator, null, 'generator === null');
  eq(r.hasProvenance, false, 'hasProvenance === false');
  eq(r.confidence, 0, 'confidence === 0');
  eq(r.signals.length, 0, 'no signals');
}

console.log('Test 3: JPEG APP1 XMP with trainedAlgorithmicMedia');
{
  const xmp = concat([
    enc.encode('http://ns.adobe.com/xap/1.0/'),
    new Uint8Array([0x00]),
    enc.encode(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
      + '<rdf:Description Iptc4xmpExt:DigitalSourceType='
      + '"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>'
      + '</x:xmpmeta>',
    ),
  ]);
  const jpg = buildJpegApp1(xmp);

  eq(mediaFormat(jpg), 'jpeg', 'format is jpeg');
  const r = detectMediaWatermarks(jpg);
  eq(r.provenance, 'ai', 'provenance === ai');
  eq(r.isAiGenerated, true, 'isAiGenerated === true');
  ok(r.confidence >= 0.9, `confidence high (${r.confidence})`);
  eq(r.hasProvenance, true, 'hasProvenance === true');
  ok(r.signals.some((s) => s.detail.includes('trainedAlgorithmicMedia')), 'has trainedAlgorithmicMedia signal');
}

console.log('Test 4: format sniffing for assorted magic bytes');
{
  const pad = (head) => { const a = new Uint8Array(16); a.set(head, 0); return a; };
  eq(mediaFormat(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'gif', 'GIF89a → gif');
  eq(mediaFormat(pad([0x42, 0x4d])), 'bmp', 'BM → bmp');
  eq(mediaFormat(pad([0x66, 0x4c, 0x61, 0x43])), 'flac', 'fLaC → flac');
  eq(mediaFormat(pad([0x4f, 0x67, 0x67, 0x53])), 'ogg', 'OggS → ogg');
  eq(mediaFormat(pad([0x49, 0x49, 0x2a, 0x00])), 'tiff', 'II*\\0 → tiff');
  // RIFF/WEBP
  eq(mediaFormat(concat([enc.encode('RIFF'), u32be(0), enc.encode('WEBP'), new Uint8Array(4)])), 'webp', 'RIFF/WEBP → webp');
  // ISO-BMFF ftyp → mp4 vs mov
  eq(mediaFormat(concat([u32be(20), enc.encode('ftyp'), enc.encode('isom'), new Uint8Array(4)])), 'mp4', 'ftyp isom → mp4');
  eq(mediaFormat(concat([u32be(20), enc.encode('ftyp'), enc.encode('qt  '), new Uint8Array(4)])), 'mov', 'ftyp "qt  " → mov');
  // EBML → webm / mkv
  eq(mediaFormat(concat([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), enc.encode('....webm....'), new Uint8Array(8)])), 'webm', 'EBML+webm → webm');
  eq(mediaFormat(new Uint8Array(4)), 'unknown', 'too short → unknown');
}

console.log('Test 5: robustness on truncated / garbage bytes');
{
  // Truncated PNG (signature + a chunk header claiming more than exists).
  const bad = concat([PNG_SIG, u32be(9999), enc.encode('tEXt'), new Uint8Array([1, 2, 3])]);
  const r = detectMediaWatermarks(bad);
  ok(r && r.provenance === 'none', 'truncated PNG → no crash, provenance none');
  const r2 = detectMediaWatermarks(new Uint8Array(0));
  eq(r2.format, 'unknown', 'empty input → unknown, no crash');
  // ArrayBuffer input path
  const r3 = detectMediaWatermarks(buildPng([]).buffer);
  eq(r3.format, 'png', 'accepts ArrayBuffer input');
}

// ── summary ───────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
