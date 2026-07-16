#!/usr/bin/env bash
# Build the Chrome Web Store zip. Run from the repo root:  bash scripts/package.sh
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="dist/texthumanize-extension-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  engine \
  data \
  content \
  popup \
  options \
  icons \
  _locales \
  -x "engine/*.test.mjs" -x "*/.DS_Store" -x ".DS_Store" \
  > /dev/null

echo "Built $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
unzip -l "$OUT" | tail -3
