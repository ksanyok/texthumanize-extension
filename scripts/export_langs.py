#!/usr/bin/env python3
"""Export TextHumanize language packs to JSON for the Chrome extension.

Reads the canonical dictionaries from the TextHumanize Python library
(the source of truth) and emits one JSON file per language plus an
index manifest. Run from the extension repo root:

    python3 scripts/export_langs.py --lib ../TextHumanize
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _jsonable(value):
    """Convert sets/tuples to sorted lists recursively."""
    if isinstance(value, set):
        return sorted(value)
    if isinstance(value, tuple):
        return [_jsonable(v) for v in value]
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    return value


# Fields the extension engine actually uses (keep bundle lean).
FIELDS = [
    "code", "name", "trigrams", "stop_words",
    "bureaucratic", "bureaucratic_phrases",
    "ai_connectors", "synonyms", "sentence_starters",
    "colloquial_markers", "abbreviations", "perplexity_boosters",
    "conjunctions", "split_conjunctions",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lib", default="../TextHumanize",
                        help="Path to the TextHumanize library repo")
    parser.add_argument("--out", default="data/langs",
                        help="Output directory for JSON packs")
    args = parser.parse_args()

    lib = Path(args.lib).resolve()
    sys.path.insert(0, str(lib))

    from texthumanize.lang import (  # noqa: E402
        LANGUAGES, TIER1_LANGUAGES, TIER2_LANGUAGES, TIER3_LANGUAGES,
    )
    from texthumanize import __version__  # noqa: E402

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    index = {"libraryVersion": __version__, "languages": {}}

    for code, pack in sorted(LANGUAGES.items()):
        slim = {k: _jsonable(pack[k]) for k in FIELDS if k in pack}
        dest = out / f"{code}.json"
        dest.write_text(
            json.dumps(slim, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        tier = 1 if code in TIER1_LANGUAGES else 2 if code in TIER2_LANGUAGES else 3
        index["languages"][code] = {
            "name": pack.get("name", code),
            "tier": tier,
            "bytes": dest.stat().st_size,
        }
        print(f"  {code}: {dest.stat().st_size:,} bytes (tier {tier})")

    (out / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8",
    )
    total = sum(v["bytes"] for v in index["languages"].values())
    print(f"Exported {len(index['languages'])} packs, {total/1024:.0f} KiB total "
          f"(library v{index['libraryVersion']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
