#!/usr/bin/env bash
# One-time setup of .venv for narration (Kokoro), clip checks (faster-whisper)
# and the spreadsheets (openpyxl). CPU-only torch keeps it ~1.8 GB.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -q "kokoro>=0.9.4" soundfile faster-whisper openpyxl
# espeakng-loader's libespeak-ng looks for its data one directory up
# ("…/espeakng_loader/phontab"); link the data files there.
L=$(.venv/bin/python -c 'import espeakng_loader, os; print(os.path.dirname(espeakng_loader.__file__))')
for f in "$L"/espeak-ng-data/*; do ln -sfn "espeak-ng-data/$(basename "$f")" "$L/$(basename "$f")"; done
.venv/bin/python -c 'import misaki.espeak as e; e.EspeakFallback(british=False); print("voice setup OK")'
