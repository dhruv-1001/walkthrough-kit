#!/usr/bin/env bash
# Record a project's videos:  ./redo.sh --project examples/demo [--only 2] [--headed] [--lines] [--tts openai] ...
# (every option: node record.mjs --help). Videos land in <project>/out/latest/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[ -d "$here/node_modules/playwright" ] || (cd "$here" && npm ci --no-audit --no-fund)
exec node "$here/record.mjs" "$@"
