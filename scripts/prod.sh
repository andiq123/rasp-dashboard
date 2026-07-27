#!/usr/bin/env bash
# Production: latest UI → embedded binary → restart (or print run hint).
#
# On the Pi after git pull:
#   ./scripts/prod.sh
#
# Env:
#   FIREWIFI_BIN   output binary (default: $HOME/apps/firewifi-dashboard)
#   FIREWIFI_SKIP_RESTART=1  build only, do not touch systemd
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${FIREWIFI_BIN:-$HOME/apps/firewifi-dashboard}"
export PATH="$(go env GOPATH 2>/dev/null)/bin:/usr/local/go/bin:${PATH:-}"
export CGO_ENABLED="${CGO_ENABLED:-0}"

mkdir -p "$(dirname "$OUT")"

echo "==> FireWifi production build"
"$ROOT/scripts/build-ui.sh"

echo "==> go build → $OUT"
go build -trimpath -ldflags="-s -w" -buildvcs=false -o "$OUT" .

if [[ "${FIREWIFI_SKIP_RESTART:-}" == "1" ]]; then
  echo "==> built $(wc -c < "$OUT" | tr -d ' ') bytes · restart skipped"
  exit 0
fi

UNIT="firewifi-dashboard.service"
if systemctl --user cat "$UNIT" >/dev/null 2>&1; then
  echo "==> restart $UNIT"
  systemctl --user restart "$UNIT"
  systemctl --user is-active "$UNIT"
  echo "==> ok · serving embedded UI from $OUT"
  exit 0
fi

echo "==> built $(wc -c < "$OUT" | tr -d ' ') bytes"
echo "    no user unit '$UNIT' — start with:"
echo "      $OUT"
