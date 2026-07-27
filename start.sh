#!/usr/bin/env bash
# Local dashboard: ensure UI deps + Air live-reload.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="$(go env GOPATH)/bin:/usr/local/go/bin:${PATH:-}"
export PORT="${PORT:-8484}"
export FIREWIFI_BASE="${FIREWIFI_BASE:-$ROOT/.devdata}"
export CGO_ENABLED="${CGO_ENABLED:-0}"

mkdir -p "$FIREWIFI_BASE" tmp

if ! command -v air >/dev/null 2>&1; then
  echo "==> installing air"
  go install github.com/air-verse/air@latest
fi

if [[ ! -f internal/server/web/dist/index.html ]]; then
  "$ROOT/scripts/build-ui.sh"
fi

echo "==> FireWifi dashboard (dev)"
echo "    app    http://localhost:${PORT}"
echo "    reload http://localhost:8490  (Air proxy · auto browser refresh)"
echo "    data   ${FIREWIFI_BASE}"
echo "    ui     web-ui/src → rebuild on change"
echo "    prod   ./scripts/prod.sh"
echo "    stop   Ctrl+C"
echo

exec air -c .air.toml
