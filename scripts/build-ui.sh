#!/usr/bin/env bash
# Build the Vite UI into internal/server/web/dist for Go embed.
# Safe to call from Air or production; returns immediately when current.
#
# Env:
#   FIREWIFI_CLEAN=1           force npm ci and a cache-free build
#   FIREWIFI_NODE_MEMORY_MB=N  cap Node heap (auto-sized on Linux)
#   FIREWIFI_FORCE_UI=1        rebuild even when dist is current
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
DIST_INDEX="internal/server/web/dist/index.html"
need_ci=0

# Keep Node from pressuring swap on small Pis while leaving enough room for Vite.
if [[ -z "${NODE_OPTIONS:-}" ]]; then
  node_heap_mb="${FIREWIFI_NODE_MEMORY_MB:-768}"
  if [[ -z "${FIREWIFI_NODE_MEMORY_MB:-}" && -r /proc/meminfo ]]; then
    total_mb="$(awk '/MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
    if (( total_mb < 1500 )); then
      node_heap_mb=512
    elif (( total_mb >= 3000 )); then
      node_heap_mb=1024
    fi
  fi
  export NODE_OPTIONS="--max-old-space-size=${node_heap_mb}"
fi

if [[ "${FIREWIFI_CLEAN:-}" == "1" ]]; then
  need_ci=1
  echo "==> clean UI caches"
  rm -rf \
    internal/server/web/dist \
    web-ui/node_modules/.vite \
    web-ui/node_modules/.tmp \
    web-ui/dist
  mkdir -p internal/server/web/dist
elif [[ ! -d web-ui/node_modules || ! -x web-ui/node_modules/.bin/vite ]]; then
  need_ci=1
elif [[ -f "$LOCK" && ( ! -f "$STAMP" || "$LOCK" -nt "$STAMP" || web-ui/package.json -nt "$STAMP" ) ]]; then
  need_ci=1
fi

if [[ "$need_ci" -eq 1 ]]; then
  echo "==> npm ci (web-ui)"
  npm --prefix web-ui ci --no-audit --no-fund --prefer-offline
fi

if [[ "${FIREWIFI_FORCE_UI:-}" != "1" && "${FIREWIFI_CLEAN:-}" != "1" && -f "$DIST_INDEX" ]]; then
  if [[ -z "$(find web-ui/src web-ui/index.html web-ui/vite.config.ts web-ui/package.json \
    web-ui/package-lock.json web-ui/tsconfig.json web-ui/tsconfig.app.json web-ui/tsconfig.node.json \
    -type f -newer "$DIST_INDEX" -print -quit 2>/dev/null)" ]]; then
    echo "==> web-ui already current"
    exit 0
  fi
fi

echo "==> pack web-ui → internal/server/web/dist"
npm --prefix web-ui run build

if [[ ! -f internal/server/web/dist/index.html ]]; then
  echo "error: embed dist missing index.html after UI pack" >&2
  exit 1
fi
