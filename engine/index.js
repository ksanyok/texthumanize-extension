/**
 * TextHumanize browser engine — public API.
 *
 * 100% offline text naturalization, AI-style analysis and watermark
 * cleaning, powered by the TextHumanize library dictionaries.
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

export const ENGINE_VERSION = '1.0.0';
export const LIBRARY_VERSION = '0.34.0';
