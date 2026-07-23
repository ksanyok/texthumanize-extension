#!/usr/bin/env python3
"""Build a Firefox-compatible package from the Chrome extension.

Firefox MV3 differs from Chrome in two ways this extension cares about:
  * background: Chrome uses `service_worker`; Firefox uses `background.scripts`
    (module) — Firefox ignores service_worker.
  * it requires `browser_specific_settings.gecko.id`.

Everything else (chrome.* with callbacks, action, storage, i18n, contextMenus,
scripting, OffscreenCanvas) works under both. host_permissions are treated as
optional in Firefox — the user grants them from the add-on permissions UI.

Run from the repo root:  python3 scripts/build_firefox.py
NOTE: this has NOT been run in Firefox yet — smoke-test with `web-ext run`.
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GECKO_ID = "texthumanize@ksanyok.github.io"

# Same payload as scripts/package.sh.
INCLUDE_DIRS = ["engine", "data", "content", "popup", "options", "icons", "_locales"]
INCLUDE_FILES = ["background.js"]
EXCLUDE_SUFFIX = (".test.mjs", ".DS_Store")


def firefox_manifest() -> dict:
    m = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    # Firefox MV3 background = module scripts (service_worker is Chrome-only).
    m["background"] = {"scripts": ["background.js"], "type": "module"}
    m["browser_specific_settings"] = {
        "gecko": {"id": GECKO_ID, "strict_min_version": "128.0"}
    }
    return m


def iter_files():
    for f in INCLUDE_FILES:
        p = ROOT / f
        if p.exists():
            yield p, f
    for d in INCLUDE_DIRS:
        base = ROOT / d
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file() and not p.name.endswith(EXCLUDE_SUFFIX):
                yield p, str(p.relative_to(ROOT))


def main() -> None:
    manifest = firefox_manifest()
    version = manifest["version"]
    out = ROOT / "dist" / f"texthumanize-firefox-{version}.zip"
    out.parent.mkdir(exist_ok=True)
    out.unlink(missing_ok=True)

    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for path, arc in iter_files():
            z.write(path, arc)
            n += 1
    size = out.stat().st_size // 1024
    print(f"Built {out.relative_to(ROOT)} ({size}K, {n + 1} files)")
    print("Firefox background =", manifest["background"])
    print("⚠ Not yet tested in Firefox — run `web-ext run` / `web-ext lint` before submitting.")


if __name__ == "__main__":
    main()
