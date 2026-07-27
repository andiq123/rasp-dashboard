#!/usr/bin/env bash
# Build the Vite UI into internal/server/web/dist for Go embed.
# Safe to call from Air (dev) or prod — always produces a fresh embed tree.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$(go env GOPATH 2>/dev/null)/bin:/usr/local/go/bin:${PATH:-}"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "error: node and npm are required to build web-ui" >&2
  exit 1
fi

LOCK="web-ui/package-lock.json"
STAMP="web-ui/node_modules/.package-lock.json"
need_ci=0
if [[ ! -d web-ui/node_modules ]]; then
  need_ci=1
elif [[ -f "$LOCK" && ( ! -f "$STAMP" || "$LOCK" -nt "$STAMP" ) ]]; then
  need_ci=1
fi

if [[ "$need_ci" -eq 1 ]]; then
  echo "==> npm ci (web-ui)"
  (cd web-ui && npm ci)
fi

echo "==> pack web-ui → internal/server/web/dist"
go generate ./internal/server/web
