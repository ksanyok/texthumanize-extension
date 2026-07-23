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
export { AIDetector, detectAi, sentenceScores, quickScore } from './detector.js';
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
export { contentHealth, gradeFromScore } from './health.js';
export { uniquenessScore, compareTexts } from './uniqueness.js';
export { perplexityScore } from './perplexity.js';
export { textStatistics } from './statistics.js';
export { extractKeywords } from './keywords.js';
export { analyzeSentiment } from './sentiment.js';
export { summarize } from './summarize.js';
export { classifyContent } from './content-type.js';
export { detectMediaWatermarks, mediaFormat, mediaWatermarkReport, cleanMediaWatermarks, mediaCleanReport } from './media-forensics.js';
export { siteForensics, FINGERPRINTS } from './site-forensics.js';
export {
  MODULES, getModule, moduleForOp, modulesIn, inlineModules,
  TOOLS, getTool, isUnlocked, inlineTools, MONETIZATION_ENABLED,
} from './entitlements.js';

export const ENGINE_VERSION = '2.0.0';
export const LIBRARY_VERSION = '0.34.0';
