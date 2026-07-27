#!/usr/bin/env bash
# Production: latest UI → embedded binary → restart (or print run hint).
#
# On the Pi after git pull:
#   ./scripts/prod.sh
#
# Prefer ./scripts/update.sh on the Pi (sync + clean rebuild + restart).
#
# Env:
#   FIREWIFI_BIN            output binary (default: $HOME/apps/firewifi-dashboard)
#   FIREWIFI_SKIP_RESTART=1 build only, do not touch systemd
#   FIREWIFI_CLEAN=1        force clean UI pack (default on for this script)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${FIREWIFI_BIN:-$HOME/apps/firewifi-dashboard}"
export PATH="$(go env GOPATH 2>/dev/null)/bin:/usr/local/go/bin:${PATH:-}"
export CGO_ENABLED="${CGO_ENABLED:-0}"
# Production builds should not reuse a stale embed tree.
export FIREWIFI_CLEAN="${FIREWIFI_CLEAN:-1}"

mkdir -p "$(dirname "$OUT")"

echo "==> FireWifi production build"
"$ROOT/scripts/build-ui.sh"

tmp="$(mktemp "${OUT}.XXXXXX")"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

echo "==> go build → $OUT (atomic)"
# Rebuild packages so //go:embed picks up the fresh dist tree.
go build -a -trimpath -ldflags="-s -w" -buildvcs=false -o "$tmp" .
chmod 755 "$tmp"
# Rename over a running binary is safe on Linux (old inode stays until restart).
mv -f "$tmp" "$OUT"
trap - EXIT

bytes="$(wc -c < "$OUT" | tr -d ' ')"
echo "==> binary $bytes bytes · $(go version | awk '{print $3}') · node $(node -v)"

if [[ "${FIREWIFI_SKIP_RESTART:-}" == "1" ]]; then
  echo "==> restart skipped"
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

echo "==> built $bytes bytes"
echo "    no user unit '$UNIT' — start with:"
echo "      $OUT"
