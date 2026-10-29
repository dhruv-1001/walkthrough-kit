#!/usr/bin/env bash
# Starts the Brightdesk demo app, captures its screenshots, records its videos, stops it.
#   ./demo.sh               both tools
#   ./demo.sh screenshots   just one of them (or: videos)
set -euo pipefail
cd "$(dirname "$0")"
what="${1:-all}"
url=http://127.0.0.1:4173
started=
if ! curl -fs "$url/api/health" >/dev/null 2>&1; then
  node demo-app/server.mjs >/dev/null 2>&1 &
  started=$!
  trap '[ -n "$started" ] && kill "$started"' EXIT
  for _ in $(seq 30); do curl -fs "$url/api/health" >/dev/null 2>&1 && break; sleep 0.3; done
fi
curl -fs -X POST "$url/api/reset" >/dev/null
if [[ $what == all || $what == screenshots ]]; then
  echo "== screenshots"; screenshots/shots run examples/demo/plan.yaml
fi
if [[ $what == all || $what == videos ]]; then
  echo "== videos"; videos/redo.sh --project examples/demo
fi
echo
echo "Screenshots: screenshots/examples/demo/out/index.html  (gallery.html, walkthrough.md)"
echo "Videos:      videos/examples/demo/out/latest/"
