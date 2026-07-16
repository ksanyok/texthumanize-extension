/**
 * TextHumanize browser engine — public API.
 *
 * 100% offline text naturalization, AI-style analysis, watermark cleaning,
 * tone, readability, paraphrase, stylometry, content typing and image
 * provenance forensics — powered by the TextHumanize library dictionaries.
 *
 * @see https://github.com/ksanyok/TextHumanize
 * @module engine
 */

export { humanize } from './pipeline.js';
export { AIDetector, detectAi } from './detector.js';
export { detectLanguage } from './lang-detect.js';
export { WatermarkDetector, detectWatermarks, cleanWatermarks } from './watermark.js';
export { TypographyNormalizer } from './normalizer.js';
export { Debureaucratizer } from './debureaucratizer.js';
export { TextNaturalizer } from './naturalizer.js';
export { Rng, splitSentences, changeRatio, maskProtected } from './util.js';

// v2 tools
export { analyzeTone, adjustTone, ToneAnalyzer, ToneAdjuster } from './tone.js';
export { analyzeReadability, ReadabilityAnalyzer } from './readability.js';
export { paraphrase, ParaphraseEngine } from './paraphrase.js';
export { fingerprint, compareStyle, Stylometry } from './stylometry.js';
export { classifyContent } from './content-type.js';
export { detectMediaWatermarks, mediaFormat, mediaWatermarkReport } from './media-forensics.js';
export { TOOLS, getTool, isUnlocked, inlineTools, MONETIZATION_ENABLED } from './entitlements.js';

export const ENGINE_VERSION = '2.0.0';
export const LIBRARY_VERSION = '0.34.0';
