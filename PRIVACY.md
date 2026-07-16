# Privacy Policy — TextHumanize for Chrome

**Effective date: 2026-07-16 · Version 2.0**

TextHumanize processes your **text entirely on your device**. Your text is
never sent anywhere. The only data that can ever leave your browser is
**anonymous, content-free usage counts** — and only if you leave that setting
on. Details below.

## Your text and content

- All text tools — humanize, AI-style check, watermark clean, tone,
  readability, paraphrase, style analysis — run **locally** inside the
  extension. Your text is **never transmitted** to us or anyone else.
- **Image AI-provenance checks** (optional, off by default): when enabled and
  you hover an image, the extension reads that image's bytes to inspect its
  metadata (C2PA / EXIF / generator signatures) **on your device**. The image
  is not uploaded anywhere. This feature needs permission to read images,
  which Chrome asks you to grant when you turn it on.

## Anonymous usage statistics

To understand which tools people find useful (so we can improve the right
things), the extension can record **anonymous, content-free** events:

- **What is recorded:** an anonymous random install identifier (not tied to
  you or your Google account), the name of the tool used (e.g. "humanize"),
  coarse non-identifying context (language code, result category, extension
  version) and a timestamp.
- **What is NEVER recorded or sent:** your text, the pages you visit, image
  contents, URLs, selections, or any personal data.
- **Where it goes:** counts are always kept **locally** so you can see your
  own usage in Settings. Nothing is transmitted off your device unless a
  collector endpoint has been configured by the developer **and** you have not
  turned the setting off.
- **Default:** on, and fully disclosed here and on first run. You can turn it
  **off** anytime in the extension's Settings ("Anonymous usage stats").

We also rely on the **Chrome Web Store's** own aggregate statistics (install
counts, active users, versions, countries), which Google provides to every
developer and which contain no personal data.

## What is stored

- Your **settings** (intensity, profile, toggles) via `chrome.storage.sync`.
- An **anonymous install id** and **local usage counts** via
  `chrome.storage.local` (never leave the device on their own).
- Processed text is **never** persisted.

## Permissions

| Permission | Why |
|---|---|
| `contextMenus` | Right-click "Humanize / Check / Tone / Clean" actions. |
| `storage` | Saving your settings and local usage counts. |
| `activeTab`, `scripting` | Running the panel in the tab you invoke it on. |
| Content script on all sites | The selection bubble, editor chip and image badge appear where you work. They read a selection or image only when **you** trigger an action. |
| `<all_urls>` host access (optional) | Requested **only** if you enable image AI-provenance checks, so the extension can read image bytes to inspect metadata. Not requested otherwise. |
| `clipboardWrite` (optional) | Copying results to your clipboard. |

## Third parties

No data is shared with third parties. If, in a future version, anonymous
usage events are sent to an analytics endpoint, that endpoint and its provider
will be named here, and the off switch will continue to apply.

## Contact

Alexandr Krikun — [github.com/ksanyok](https://github.com/ksanyok) ·
[Issues](https://github.com/ksanyok/texthumanize-extension/issues)
