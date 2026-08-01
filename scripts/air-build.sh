#!/usr/bin/env bash
# Air build: Vite UI → embed dist (when stale), then Go binary.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$(go env GOPATH 2>/dev/null)/bin:/usr/local/go/bin:${PATH:-}"
export CGO_ENABLED="${CGO_ENABLED:-0}"

"$ROOT/scripts/build-ui.sh"

echo "==> go build"
go build -buildvcs=false -o ./tmp/firewifi-dashboard .
