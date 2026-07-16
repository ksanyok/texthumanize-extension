<div align="center">

<img src="icons/icon128.png" width="96" alt="TextHumanize logo"/>

# TextHumanize for Chrome

### Offline text naturalizer, AI-style checker & hidden-watermark cleaner — on any page

**100% offline · 25 languages · Zero dependencies · Free & open source**

[![Tests](https://img.shields.io/badge/tests-27%20passed-2ea44f.svg)](tests/engine.test.js)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-4285F4.svg?logo=googlechrome&logoColor=white)]()
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Powered by TextHumanize](https://img.shields.io/badge/powered%20by-TextHumanize-6d5efc.svg)](https://github.com/ksanyok/TextHumanize)

*Built on the [TextHumanize](https://github.com/ksanyok/TextHumanize) library — the most advanced open-source text naturalization engine (240K+ LOC, 38-stage pipeline).*

[English](#what-it-does) · [Русский](#-по-русски)

</div>

---

## What it does

TextHumanize for Chrome brings the whole TextHumanize engine to every page you visit — and puts it right where you write:

- ✨ **Humanize** — reduce AI-typical style signals in any selected text: formulaic connectors, bureaucratic vocabulary, uniform sentence rhythm. Replace the text right on the page (inputs, textareas, editors) or copy the result.
- 🔍 **Check** — get an instant AI-style score (0–100%) computed by a 15-metric statistical detector ported 1:1 from the TextHumanize library: burstiness, entropy, AI-pattern density, passive voice, rhythm, perplexity and more.
- 🧹 **Clean** — strip hidden watermarks: zero-width characters, Unicode steganography, homoglyph substitutions, spacing anomalies. Includes a Kirchenbauer-style green-list statistical test.
- 🎭 **Tone** — analyze formality and one-click shift a passage more formal or more casual.
- 📖 **Readability** — Flesch Reading Ease, Flesch–Kincaid, Gunning Fog, SMOG, Coleman–Liau, and more.
- 🔀 **Paraphrase** & 🧬 **Style DNA** — reword text and read its stylometric fingerprint.
- 🖼️ **Image AI-provenance** *(opt-in)* — hover any image to check it for AI-generation markers (C2PA / XMP / EXIF / generator signatures: Midjourney, DALL·E, Stable Diffusion, Firefly…). Honest verdicts, scanned 100% on your device.

### Where you work

- **In-editor chip** — focus a text field or rich editor (Gmail, X, LinkedIn, Reddit, Notion, Slack, ChatGPT, WordPress…) and a small chip offers quick actions with in-place replacement.
- **Selection bubble** — select text anywhere → ✨ → results in a draggable panel.
- **Popup & full-page workspace** — for longer texts, with a word-level diff of every change.
- **Tasteful effects** — sparkles, count-up scores, shimmer; auto-off under reduced-motion.

### Why this extension

| | |
|---|---|
| 🔒 **Private by design** | Your text never leaves the browser — every text/analysis tool runs locally. Image scanning reads bytes on-device. The only thing that can ever leave is **anonymous, content-free** usage counts (tool names, never text), on by default and one-click off. See [PRIVACY.md](PRIVACY.md). |
| ⚡ **Fast** | 20–300 ms per paragraph, pure algorithmic processing (no ML downloads). |
| 🌍 **25 languages** | Full dictionaries for EN · RU · UK · DE · FR · ES · PL · IT · PT + 16 more, with automatic language detection. UI in 10 languages. |
| 🎛 **Precise control** | Intensity 0–100, 9 style profiles, reproducible seeded output, honest before/after scoring. |
| 🆓 **Free forever** | The extension is MIT-licensed and free. The underlying library is free for personal/open-source use; [commercial licensing](https://github.com/ksanyok/TextHumanize/blob/main/COMMERCIAL.md) applies to business use of the library itself. |

### How to use

1. **Select text** on any page → click the ✨ bubble (or right-click → *TextHumanize*).
2. Review the result in the floating panel: before/after AI score, editable output.
3. Click **Replace on page** (for editable fields) or **Copy**.

Or open the **popup** (toolbar icon) / **full-page workspace** for longer texts, with a word-level diff view of every change.

Keyboard shortcuts: `Ctrl/Cmd+Shift+H` — humanize selection, `Ctrl/Cmd+Shift+U` — check selection.

### Honest positioning

Like the library itself, this extension is a **style-normalization tool, not an AI-detection bypass tool**. It reduces AI-typical patterns and reports its own internal score honestly (including when it cannot improve a text — it will tell you and keep the typography-only version rather than make things worse). External AI detector results are not guaranteed.

### Install

- **Chrome Web Store**: *coming soon*
- **From source**: clone this repo → `chrome://extensions` → Developer mode → *Load unpacked* → select the repo folder.

### Architecture

```
engine/            Pure ES-module port of the TextHumanize core (zero deps, no build step)
  detector.js      15-metric statistical AI detector (1:1 port of detectors.py)
  naturalizer.js   Connector variation/drops, burstiness, starters, synonyms
  debureaucratizer.js  Bureaucratic word/phrase replacement with RU/UK gender guard
  watermark.js     Zero-width / homoglyph / spacing / Kirchenbauer detection & cleaning
  normalizer.js    Profile-aware typography
  lang-detect.js   Trigram + marker language detection
  pipeline.js      Multi-pass orchestration with change-ratio & score safeguards
data/langs/*.json  Full dictionaries exported from the library (25 languages, 665 KiB)
background.js      MV3 service worker — hosts the engine, context menus, commands
content/           Selection bubble + floating panel (closed Shadow DOM)
popup/             Popup & full-page workspace (also runs standalone as a web demo)
options/           Settings page
_locales/          UI translations (10 languages)
```

No bundler, no transpiler, no dependencies — what you read is what runs.

### Development

```bash
npm test                        # engine unit tests (node --test)
python3 scripts/export_langs.py --lib ../TextHumanize   # refresh dictionaries
python3 scripts/build_locales.py                        # rebuild _locales
bash scripts/package.sh                                 # build store zip
```

---

## 🇷🇺 По-русски

**TextHumanize для Chrome** — полностью офлайн-расширение на базе библиотеки [TextHumanize](https://github.com/ksanyok/TextHumanize): гуманизация текста, проверка на ИИ-стиль и очистка скрытых меток на любой странице браузера.

- ✨ **Гуманизация** — снижает ИИ-признаки в выделенном тексте (шаблонные связки, канцелярит, однородный ритм) и позволяет заменить текст прямо на странице.
- 🔍 **Проверка** — мгновенный ИИ-скор по 15 статистическим метрикам (точный порт детектора библиотеки).
- 🧹 **Очистка** — удаление невидимых символов, гомоглифов и других скрытых водяных знаков.

Текст **никогда не покидает ваш браузер**: никаких серверов, аккаунтов и сетевых запросов. 25 языков словарей, интерфейс на 10 языках, бесплатно и с открытым кодом.

> Расширение — инструмент нормализации стиля, а не «обхода детекторов». Оно честно показывает свой внутренний скор до/после и не гарантирует результатов внешних детекторов.

---

<div align="center">

**Made by [Alexandr Krikun](https://github.com/ksanyok)** · Powered by [TextHumanize](https://github.com/ksanyok/TextHumanize) · [texthumanize.link](https://texthumanize.link)

⭐ If this saves you time — star the repo and the [library](https://github.com/ksanyok/TextHumanize)!

</div>
