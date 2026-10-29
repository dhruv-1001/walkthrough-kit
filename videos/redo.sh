#!/usr/bin/env bash
# Record a project's videos:  ./redo.sh --project examples/demo [--only 2] [--headed] [--lines] ...
# (every option: node record.mjs --help). Videos land in <project>/out/latest/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[ -d "$here/node_modules/playwright" ] || (cd "$here" && npm ci --no-audit --no-fund)
py="${WALKTHROUGH_PYTHON:-$here/.venv/bin/python}"
if [ ! -x "$py" ] && [[ " $* " != *" --no-voice "* && " $* " != *" --lines "* ]]; then
  echo "No voice environment yet: run $here/setup.sh (or pass --no-voice)"; exit 1
fi
exec node "$here/record.mjs" "$@"
