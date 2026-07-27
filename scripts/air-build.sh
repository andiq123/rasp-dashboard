#!/usr/bin/env bash
# Air build: Vite UI → embed dist, then Go binary.
# UI rebuild only when web-ui sources are newer than dist (avoids slow loops on Go-only edits).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$(go env GOPATH 2>/dev/null)/bin:/usr/local/go/bin:${PATH:-}"
export CGO_ENABLED="${CGO_ENABLED:-0}"

DIST_INDEX="internal/server/web/dist/index.html"
need_ui=0

if [[ ! -f "$DIST_INDEX" ]]; then
  need_ui=1
elif [[ -n "$(find web-ui/src web-ui/index.html web-ui/vite.config.ts web-ui/package.json \
  web-ui/tsconfig.json web-ui/tsconfig.app.json web-ui/tsconfig.node.json \
  -type f -newer "$DIST_INDEX" 2>/dev/null | head -n 1)" ]]; then
  need_ui=1
fi

if [[ "$need_ui" -eq 1 ]]; then
  echo "==> building web-ui"
  go generate ./internal/server/web
else
  echo "==> web-ui dist up to date"
fi

echo "==> go build"
go build -buildvcs=false -o ./tmp/firewifi-dashboard .
