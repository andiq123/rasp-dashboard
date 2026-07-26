#!/usr/bin/env bash
# Local dashboard: generate assets + live-reload with Air.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="$(go env GOPATH)/bin:/usr/local/go/bin:${PATH:-}"
export PORT="${PORT:-8484}"
export FIREWIFI_BASE="${FIREWIFI_BASE:-$ROOT/.devdata}"

mkdir -p "$FIREWIFI_BASE" tmp

if ! command -v air >/dev/null 2>&1; then
  echo "==> installing air"
  go install github.com/air-verse/air@latest
fi

echo "==> FireWifi dashboard (dev)"
echo "    app    http://localhost:${PORT}"
echo "    reload http://localhost:8490  (Air proxy · auto browser refresh)"
echo "    data   ${FIREWIFI_BASE}"
echo "    stop   Ctrl+C"
echo

exec air -c .air.toml
