# Chrome Web Store listing texts

## Name (45 chars max)

```
TextHumanize — Humanize & Check AI Text
```

## Short description (132 chars max)

**EN**
```
100% offline: humanize AI-style text, check AI probability, remove hidden watermarks — on any page. 25 languages. Free.
```

**RU**
```
Полностью офлайн: гуманизация ИИ-текста, проверка ИИ-скора и удаление скрытых меток на любой странице. 25 языков. Бесплатно.
```

## Category

Productivity → Tools (or "Workflow & Planning")

## Detailed description — EN

```
TextHumanize brings a full offline text-naturalization engine into your browser. Select text on any page and instantly:

✨ HUMANIZE — reduce AI-typical style signals: formulaic connectors ("Furthermore", "Moreover"), bureaucratic vocabulary, uniform sentence rhythm. Replace the text right on the page (works in inputs, textareas and rich editors) or copy the result.

🔍 CHECK — get an honest AI-style score (0–100%) from a 15-metric statistical detector: sentence burstiness, entropy, AI-pattern density, passive voice, rhythm, perplexity and more — with a breakdown of the top signals.

🧹 CLEAN — strip hidden watermarks: zero-width characters, Unicode steganography, homoglyph substitutions (Cyrillic "о" in Latin words), trailing-space patterns. Includes a Kirchenbauer-style statistical watermark test.

WHY TEXTHUMANIZE

🔒 100% offline & private. Your text NEVER leaves the browser: no servers, no accounts, no analytics, no network requests at all. Check the source — it's open.
⚡ Fast. 20–300 ms per paragraph. Pure algorithms, no model downloads.
🌍 25 languages. Full dictionaries for English, Russian, Ukrainian, German, French, Spanish, Polish, Italian, Portuguese and 16 more, with automatic language detection. Interface in 10 languages.
🎛 Precise control. Intensity 0–100, 9 style profiles (web, chat, academic, marketing…), reproducible output, word-level diff of every change.
🆓 Free and open source (MIT). Built on the open TextHumanize library.

HOW TO USE

1. Select text on any page → click the ✨ bubble or right-click → TextHumanize.
2. Review the before/after AI score and the result in the floating panel.
3. Replace on page or copy. Use the toolbar popup or the full-page workspace for long texts.

Shortcuts: Ctrl/Cmd+Shift+H — humanize selection · Ctrl/Cmd+Shift+U — check selection.

HONEST NOTE

TextHumanize is a style-normalization tool, not an "AI detector bypass". It reduces AI-like patterns and reports its own internal score honestly — when it can't improve a text, it says so instead of making things worse. Results of external AI detectors are not guaranteed.

Made by Alexandr Krikun. Powered by the TextHumanize library (github.com/ksanyok/TextHumanize) — 240K+ lines, 38-stage pipeline, 2,269 tests. The extension is completely free; commercial licensing of the library for business integrations is available separately.
```

## Detailed description — RU

```
TextHumanize встраивает полноценный офлайн-движок натурализации текста прямо в браузер. Выделите текст на любой странице и мгновенно:

✨ ГУМАНИЗАЦИЯ — снижение ИИ-признаков стиля: шаблонных связок («Кроме того», «Более того»), канцелярита, однородного ритма предложений. Замена текста прямо на странице (поля ввода, textarea, редакторы) или копирование результата.

🔍 ПРОВЕРКА — честный ИИ-скор (0–100%) от статистического детектора с 15 метриками: неравномерность длины предложений, энтропия, плотность ИИ-паттернов, пассивный залог, ритм, перплексия и другие — с расшифровкой основных сигналов.

🧹 ОЧИСТКА — удаление скрытых меток: невидимых символов нулевой ширины, Unicode-стеганографии, гомоглифов (кириллическая «о» в латинских словах), паттернов пробелов. Включён статистический тест водяных знаков (метод Кирхенбауэра).

ПОЧЕМУ TEXTHUMANIZE

🔒 100% офлайн и приватно. Текст НИКОГДА не покидает браузер: без серверов, аккаунтов, аналитики и сетевых запросов. Код открыт — проверьте сами.
⚡ Быстро. 20–300 мс на абзац. Чистые алгоритмы, без скачивания моделей.
🌍 25 языков. Полные словари для русского, украинского, английского, немецкого, французского, испанского, польского, итальянского, португальского и ещё 16, автоопределение языка. Интерфейс на 10 языках.
🎛 Точный контроль. Интенсивность 0–100, 9 стилевых профилей, воспроизводимый результат, пословный diff всех изменений.
🆓 Бесплатно и с открытым кодом (MIT). Построено на открытой библиотеке TextHumanize.

КАК ПОЛЬЗОВАТЬСЯ

1. Выделите текст на странице → кнопка ✨ или правый клик → TextHumanize.
2. Оцените ИИ-скор «до/после» и результат в плавающей панели.
3. Замените на странице или скопируйте. Для длинных текстов — попап или полноэкранная рабочая область.

Горячие клавиши: Ctrl/Cmd+Shift+H — гуманизировать выделенное · Ctrl/Cmd+Shift+U — проверить выделенное.

ЧЕСТНОЕ ЗАМЕЧАНИЕ

TextHumanize — инструмент нормализации стиля, а не «обхода детекторов ИИ». Он снижает ИИ-паттерны и честно показывает собственный скор: если текст улучшить нельзя, он так и скажет. Результаты внешних ИИ-детекторов не гарантируются.

Автор: Alexandr Krikun. Работает на библиотеке TextHumanize (github.com/ksanyok/TextHumanize) — 240 тыс.+ строк, 38-стадийный пайплайн, 2 269 тестов. Расширение полностью бесплатно; коммерческая лицензия библиотеки для бизнес-интеграций доступна отдельно.
```

## Single purpose (for review)

```
Local, offline text processing of user-selected text: style naturalization, AI-style scoring and hidden-watermark removal. All processing happens on-device; the extension makes no network requests.
```

## Permission justifications

- **contextMenus** — provides the right-click "Humanize / Check / Clean selection" actions, the extension's primary entry point.
- **storage** — stores user settings (intensity, profile, UI language options). No text is stored.
- **activeTab** — lets the toolbar/context-menu action interact with the tab the user invoked it on.
- **scripting** — re-injects the panel content script into tabs that were already open before installation, only when the user invokes the extension there.
- **Host access (content script on all sites)** — the selection bubble and floating panel must be available on any page where the user selects text. The script reads only the user's selection when the user explicitly triggers an action; it never scrapes pages or sends data anywhere (there is no network code in the extension).

## Privacy

- Privacy policy URL: `https://github.com/ksanyok/texthumanize-extension/blob/main/PRIVACY.md`
- Data collection: **none**.

## Assets

- Icon 128×128: `icons/icon128.png`
- Store icon 440×440 (if requested): `store/store-icon440.png`
- Screenshots 1280×800: `store/screenshot-1-popup.png`, `store/screenshot-2-panel.png`, `store/screenshot-3-check.png`, `store/screenshot-4-options.png`
