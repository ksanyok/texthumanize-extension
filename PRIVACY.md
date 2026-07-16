# Privacy Policy — TextHumanize for Chrome

**Effective date: 2026-07-16**

TextHumanize for Chrome processes text **entirely on your device**.

## What we collect

**Nothing.** The extension:

- makes **no network requests** — all processing (humanization, AI-style
  analysis, watermark cleaning, language detection) runs locally inside the
  extension's service worker;
- has **no analytics, telemetry, or tracking** of any kind;
- sends your text to **no server** — ours or anyone else's;
- requires **no account**.

## What is stored

Only your settings (intensity, profile, language mode, UI toggles) are stored
via `chrome.storage.sync`, so they can follow your Chrome profile. Settings
contain no personal data and no processed text. Text you process is never
persisted by the extension.

## Permissions explained

| Permission | Why it is needed |
|---|---|
| `contextMenus` | The right-click "Humanize / Check / Clean selection" items. |
| `storage` | Saving your settings. |
| `activeTab` / `scripting` | Re-injecting the panel into a tab that was open before the extension was installed, when you invoke it there. |
| Content script on all sites | Showing the selection bubble and floating panel where you select text. It only reads a selection when **you** trigger an action; it does not scrape or monitor pages. |

## Third parties

None. No data is shared because no data is collected.

## Contact

Alexandr Krikun — [github.com/ksanyok](https://github.com/ksanyok) ·
[Issues](https://github.com/ksanyok/texthumanize-extension/issues)
