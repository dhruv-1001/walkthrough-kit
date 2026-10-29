#!/usr/bin/env bash
# One-time setup: a Python environment with Playwright, playwright-scraper and PyYAML, plus Chromium.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python -m playwright install chromium
echo "Ready. Try:  ./shots run examples/demo/plan.yaml   (with the demo app running)"
