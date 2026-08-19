#!/bin/sh
# Build the showcase data dir for the demo image from a real data dir:
#   demo/prepare.sh [SRC_DATA_DIR=server/data] [DEST=demo/data]
# Copies finished WAV tracks + a library.json trimmed to them (no settings, no templates).
set -eu
SRC=${1:-server/data}
DEST=${2:-demo/data}
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
rm -rf "$DEST" && mkdir -p "$DEST/tracks"
jq '[.[] | select(.status == "done" and .file != null and (.file | endswith(".wav"))) | .stream = false | .renderedSeconds = null]' "$SRC/library.json" > "$DEST/library.json"
jq -r '.[].file' "$DEST/library.json" | while read -r f; do cp "$SRC/tracks/$f" "$DEST/tracks/$f"; done
echo "$(jq length "$DEST/library.json") tracks, $(du -sh "$DEST/tracks" | cut -f1) → $DEST"
