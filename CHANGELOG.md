# Changelog

All notable changes to TextHumanize for Chrome.

## [3.3.0] — 2026-07-21

Evidence-driven detection overhaul (see `research/` for the 2026 catalogs) plus
a self-improving-weights story shared with the library.

### Site detection
- **Reads the page's own default subdomain** — the cheapest, most certain
  signal. A site still on `*.lovable.app`, `v0-*.vercel.app`, `*.framer.website`,
  `*.wixsite.com`, … is identified from the hostname alone (dot-bounded match,
  `v0-` prefix special-cased). Previously the hostname was collected but unused.
- **Free-tier badges** (`#lovable-badge`, `.w-webflow-badge`, …) and
  live-verified 2026 code markers confirm platforms on custom domains.
- **New builders** — Base44, Emergent — and a separate weak **"vibe-host"** tier
  for generic deploy hosts (`netlify.app`, `pages.dev`, …) that only matters
  stacked with a code smell.

### Image / media
- **Fixed a false-positive class** — a human photo carrying a `Description` /
  `Title` / `Comment` / `Software` metadata chunk was reported as AI. Generic
  keys now require a real generation-parameter value; only tool-unique keys
  (`parameters`, `workflow`, `sd-metadata`, `invokeai_metadata`,
  `sui_image_params`, `dream`) are conclusive on the key name alone.
- **Wider coverage** — ComfyUI `class_type`/`sampler_name`, SwarmUI, and 2026
  generator signatures (Recraft, Seedream/Seedance, Hunyuan, Reve).

### Text detection
- **New `structure` metric** — enumeration / list-intro / participial-tail /
  negative-parallelism scaffolding. Paraphrase-robust; the 2025-2026 chat
  "assistant register" (scored ~40% human before) is now caught.
- **Two inverted signals fixed** — `voice` no longer scores passive as AI;
  `punctuation` no longer scores `;` `:` `—` `« »` as AI (they were firing on
  well-edited human prose — the em-dash/quote false positives you reported).
- **Anti-evasion normalization** — strips zero-width, folds homoglyphs in
  Latin-majority words (genuine Cyrillic/Greek preserved).
- **Weights rebalanced** off dead metrics; AI-cliché dictionary gains the
  assistant register (feeds both detection and humanization).

### Tooling
- `npm run bench:detector` (per-metric separation, evasion resistance, FP audit)
  joins `bench-humanize` and `e2e-smoke` in the `npm run package` gate.

## [3.2.0] — 2026-07-21

- **Humanization quality** — a ~250-phrase AI-cliché dictionary (en/ru/uk/de/es/
  pl) that finally removes the openers the detector penalises ("In today's…",
  "В современном мире…"); phrases replace at near-certainty; sentence-merge runs
  before connector replacement; grammar guards (case-government in RU/UK/PL/DE,
  no bare-preposition swaps, no `help` + gerund, whitespace/caps on deletion).
  Corpus result: mean AI 64→49, surviving markers 20/116 → 2/116, 0 mechanical
  faults. New `npm run bench` measures it.

## [3.1.10] — 2026-07-19

### Fixed
- **Popup Humanize button crashed in the real extension** (`i18n.getMessage(…):
  No matching signature`) — `t()` received a non-string key via an optional
  chain. Hardened `t()` in `popup/bridge.js` + `content/shared.js` and resolved
  the module from the op. This caused a Chrome Web Store rejection ("functionality
  could not be reproduced"); it only reproduced in-extension, so a new
  `scripts/e2e-smoke.mjs` now drives the real loaded extension in the package gate.

## [3.1.0] — 2026-07-18

### Added
- **AI-built-site detection** — a living score orb tells you whether a whole page
  was likely made with AI, from the page's own code (generator, asset hosts,
  data-* attributes, class stacks, fonts, palette): 80+ builders/CMS + the
  shadcn/Radix/Geist stacks AI coding tools emit. Evidence listed openly; 👍/👎
  corrects the verdict per site (content-free, on-device).
- **Per-site opt-in** on-page block highlighting (off by default) + a red dot on
  the toolbar icon when the detector is off; the icon shows the site AI score.
- **Right-click image AI check**, before/after humanize word-diff, 14 UI
  languages (incl. RTL Arabic), Firefox/Edge packages.

## [3.0.0] — 2026-07-17

### Added
- Hover AI-score on text and images; on-page counters of AI text/images in the
  toolbar; module registry (all modules free); popup redesign with quick
  check/fix of a selection or an image inside editors.

## [2.1.0] — 2026-07-17

A usability + reliability pass answering real feedback.

### Added
- **Popup is now a hub with 3 tabs — Text · Page · Media:**
  - **Text**: big Humanize CTA + Check / Tone / Readability / Paraphrase, with a
    circular **AI-score gauge**, a **per-sentence AI heatmap** (red = AI-like,
    green = human), readability gauges, and a one-tap "Humanize now" when a text
    scores AI-like.
  - **Page**: "Scan this page" reports how much on-page text looks AI-written,
    how many images carry AI-provenance markers, page readability, with one-tap
    humanize on the most AI-like passages.
  - **Media**: drag-and-drop an image/media file → provenance verdict + one-click
    **download a copy with metadata/provenance stripped**.
- Per-sentence heatmap scorer that works on single sentences (the full detector
  returns 0 for <2 sentences), anchored to the document score.
- Media **cleaning** (metadata/provenance removal) for PNG / JPEG / WebP / WAV.

### Fixed
- **Editors in iframes now work** — classic WordPress/TinyMCE and the WordPress
  6.3+ block-editor canvas run inside an `<iframe>`; the content scripts now
  inject into all frames, so the action chip appears there too.
- Image-hover provenance and settings toggles reworked to actually take effect.

### Changed
- **Removed style profiles** — simpler, no dropdown; one sensible default.
- Settings are now a clear list of module toggles (bubble, editor chip, image
  hover, effects, watermark cleaning, anonymous stats).
- Full visual redesign of the popup and settings (gauges, heatmap, drop zone,
  cleaner spacing, dark/light).

## [2.0.0] — 2026-07-16

The "show it off" release — the extension now surfaces most of the
TextHumanize library's toolkit, right where you write.

### Added
- **In-editor action chip** — focus any text field or rich editor (Gmail, X,
  LinkedIn, Reddit, Notion, Slack, ChatGPT, WordPress, contenteditable,
  textareas…) and a small chip offers Humanize / Check / Tone / Paraphrase /
  Clean, with in-place replacement.
- **Image AI-provenance on hover** (opt-in) — hover an image to check it for
  AI-generation markers (C2PA / XMP / EXIF / generator signatures, incl.
  Midjourney, DALL·E, Stable Diffusion, Firefly…). Honest verdicts:
  "AI-generated", "Authentic (C2PA)", or "No AI markers (not a guarantee)".
  Scanning is 100% on-device.
- **New tools:** Tone analysis + one-click tone adjust, Readability (Flesch,
  Flesch–Kincaid, Gunning Fog, SMOG, Coleman–Liau…), Paraphrase, and Style DNA
  (stylometric fingerprint) — all offline, ported from the library.
- **Tasteful effects** — sparkle bursts, count-up scores, shimmer, spring
  pop-ins; fully disabled under `prefers-reduced-motion` or via a setting.
- **Anonymous, content-free usage stats** (on by default, disclosed, one-click
  off) plus a local on-device usage view. Your text is never sent.
- Pro-tier scaffolding (feature flags) — everything is free in 2.0; monetization
  can be switched on later without a rebuild.

### Changed
- Content layer refactored into a shared `THX` namespace (shared / panel /
  editors / images / orchestrator) — still zero-build, classic scripts.
- Manifest v2.0.0; added `optional_host_permissions` (`<all_urls>`, requested
  only when you enable image checks) and optional `clipboardWrite`.
- Privacy policy updated to disclose anonymous usage stats and image scanning.

## [1.0.0] — 2026-07-16

- Initial release: offline Humanize / AI-style Check / Watermark Clean,
  selection bubble, popup + full-page workspace, 25 language dictionaries,
  10 UI locales.
