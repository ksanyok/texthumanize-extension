/**
 * Processing pipeline — orchestrates all stages with protection masking,
 * adaptive intensity and change-ratio safeguards.
 * Mirrors the TextHumanize library pipeline (browser-sized).
 * @module engine/pipeline
 */

import { maskProtected, changeRatio } from './util.js';
import { TypographyNormalizer } from './normalizer.js';
import { Debureaucratizer } from './debureaucratizer.js';
import { TextNaturalizer } from './naturalizer.js';
import { WatermarkDetector } from './watermark.js';
import { detectLanguage } from './lang-detect.js';
import { AIDetector } from './detector.js';

/**
 * @typedef {Object} HumanizeOptions
 * @property {string} [lang] 'auto' or language code
 * @property {string} [profile] chat|web|seo|docs|formal|academic|marketing|social|email
 * @property {number} [intensity] 0..100
 * @property {number} [seed]
 * @property {boolean} [cleanWatermarks] strip invisible chars/homoglyphs first
 * @property {Record<string, boolean|string[]>} [preserve]
 * @property {number} [maxChangeRatio] 0..1
 * @property {object|null} [langPack] preloaded language pack JSON
 */

/**
 * Run the full humanization pipeline.
 * @param {string} text
 * @param {HumanizeOptions} [options]
 */
export function humanize(text, options = {}) {
  const opts = {
    lang: 'auto',
    profile: 'web',
    intensity: 60,
    seed: 0,
    cleanWatermarks: true,
    preserve: {},
    maxChangeRatio: 0.4,
    langPack: null,
    ...options,
  };

  if (!text || !text.trim()) {
    return emptyResult(text, opts);
  }

  const lang = opts.lang === 'auto' || !opts.lang ? detectLanguage(text) : opts.lang;
  const detector = new AIDetector();
  const before = detector.detect(text, { lang, langPack: opts.langPack });

  /** @type {Array<{type: string, description: string}>} */
  const changes = [];
  const original = text;

  // 0. Watermark / invisible-character cleanup (always safe).
  let watermarkReport = null;
  if (opts.cleanWatermarks) {
    const wm = new WatermarkDetector(lang);
    watermarkReport = wm.detect(text);
    if (watermarkReport.charactersRemoved > 0) {
      text = watermarkReport.cleanedText;
      changes.push({
        type: 'watermark_clean',
        description: `removed ${watermarkReport.charactersRemoved} hidden characters`,
      });
    }
  }

  // Adaptive intensity based on the AI-style score (like the library pipeline).
  const aiScore = Math.round(before.aiProbability * 100);
  let intensity = opts.intensity;
  if (aiScore <= 5) {
    intensity = 0; // Typography only.
  } else if (aiScore <= 15) {
    intensity = Math.max(8, Math.floor(intensity * 0.35));
  } else if (aiScore <= 25) {
    intensity = Math.max(10, Math.floor(intensity * 0.5));
  } else if (aiScore >= 70) {
    intensity = Math.min(100, Math.floor(intensity * 1.3));
  }
  if (intensity !== opts.intensity) {
    changes.push({
      type: 'adaptive_intensity',
      description: `AI=${aiScore}%: intensity ${opts.intensity} → ${intensity}`,
    });
  }

  const run = (level, seed = opts.seed, input = text, withTypography = true, mode = 'both') => {
    const { masked, restore } = maskProtected(input, opts.preserve);
    let processed = masked;
    const stageChanges = [];

    if (withTypography) {
      const normalizer = new TypographyNormalizer(opts.profile, lang);
      processed = normalizer.normalize(processed);
      stageChanges.push(...normalizer.changes);
    }

    if (level > 0 && opts.langPack) {
      // Naturalizer first: connector drops/merges must see the original
      // connectors before the debureaucratizer rewrites them.
      if (mode === 'both' || mode === 'naturalize') {
        const naturalizer = new TextNaturalizer(opts.langPack, opts.profile, level, seed);
        processed = naturalizer.process(processed);
        stageChanges.push(...naturalizer.changes);
      }

      if (mode === 'both' || mode === 'decancel') {
        const decancel = new Debureaucratizer(opts.langPack, opts.profile, level, seed);
        processed = decancel.process(processed);
        stageChanges.push(...decancel.changes);
      }
    }

    return { result: restore(processed), stageChanges };
  };

  let { result, stageChanges } = run(intensity);

  // Change-ratio guard with graduated retry (like the library).
  let ratio = changeRatio(original, result);
  if (ratio > opts.maxChangeRatio && intensity > 5) {
    const retryLevel = Math.max(5, Math.floor(intensity * 0.4));
    const retry = run(retryLevel);
    const retryRatio = changeRatio(original, retry.result);
    if (retryRatio <= opts.maxChangeRatio) {
      result = retry.result;
      stageChanges = retry.stageChanges;
      stageChanges.push({
        type: 'graduated_retry',
        description: `change ratio ${ratio.toFixed(2)} > ${opts.maxChangeRatio}, retried at ${retryLevel}`,
      });
      ratio = retryRatio;
    }
  }
  changes.push(...stageChanges);

  let after = detector.detect(result, { lang, langPack: opts.langPack });

  // Extra passes (like humanize_until_human): while the text still scores
  // clearly AI-like, retry on the intermediate result with shifted seeds
  // and stage subsets, keeping only variants our detector scores lower.
  if (intensity >= 40 && opts.langPack) {
    const ratioCap = Math.min(0.55, opts.maxChangeRatio + 0.15);
    const modes = ['both', 'naturalize', 'decancel', 'naturalize'];
    for (let attempt = 1; attempt <= 4 && after.aiProbability > 0.55; attempt++) {
      const seed = (opts.seed + attempt * 0x9e37) & 0x7fffffff;
      const pass = run(intensity, seed, result, false, modes[attempt - 1]);
      if (pass.result === result) continue;
      const passRatio = changeRatio(original, pass.result);
      if (passRatio > ratioCap) continue;
      const passDetect = detector.detect(pass.result, { lang, langPack: opts.langPack });
      if (passDetect.aiProbability < after.aiProbability) {
        result = pass.result;
        ratio = passRatio;
        after = passDetect;
        changes.push(...pass.stageChanges);
        changes.push({ type: 'extra_pass', description: `pass ${attempt + 1} applied (${modes[attempt - 1]})` });
      }
    }
  }

  // Never ship a variant our own detector scores clearly worse than the
  // typography-only baseline — fall back and say so.
  if (opts.langPack && after.aiProbability > before.aiProbability + 0.02) {
    const baseline = run(0);
    const baselineDetect = detector.detect(baseline.result, { lang, langPack: opts.langPack });
    if (baselineDetect.aiProbability < after.aiProbability) {
      result = baseline.result;
      ratio = changeRatio(original, result);
      after = baselineDetect;
      changes.length = 0;
      changes.push(...baseline.stageChanges);
      changes.push({
        type: 'fallback_baseline',
        description: 'transformations raised the internal score — kept typography-only version',
      });
    }
  }

  return {
    original,
    text: result,
    lang,
    profile: opts.profile,
    intensity: opts.intensity,
    effectiveIntensity: intensity,
    changes,
    changeRatio: ratio,
    watermark: watermarkReport && {
      types: watermarkReport.watermarkTypes,
      removed: watermarkReport.charactersRemoved,
    },
    before: summarizeDetection(before),
    after: summarizeDetection(after),
  };
}

/** @param {string} text @param {HumanizeOptions} opts */
function emptyResult(text, opts) {
  return {
    original: text || '',
    text: text || '',
    lang: opts.lang === 'auto' || !opts.lang ? 'en' : opts.lang,
    profile: opts.profile,
    intensity: opts.intensity,
    effectiveIntensity: 0,
    changes: [],
    changeRatio: 0,
    watermark: null,
    before: null,
    after: null,
  };
}

function summarizeDetection(d) {
  if (!d) return null;
  return {
    verdict: d.verdict,
    aiProbability: d.aiProbability,
    confidence: d.confidence,
    domain: d.domain,
    scores: d.scores,
    explanations: d.explanations,
    wordCount: d.wordCount,
    sentenceCount: d.sentenceCount,
  };
}
