/**
 * Media watermark & provenance forensics — pure-browser JS port of
 * TextHumanize's Python `media_watermark` module (texthumanize/media_watermark.py).
 *
 * ES module, zero dependencies, MV3-service-worker safe: uses only
 * `Uint8Array` / `ArrayBuffer` / `DataView` / `TextDecoder` / `TextEncoder`.
 * No Node APIs (no `Buffer`, no `fs`), no DOM, no network, no file I/O.
 *
 * What it inspects (mirrors the Python engine):
 *   - Container metadata: PNG chunks (tEXt/iTXt/zTXt, eXIf, caBX/C2PA),
 *     JPEG APPn/COM segments (APP1 EXIF/XMP, APP11 JUMBF/C2PA), RIFF chunks
 *     (WebP/WAV), ISO-BMFF boxes (MP4/MOV: udta/meta/uuid/ilst…), and a
 *     bounded EBML sweep for Matroska/WebM.
 *   - Generator signatures (Midjourney, DALL·E, Stable Diffusion, ComfyUI,
 *     AUTOMATIC1111, Firefly, Leonardo, NovelAI, Ideogram, Playground,
 *     Google/Imagen, and more).
 *   - C2PA / provenance markers (c2pa, jumbf, contentauth, XMP GenAI fields,
 *     trainedAlgorithmicMedia / digitalSourceType).
 *
 * Honest limits: detection covers *inspectable* signals only. It cannot detect
 * robust in-content neural watermarks such as Google SynthID. Absence of a
 * marker is NOT proof that media is human-made — hence `isAiGenerated` may be
 * `null` ("unknown"), and this module never asserts "made by a human".
 *
 * @module engine/media-forensics
 */

// ─────────────────────────────────────────────────────────────
//  Signature tables (ported verbatim from the Python engine)
// ─────────────────────────────────────────────────────────────

/**
 * Markers (lowercased) that indicate an AI generator when found in textual
 * metadata. Maps marker -> human label.
 * @type {Record<string, string>}
 */
export const MEDIA_GENERATOR_SIGNATURES = {
  'stable diffusion': 'Stable Diffusion',
  'stablediffusion': 'Stable Diffusion',
  'automatic1111': 'AUTOMATIC1111 (Stable Diffusion)',
  'comfyui': 'ComfyUI (Stable Diffusion)',
  'invokeai': 'InvokeAI (Stable Diffusion)',
  'midjourney': 'Midjourney',
  'dall-e': 'DALL·E (OpenAI)',
  'dall·e': 'DALL·E (OpenAI)',
  'dalle': 'DALL·E (OpenAI)',
  'openai': 'OpenAI',
  'firefly': 'Adobe Firefly',
  'adobe firefly': 'Adobe Firefly',
  'leonardo.ai': 'Leonardo.Ai',
  'leonardo ai': 'Leonardo.Ai',
  'novelai': 'NovelAI',
  'playground': 'Playground AI',
  'ideogram': 'Ideogram',
  'flux': 'FLUX (Black Forest Labs)',
  'imagen': 'Google Imagen',
  'synthid': 'Google SynthID (declared)',
  'gemini': 'Google Gemini',
  'runway': 'Runway',
  'sora': 'OpenAI Sora',
  'kling': 'Kling AI',
  'pika': 'Pika',
  'elevenlabs': 'ElevenLabs (audio)',
  'suno': 'Suno (audio)',
  'udio': 'Udio (audio)',
  // 2026 additions — distinctive tokens only (see research/site-media-traces-2026.md)
  'recraft': 'Recraft',
  'seedream': 'Seedream (ByteDance)',
  'seedance': 'Seedance (ByteDance)',
  'hunyuanvideo': 'Hunyuan (Tencent)',
  'nano-banana': 'Gemini Nano Banana (Google)',
  'reve.art': 'Reve',
  'stable-signature': 'Meta Stable Signature (declared)',
  'trainedalgorithmic': 'AI-generated (IPTC digitalSourceType)',
};

const TEXT_ENCODER = new TextEncoder();
const LATIN1_DECODER = new TextDecoder('latin1');
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });
const EMPTY = new Uint8Array(0);

/**
 * @typedef {Object} MarkerSpec
 * @property {string} s      Lowercased marker text.
 * @property {Uint8Array} needle UTF-8 bytes of `s` (precomputed).
 * @property {string} label  Human description.
 * @property {string} category
 * @property {string} severity
 * @property {boolean} [ai]        True when the marker implies AI generation.
 * @property {boolean} [authentic] True when the marker implies a camera/authentic source.
 */

/**
 * C2PA / XMP provenance markers (case-insensitive byte search). Category &
 * severity mirror the Python `_scan_markers` classification.
 * @type {MarkerSpec[]}
 */
const PROVENANCE_MARKERS = [
  { s: 'c2pa', label: 'C2PA manifest (Content Credentials)', category: 'c2pa', severity: 'high' },
  { s: 'jumbf', label: 'JUMBF box (C2PA/JPEG provenance)', category: 'c2pa', severity: 'medium' },
  { s: 'contentauth', label: 'Content Authenticity Initiative (CAI)', category: 'c2pa', severity: 'medium' },
  { s: 'trainedalgorithmicmedia', label: 'XMP digitalSourceType: trainedAlgorithmicMedia (AI-generated)', category: 'xmp', severity: 'high', ai: true },
  { s: 'compositewithtrainedalgorithmicmedia', label: 'XMP digitalSourceType: AI-composited', category: 'xmp', severity: 'high', ai: true },
  { s: 'digitalsourcetype', label: 'XMP digitalSourceType (provenance)', category: 'xmp', severity: 'medium' },
  { s: 'http://ns.adobe.com/xap', label: 'XMP packet', category: 'xmp', severity: 'medium' },
].map((m) => ({ ...m, needle: TEXT_ENCODER.encode(m.s) }));

/**
 * Positive "authentic capture" markers (IPTC digitalSourceType values that
 * denote a camera / human origin). Used only to raise an `authentic` verdict
 * when no AI signal is present. Not in the Python engine — a small, honest
 * extension so the report can distinguish "authentic" from "unknown".
 * @type {MarkerSpec[]}
 */
const AUTHENTIC_MARKERS = [
  { s: 'digitalcapture', label: 'IPTC digitalSourceType: digitalCapture (camera original)', category: 'provenance', severity: 'low', authentic: true },
  { s: 'computationalcapture', label: 'IPTC digitalSourceType: computationalCapture (camera)', category: 'provenance', severity: 'low', authentic: true },
  { s: 'minorhumanedits', label: 'IPTC digitalSourceType: minorHumanEdits (human-edited capture)', category: 'provenance', severity: 'low', authentic: true },
].map((m) => ({ ...m, needle: TEXT_ENCODER.encode(m.s) }));

/** Generator-signature needles, precomputed once. */
const GENERATOR_MARKERS = Object.entries(MEDIA_GENERATOR_SIGNATURES).map(
  ([s, label]) => ({ s, label, needle: TEXT_ENCODER.encode(s) }),
);

const IMAGE_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp', 'bmp', 'tiff']);
const AUDIO_FORMATS = new Set(['wav', 'mp3', 'flac', 'ogg']);
const VIDEO_FORMATS = new Set(['mp4', 'mov', 'mkv', 'webm', 'matroska', 'avi']);

// ─────────────────────────────────────────────────────────────
//  Byte helpers
// ─────────────────────────────────────────────────────────────

/**
 * Coerce arbitrary binary input to a `Uint8Array` without copying when possible.
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView|number[]} input
 * @returns {Uint8Array}
 */
function toU8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Uint8Array.from(input);
  throw new TypeError('Expected Uint8Array / ArrayBuffer / typed-array bytes');
}

/** @param {Uint8Array} b @returns {DataView} */
function dv(b) {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

/** Decode a byte range as Latin-1 (byte-preserving 1:1 to U+0000..U+00FF). */
function latin1(b) {
  return LATIN1_DECODER.decode(b);
}

/**
 * Compare a slice of `bytes` (starting at `off`) against an ASCII string.
 * @param {Uint8Array} bytes @param {number} off @param {string} str
 */
function eqAscii(bytes, off, str) {
  if (off < 0 || off + str.length > bytes.length) return false;
  for (let i = 0; i < str.length; i++) {
    if (bytes[off + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

/** Compare a slice of `bytes` (at `off`) against an array of byte values. */
function eqBytes(bytes, off, sig) {
  if (off < 0 || off + sig.length > bytes.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[off + i] !== sig[i]) return false;
  }
  return true;
}

/** Copy `bytes` lowering only ASCII A–Z (mirrors Python `bytes.lower()`). */
function lowerAsciiCopy(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    out[i] = (c >= 0x41 && c <= 0x5a) ? c + 0x20 : c;
  }
  return out;
}

/**
 * Naive substring search over byte arrays.
 * @param {Uint8Array} hay @param {Uint8Array} needle @param {number} [from=0]
 * @returns {number} index of first match, or -1.
 */
function indexOfBytes(hay, needle, from = 0) {
  const n = hay.length;
  const m = needle.length;
  if (m === 0) return from <= n ? from : -1;
  if (m > n) return -1;
  const first = needle[0];
  const last = n - m;
  for (let i = Math.max(0, from); i <= last; i++) {
    if (hay[i] !== first) continue;
    let j = 1;
    for (; j < m; j++) {
      if (hay[i + j] !== needle[j]) break;
    }
    if (j === m) return i;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────
//  Format detection
// ─────────────────────────────────────────────────────────────

/**
 * Return a coarse media format string from magic bytes, or `'unknown'`.
 *
 * Recognises: png, jpeg, gif, webp, bmp, tiff, mp4, mov, webm/matroska (mkv),
 * wav, avi, mp3, flac, ogg.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} bytes
 * @returns {string}
 */
export function mediaFormat(bytes) {
  const data = toU8(bytes);
  if (data.length < 12) return 'unknown';

  if (eqBytes(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (eqBytes(data, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (eqAscii(data, 0, 'GIF87a') || eqAscii(data, 0, 'GIF89a')) return 'gif';
  if (eqAscii(data, 0, 'RIFF') && eqAscii(data, 8, 'WEBP')) return 'webp';
  if (eqAscii(data, 0, 'RIFF') && eqAscii(data, 8, 'WAVE')) return 'wav';
  if (eqAscii(data, 0, 'RIFF') && eqAscii(data, 8, 'AVI ')) return 'avi';
  if (eqAscii(data, 0, 'BM')) return 'bmp';
  if (eqBytes(data, 0, [0x49, 0x49, 0x2a, 0x00]) || eqBytes(data, 0, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (eqAscii(data, 0, 'ID3') || eqBytes(data, 0, [0xff, 0xfb]) || eqBytes(data, 0, [0xff, 0xf3]) || eqBytes(data, 0, [0xff, 0xf2])) return 'mp3';
  if (eqAscii(data, 0, 'fLaC')) return 'flac';
  if (eqAscii(data, 0, 'OggS')) return 'ogg';
  if (eqAscii(data, 4, 'ftyp')) {
    // Distinguish QuickTime (MOV) from MP4 via the major brand.
    const brand = latin1(data.subarray(8, 12));
    return brand === 'qt  ' ? 'mov' : 'mp4';
  }
  if (eqBytes(data, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML: peek the DocType to tell WebM from generic Matroska.
    const head = data.subarray(0, Math.min(data.length, 1024));
    if (indexOfBytes(head, TEXT_ENCODER.encode('webm')) !== -1) return 'webm';
    if (indexOfBytes(head, TEXT_ENCODER.encode('matroska')) !== -1) return 'matroska';
    return 'mkv';
  }
  return 'unknown';
}

/** Map a format string to a coarse media type. */
function mediaTypeFor(fmt) {
  if (IMAGE_FORMATS.has(fmt)) return 'image';
  if (AUDIO_FORMATS.has(fmt)) return 'audio';
  if (VIDEO_FORMATS.has(fmt)) return 'video';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────
//  Marker scanning + dedupe (generic helpers)
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Finding
 * @property {string} type
 * @property {string} category
 * @property {string} severity
 * @property {string} detail
 * @property {string} [generator]
 * @property {boolean} [ai]
 * @property {boolean} [authentic]
 */

/**
 * Scan a metadata blob for provenance, authentic-capture and generator markers.
 * @param {Uint8Array} blob
 * @returns {Finding[]}
 */
function scanMarkers(blob) {
  /** @type {Finding[]} */
  const findings = [];
  if (!blob || blob.length === 0) return findings;
  const low = lowerAsciiCopy(blob);

  for (const m of PROVENANCE_MARKERS) {
    if (indexOfBytes(low, m.needle) !== -1) {
      findings.push({
        type: 'provenance_metadata',
        category: m.category,
        severity: m.severity,
        detail: m.label,
        ...(m.ai ? { ai: true } : {}),
      });
    }
  }
  for (const g of GENERATOR_MARKERS) {
    if (indexOfBytes(low, g.needle) !== -1) {
      findings.push({
        type: 'generator_signature',
        category: 'generator',
        severity: 'high',
        detail: `Generator signature: ${g.label}`,
        generator: g.label,
      });
    }
  }
  for (const a of AUTHENTIC_MARKERS) {
    if (indexOfBytes(low, a.needle) !== -1) {
      findings.push({
        type: 'authentic_source',
        category: a.category,
        severity: a.severity,
        detail: a.label,
        authentic: true,
      });
    }
  }
  return findings;
}

/** Remove duplicate findings keyed on (type, detail). */
function dedupe(findings) {
  const seen = new Set();
  /** @type {Finding[]} */
  const out = [];
  for (const f of findings) {
    const key = `${f.type} ${f.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Append every element of `src` into `dst` (in place). */
function pushAll(dst, src) {
  for (let i = 0; i < src.length; i++) dst.push(src[i]);
}

// ─────────────────────────────────────────────────────────────
//  PNG
// ─────────────────────────────────────────────────────────────

/**
 * Iterate PNG chunks: yields { ctype, payload, start, end }.
 * @param {Uint8Array} data
 */
function* iterPngChunks(data) {
  const view = dv(data);
  const n = data.length;
  let pos = 8;
  while (pos + 8 <= n) {
    const length = view.getUint32(pos, false);
    const ctype = latin1(data.subarray(pos + 4, pos + 8));
    const start = pos + 8;
    const end = start + length;
    if (end > n) break;
    yield { ctype, payload: data.subarray(start, end), start: pos, end: end + 4 };
    pos = end + 4; // skip 4-byte CRC
  }
}

const PNG_TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt']);

// Chunk keywords that are essentially unique to image-generation tooling — the
// key name alone is conclusive. Maps key → the tool it identifies.
const PNG_STRONG_KEYS = {
  parameters: 'AUTOMATIC1111 / Forge / Fooocus (Stable Diffusion)',
  workflow: 'ComfyUI (Stable Diffusion)',
  'sd-metadata': 'InvokeAI (Stable Diffusion)',
  invokeai_metadata: 'InvokeAI (Stable Diffusion)',
  sui_image_params: 'SwarmUI (Stable Diffusion)',
  dream: 'InvokeAI (Stable Diffusion)',
  'negative prompt': 'Stable Diffusion',
};
// NB: generic keywords (prompt/comment/software/title/description/author) are
// deliberately NOT treated as AI evidence on the key name alone — a camera
// caption in Description or a Photoshop Comment used to be misread as AI. They
// count only when the VALUE carries an actual generation-parameter hint below.
// Substrings that only appear in real generation-parameter strings / node graphs.
const PNG_PARAM_HINTS = [
  'steps:', 'sampler', 'cfg scale', 'model hash', 'denoising_strength',
  'class_type', 'sampler_name', '"scheduler"', 'negative prompt:',
];

/**
 * @param {Uint8Array} data
 * @returns {{ findings: Finding[], meta: Object }}
 */
function parsePng(data) {
  /** @type {Finding[]} */
  const findings = [];
  const meta = { format: 'png', textChunks: [] };
  for (const { ctype, payload } of iterPngChunks(data)) {
    if (PNG_TEXT_CHUNKS.has(ctype)) {
      const text = latin1(payload).replace(/\x00/g, ' ');
      const key = (text.split(' ', 1)[0] || '').trim().toLowerCase();
      meta.textChunks.push(text.slice(0, 200));
      const lowText = text.toLowerCase();
      const strongKey = PNG_STRONG_KEYS[key];
      const hasHint = PNG_PARAM_HINTS.some((k) => lowText.includes(k));
      // Strong key → conclusive. Weak/any key → only when the value actually
      // contains generation parameters (so a human caption isn't misread as AI).
      if (strongKey || hasHint) {
        findings.push({
          type: 'embedded_generation_parameters',
          category: 'generation_params',
          severity: 'high',
          detail: strongKey
            ? `PNG ${ctype} '${key}' chunk — ${strongKey}`
            : `PNG ${ctype} chunk with Stable Diffusion generation parameters`,
          ...(strongKey ? { generator: strongKey } : {}),
        });
      }
      pushAll(findings, scanMarkers(payload));
    } else if (ctype === 'eXIf' || ctype === 'caBX' || ctype === 'iDOT') {
      pushAll(findings, scanMarkers(payload));
      if (ctype === 'caBX') {
        findings.push({
          type: 'provenance_metadata',
          category: 'c2pa',
          severity: 'high',
          detail: 'PNG caBX chunk (C2PA manifest box)',
        });
      }
    }
  }
  return { findings, meta };
}

// ─────────────────────────────────────────────────────────────
//  JPEG
// ─────────────────────────────────────────────────────────────

/**
 * Iterate JPEG marker segments: yields { marker, payload, pos }.
 * @param {Uint8Array} data
 */
function* iterJpegSegments(data) {
  const view = dv(data);
  const n = data.length;
  let pos = 2;
  while (pos + 4 <= n) {
    if (data[pos] !== 0xff) { pos += 1; continue; }
    const marker = data[pos + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    if (marker === 0xda) { yield { marker, payload: EMPTY, pos }; break; } // SOS — image data
    const segLen = view.getUint16(pos + 2, false);
    const payload = data.subarray(pos + 4, pos + 2 + segLen);
    yield { marker, payload, pos };
    pos += 2 + segLen;
  }
}

/**
 * @param {Uint8Array} data
 * @returns {{ findings: Finding[], meta: Object }}
 */
function parseJpeg(data) {
  /** @type {Finding[]} */
  const findings = [];
  const meta = { format: 'jpeg', appSegments: [] };
  for (const { marker, payload } of iterJpegSegments(data)) {
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) { // APPn or COM
      meta.appSegments.push(marker !== 0xfe ? `APP${marker - 0xe0}` : 'COM');
      pushAll(findings, scanMarkers(payload));
      const low = lowerAsciiCopy(payload);
      const hasJumbf = indexOfBytes(low, TEXT_ENCODER.encode('jumbf')) !== -1
        || indexOfBytes(payload, TEXT_ENCODER.encode('jumb')) !== -1;
      if (marker === 0xeb || hasJumbf) {
        if (marker === 0xeb || indexOfBytes(low, TEXT_ENCODER.encode('c2pa')) !== -1) {
          findings.push({
            type: 'provenance_metadata',
            category: 'c2pa',
            severity: 'high',
            detail: 'JPEG APP11/JUMBF segment (C2PA provenance)',
          });
        }
      }
      if (eqAscii(payload, 0, 'Exif') && payload[4] === 0 && payload[5] === 0) {
        if (indexOfBytes(low, TEXT_ENCODER.encode('software')) !== -1) {
          pushAll(findings, scanMarkers(payload));
        }
      }
    }
  }
  return { findings, meta };
}

// ─────────────────────────────────────────────────────────────
//  RIFF (WebP, WAV, AVI)
// ─────────────────────────────────────────────────────────────

/**
 * Iterate RIFF chunks: yields { cid, payload, start, end }.
 * @param {Uint8Array} data
 */
function* iterRiffChunks(data) {
  const view = dv(data);
  const n = data.length;
  let pos = 12;
  while (pos + 8 <= n) {
    const cid = latin1(data.subarray(pos, pos + 4));
    const size = view.getUint32(pos + 4, true);
    const start = pos + 8;
    const end = start + size;
    if (end > n) break;
    yield { cid, payload: data.subarray(start, end), start: pos, end };
    pos = end + (size & 1); // pad to even boundary
  }
}

/**
 * @param {Uint8Array} data @param {string} fmt
 * @returns {{ findings: Finding[], meta: Object }}
 */
function parseRiff(data, fmt) {
  /** @type {Finding[]} */
  const findings = [];
  const meta = { format: fmt, chunks: [] };
  for (const { cid, payload } of iterRiffChunks(data)) {
    const cidS = cid.replace(/\s+$/, '');
    meta.chunks.push(cidS);
    pushAll(findings, scanMarkers(payload));
    if (cid === 'C2PA' || cid === 'caBX') {
      findings.push({
        type: 'provenance_metadata',
        category: 'c2pa',
        severity: 'high',
        detail: `RIFF ${cidS} chunk (C2PA provenance)`,
      });
    }
  }
  return { findings, meta };
}

// ─────────────────────────────────────────────────────────────
//  ISO-BMFF (MP4 / MOV) and Matroska/WebM — detection only
// ─────────────────────────────────────────────────────────────

const MP4_SCAN_ATOMS = new Set(['uuid', 'meta', 'udta', 'Xtra', 'keys', 'ilst', 'data']);
const MP4_CONTAINER_ATOMS = new Set(['moov', 'udta', 'meta', 'trak', 'mdia', 'minf', 'stbl']);

/**
 * Walk ISO-BMFF boxes (MP4/MOV), scanning metadata boxes for markers.
 * @param {Uint8Array} data @param {string} [fmt='mp4']
 * @returns {{ findings: Finding[], meta: Object }}
 */
function parseMp4(data, fmt = 'mp4') {
  /** @type {Finding[]} */
  const findings = [];
  const meta = { format: fmt, atoms: [] };
  const view = dv(data);
  const total = data.length;

  /** @param {number} off @param {number} len @param {number} depth */
  function walk(off, len, depth) {
    let pos = 0;
    while (pos + 8 <= len) {
      const abs = off + pos;
      let size = view.getUint32(abs, false);
      const atom = latin1(data.subarray(abs + 4, abs + 8));
      let header = 8;
      if (size === 1 && pos + 16 <= len) {
        const big = view.getBigUint64(abs + 8, false);
        size = Number(big);
        header = 16;
      }
      if (size === 0) size = len - pos; // extends to end of parent
      if (!Number.isFinite(size) || size < header || pos + size > len) break;

      const payloadAbs = abs + header;
      const payload = data.subarray(payloadAbs, abs + size);
      if (depth === 0) meta.atoms.push(atom);
      if (MP4_SCAN_ATOMS.has(atom)) pushAll(findings, scanMarkers(payload));
      if (MP4_CONTAINER_ATOMS.has(atom) && depth < 4) {
        // `meta` boxes carry a 4-byte version/flags header before children.
        const subOff = atom === 'meta' ? payloadAbs + 4 : payloadAbs;
        const subLen = (abs + size) - subOff;
        if (subLen > 0) walk(subOff, subLen, depth + 1);
      }
      pos += size;
    }
  }

  walk(0, total, 0);
  pushAll(findings, scanMarkers(data.subarray(0, Math.min(total, 65536)))); // header sweep
  return { findings: dedupe(findings), meta };
}

/**
 * Bounded EBML marker sweep for Matroska / WebM (full EBML parsing skipped).
 * @param {Uint8Array} data @param {string} [fmt='mkv']
 * @returns {{ findings: Finding[], meta: Object }}
 */
function parseMatroska(data, fmt = 'mkv') {
  const findings = scanMarkers(data.subarray(0, Math.min(data.length, 131072)));
  return { findings: dedupe(findings), meta: { format: fmt } };
}

// ─────────────────────────────────────────────────────────────
//  Statistical analysis (stub)
// ─────────────────────────────────────────────────────────────

/**
 * Placeholder for image LSB steganography analysis.
 *
 * The Python engine decodes pixels via Pillow/NumPy to run a chi-square LSB
 * test. That needs a full image decoder, which is out of scope for a
 * zero-dependency service worker, so this stub always returns `null` (kept to
 * preserve API/behaviour parity — callers must treat `null` as "not analysed").
 *
 * @param {Uint8Array} _data
 * @returns {null}
 */
export function imageLsbAnalysis(_data) {
  return null;
}

// ─────────────────────────────────────────────────────────────
//  Verdict + public API
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} MediaSignal
 * @property {string} kind   Machine category: 'generator' | 'c2pa' | 'xmp'
 *   | 'generation_params' | 'authentic' | 'statistical' | string.
 * @property {string} label  Short human-readable name.
 * @property {string} detail Full description of the finding.
 */

/**
 * @typedef {Object} MediaWatermarkReport
 * @property {string} format        Detected container format ('png' … 'unknown').
 * @property {'image'|'audio'|'video'|'unknown'} mediaType
 * @property {'ai'|'authentic'|'none'} provenance  Verdict category.
 * @property {boolean|null} isAiGenerated  true | false | null. `null` = unknown;
 *   this module NEVER asserts a human author from mere absence of markers.
 * @property {number} confidence    Confidence in the verdict, 0..1.
 * @property {string|null} generator Named generator when identified, else null.
 * @property {MediaSignal[]} signals Human-readable findings.
 * @property {boolean} hasProvenance Whether any provenance/metadata signal exists.
 */

/**
 * Map an internal finding to a public, human-readable signal.
 * @param {Finding} f
 * @returns {MediaSignal}
 */
function toSignal(f) {
  let kind;
  let label;
  switch (f.type) {
    case 'generator_signature':
      kind = 'generator';
      label = f.generator || 'AI generator';
      break;
    case 'embedded_generation_parameters':
      kind = 'generation_params';
      label = 'Embedded generation parameters';
      break;
    case 'provenance_metadata':
      kind = f.category === 'c2pa' ? 'c2pa' : 'xmp';
      label = f.ai
        ? 'AI provenance (C2PA / XMP)'
        : (f.category === 'c2pa' ? 'Content Credentials (C2PA)' : 'XMP provenance metadata');
      break;
    case 'authentic_source':
      kind = 'authentic';
      label = 'Authentic capture source';
      break;
    case 'statistical_anomaly':
      kind = 'statistical';
      label = 'Statistical anomaly';
      break;
    default:
      kind = f.type || 'signal';
      label = f.category || 'signal';
  }
  return { kind, label, detail: f.detail };
}

/**
 * Derive an honest verdict from raw findings and assemble the public report.
 * @param {string} fmt @param {string} mediaType @param {Finding[]} findings
 * @returns {MediaWatermarkReport}
 */
function buildReport(fmt, mediaType, findings) {
  const generatorSig = findings.find((f) => f.type === 'generator_signature');
  const generator = generatorSig ? generatorSig.generator || null : null;
  const hasGenParams = findings.some((f) => f.type === 'embedded_generation_parameters');
  const aiMarker = findings.some((f) => f.ai === true); // trainedAlgorithmicMedia etc.
  const authenticMarker = findings.some((f) => f.authentic === true);

  const hasProvenance = findings.some((f) => (
    f.type === 'provenance_metadata'
    || f.type === 'authentic_source'
    || f.type === 'embedded_generation_parameters'
    || f.type === 'generator_signature'
  ));

  const aiSignal = Boolean(generatorSig) || aiMarker || hasGenParams;

  let provenance;
  /** @type {boolean|null} */
  let isAiGenerated;
  let confidence;

  if (aiSignal) {
    provenance = 'ai';
    isAiGenerated = true;
    // A named generator or an explicit trainedAlgorithmicMedia claim is the
    // strongest evidence; SD-style parameters alone are strong but unnamed.
    confidence = (generatorSig || aiMarker) ? 0.95 : 0.85;
  } else if (authenticMarker) {
    // A positive camera / authentic-capture provenance marker with NO AI signal.
    provenance = 'authentic';
    isAiGenerated = false;
    confidence = 0.7;
  } else {
    // Nothing conclusive — including the case where C2PA/XMP metadata exists but
    // carries no source type we can read. Absence of AI markers is NOT proof of
    // a human origin, so isAiGenerated stays null ("unknown").
    provenance = 'none';
    isAiGenerated = null;
    confidence = 0.0;
  }

  return {
    format: fmt,
    mediaType,
    provenance,
    isAiGenerated,
    confidence,
    generator,
    signals: findings.map(toSignal),
    hasProvenance,
  };
}

/**
 * Detect AI-watermark and provenance signals in an image / audio / video blob.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} bytes  Raw media bytes.
 * @param {{ mediaType?: string }} [opts]  `mediaType` may assert the expected
 *   category ('image'|'audio'|'video'); defaults to auto-detection.
 * @returns {MediaWatermarkReport}
 */
export function detectMediaWatermarks(bytes, opts = {}) {
  let data;
  try {
    data = toU8(bytes);
  } catch {
    return buildReport('unknown', 'unknown', []);
  }

  const fmt = mediaFormat(data);
  const mediaType = (opts && opts.mediaType && opts.mediaType !== 'auto')
    ? opts.mediaType
    : mediaTypeFor(fmt);

  /** @type {Finding[]} */
  let findings = [];
  try {
    if (fmt === 'png') {
      findings = parsePng(data).findings;
    } else if (fmt === 'jpeg') {
      findings = parseJpeg(data).findings;
    } else if (fmt === 'webp' || fmt === 'wav' || fmt === 'avi') {
      findings = parseRiff(data, fmt).findings;
    } else if (fmt === 'mp4' || fmt === 'mov') {
      findings = parseMp4(data, fmt).findings;
    } else if (fmt === 'mkv' || fmt === 'webm' || fmt === 'matroska') {
      findings = parseMatroska(data, fmt).findings;
    } else {
      // gif / bmp / tiff / mp3 / flac / ogg / unknown → bounded header sweep.
      findings = scanMarkers(data.subarray(0, Math.min(data.length, 262144)));
    }
  } catch {
    // Truncated / malformed container: fall back to a bounded byte sweep so a
    // partial file still yields a best-effort report instead of throwing.
    try {
      findings = scanMarkers(data.subarray(0, Math.min(data.length, 262144)));
    } catch {
      findings = [];
    }
  }

  return buildReport(fmt, mediaType, dedupe(findings));
}

/**
 * Full report wrapper — alias for {@link detectMediaWatermarks}.
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} bytes
 * @returns {MediaWatermarkReport}
 */
export function mediaWatermarkReport(bytes) {
  return detectMediaWatermarks(bytes);
}

// ─────────────────────────────────────────────────────────────
//  Cleaning — strip provenance/metadata, re-serialise the container.
//  Port of the Python `clean_media_watermarks` / `_clean_*` path.
//  Only container metadata is removed; pixel/audio content is untouched.
// ─────────────────────────────────────────────────────────────

// PNG ancillary chunks that carry text/metadata/provenance and are safe to drop.
const PNG_DROP_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'iCCP', 'caBX', 'caÿP']);

/** @param {Uint8Array} chunkBytes */
function chunkLooksProvenance(bytes) {
  const low = lowerAsciiCopy(bytes);
  for (const m of PROVENANCE_MARKERS) if (indexOfBytes(low, m.needle) !== -1) return true;
  for (const g of GENERATOR_MARKERS) if (indexOfBytes(low, g.needle) !== -1) return true;
  return false;
}

/** @param {Uint8Array} data @returns {{cleaned: Uint8Array, removedItems: {kind:string,label:string}[]}} */
function cleanPng(data) {
  const removedItems = [];
  const kept = [data.subarray(0, 8)]; // signature
  let off = 8;
  while (off + 8 <= data.length) {
    const len = dv(data).getUint32(off);
    const type = latin1(data.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (end > data.length) break;
    const chunk = data.subarray(off, end);
    const dataPart = data.subarray(off + 8, off + 8 + len);
    const drop = PNG_DROP_CHUNKS.has(type) || (type[0] >= 'a' && chunkLooksProvenance(dataPart));
    if (drop) removedItems.push({ kind: 'png:' + type, label: `PNG ${type} chunk` });
    else kept.push(chunk);
    if (type === 'IEND') break;
    off = end;
  }
  return { cleaned: concatBytes(kept), removedItems };
}

/** @param {Uint8Array} data */
function cleanJpeg(data) {
  const removedItems = [];
  const kept = [Uint8Array.of(0xff, 0xd8)]; // SOI
  let off = 2;
  const DROP = new Set([0xe1 /*APP1 EXIF/XMP*/, 0xeb /*APP11 JUMBF/C2PA*/, 0xed /*APP13 IPTC*/, 0xee /*APP14*/, 0xfe /*COM*/]);
  while (off + 4 <= data.length) {
    if (data[off] !== 0xff) { off++; continue; }
    const marker = data[off + 1];
    if (marker === 0xd9) { kept.push(Uint8Array.of(0xff, 0xd9)); break; } // EOI
    if (marker === 0xda) { kept.push(data.subarray(off)); break; } // SOS → copy rest verbatim
    if (marker >= 0xd0 && marker <= 0xd7) { kept.push(data.subarray(off, off + 2)); off += 2; continue; }
    const len = dv(data).getUint16(off + 2);
    const end = off + 2 + len;
    if (end > data.length) { kept.push(data.subarray(off)); break; }
    const seg = data.subarray(off, end);
    const payload = data.subarray(off + 4, end);
    const drop = DROP.has(marker) || ((marker & 0xf0) === 0xe0 && chunkLooksProvenance(payload));
    if (drop) removedItems.push({ kind: 'jpeg:APP' + (marker - 0xe0), label: `JPEG 0x${marker.toString(16)} segment` });
    else kept.push(seg);
    off = end;
  }
  return { cleaned: concatBytes(kept), removedItems };
}

/** @param {Uint8Array} data — RIFF (WebP/WAV/AVI) */
function cleanRiff(data) {
  const removedItems = [];
  const DROP = new Set(['EXIF', 'XMP ', 'ICCP', 'INFO', 'LIST', 'iCCP']);
  const head = data.subarray(0, 12); // 'RIFF' size 'WEBP'/'WAVE'
  const kept = [];
  let off = 12;
  while (off + 8 <= data.length) {
    const id = latin1(data.subarray(off, off + 4));
    const len = dv(data).getUint32(off + 4, true);
    const padded = len + (len & 1);
    const end = off + 8 + padded;
    if (end > data.length) break;
    const chunk = data.subarray(off, Math.min(end, data.length));
    const drop = DROP.has(id) || chunkLooksProvenance(data.subarray(off + 8, off + 8 + Math.min(len, 4096)));
    if (drop) removedItems.push({ kind: 'riff:' + id.trim(), label: `RIFF ${id.trim()} chunk` });
    else kept.push(chunk);
    off = end;
  }
  const body = concatBytes(kept);
  const out = concatBytes([head, body]);
  // Fix RIFF size field = total - 8.
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return { cleaned: out, removedItems };
}

function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Strip provenance metadata from an image container and return a valid file
 * of the same format with the metadata removed. Pixel/audio data is untouched.
 * Formats without a cleaner (gif/mp4/webm/…) are returned unchanged.
 *
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} bytes
 * @returns {{cleaned: Uint8Array, format: string, removed: number, removedItems: {kind:string,label:string}[], report: MediaWatermarkReport}}
 */
export function cleanMediaWatermarks(bytes) {
  const data = toU8(bytes);
  const report = detectMediaWatermarks(data);
  const fmt = report.format;
  let result;
  try {
    if (fmt === 'png') result = cleanPng(data);
    else if (fmt === 'jpeg') result = cleanJpeg(data);
    else if (fmt === 'webp' || fmt === 'wav' || fmt === 'avi') result = cleanRiff(data);
    else result = { cleaned: data, removedItems: [{ kind: 'unsupported', label: `no metadata cleaner for ${fmt}` }] };
  } catch {
    result = { cleaned: data, removedItems: [] };
  }
  const stripped = result.removedItems.filter((r) => r.kind !== 'unsupported');
  return {
    cleaned: result.cleaned,
    format: fmt,
    removed: stripped.length,
    removedItems: result.removedItems,
    report,
  };
}

/**
 * Convenience wrapper returning the clean bytes plus a compact summary.
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} bytes
 */
export function mediaCleanReport(bytes) {
  return cleanMediaWatermarks(bytes);
}
