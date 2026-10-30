#!/usr/bin/env bash
# One-time setup: Playwright (Node) and the local voice (Python: Kokoro TTS, faster-whisper, openpyxl).
#   ./setup.sh               everything (~5 min, ~2 GB for the voice)
#   ./setup.sh --no-voice    skip the local voice: for captions only, or a TTS API voice (--tts openai)
set -euo pipefail
cd "$(dirname "$0")"
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing: sudo apt install ffmpeg  (macOS: brew install ffmpeg)"; exit 1; }
npm ci --no-audit --no-fund
npx playwright install chromium
if [ "${1:-}" = "--no-voice" ]; then
  echo "Skipped the local voice. Use a TTS API (./redo.sh ... --tts openai) or --no-voice; ./setup-voice.sh adds it later."
else
  ./setup-voice.sh
fi
echo "Ready. Try:  ./redo.sh --project examples/saucedemo   (a public site: nothing to start)"
