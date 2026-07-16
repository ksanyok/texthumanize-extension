# Changelog

All notable changes to TextHumanize for Chrome.

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
