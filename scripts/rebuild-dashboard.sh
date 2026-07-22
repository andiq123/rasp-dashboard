#!/usr/bin/env bash
# Production rebuild + restart of FireWifi dashboard.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${FIREWIFI_BIN:-$HOME/apps/firewifi-dashboard}"
export PATH="/usr/local/go/bin:${PATH:-}"
export CGO_ENABLED=0
export GOFLAGS="${GOFLAGS:-}"

cd "$ROOT"
echo "==> generate web assets"
go generate ./internal/server/web

echo "==> production build → $OUT"
go build -trimpath -ldflags="-s -w" -buildvcs=false -o "$OUT" .

echo "==> restart firewifi-dashboard.service"
systemctl --user restart firewifi-dashboard.service
systemctl --user is-active firewifi-dashboard.service
echo "==> ok · $(wc -c < "$OUT") bytes"
