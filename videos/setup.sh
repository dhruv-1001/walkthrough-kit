#!/usr/bin/env bash
# One-time setup: Playwright (Node) and the voice (Python: Kokoro TTS, faster-whisper, openpyxl).
set -euo pipefail
cd "$(dirname "$0")"
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing: sudo apt install ffmpeg  (macOS: brew install ffmpeg)"; exit 1; }
npm ci --no-audit --no-fund
npx playwright install chromium
./setup-voice.sh
echo "Ready. Try:  ./redo.sh --project examples/demo   (with the demo app running)"
