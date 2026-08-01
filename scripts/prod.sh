#!/usr/bin/env bash
# Production: incremental UI → optimized embedded binary → restart if changed.
#
# On the Pi after git pull:
#   ./scripts/prod.sh
#
# Prefer ./scripts/update.sh on the Pi (sync + incremental rebuild + restart).
#
# Env:
#   FIREWIFI_BIN            output binary (default: $HOME/apps/firewifi-dashboard)
#   FIREWIFI_SKIP_RESTART=1 build only, do not touch systemd
#   FIREWIFI_CLEAN=1        force clean npm/UI build
#   FIREWIFI_FORCE=1        rebuild binary even when inputs are current
#   FIREWIFI_BUILD_JOBS=N   Go compiler parallelism (auto-sized on Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${FIREWIFI_BIN:-$HOME/apps/firewifi-dashboard}"
export PATH="$(go env GOPATH 2>/dev/null)/bin:/usr/local/go/bin:${PATH:-}"
export CGO_ENABLED="${CGO_ENABLED:-0}"

mkdir -p "$(dirname "$OUT")"

echo "==> FireWifi production build"
"$ROOT/scripts/build-ui.sh"

binary_current=0
if [[ "${FIREWIFI_FORCE:-}" != "1" && -x "$OUT" ]]; then
  if [[ -z "$(find main.go go.mod internal/server/web/dist internal \
    -type f \( -name '*.go' -o -name 'go.mod' -o -path '*/web/dist/*' \) \
    -newer "$OUT" -print -quit 2>/dev/null)" ]]; then
    binary_current=1
  fi
fi

UNIT="firewifi-dashboard.service"
if [[ "$binary_current" -eq 1 ]]; then
  echo "==> binary already current"
  if [[ "${FIREWIFI_SKIP_RESTART:-}" == "1" ]]; then
    exit 0
  fi
  if systemctl --user cat "$UNIT" >/dev/null 2>&1 && ! systemctl --user is-active --quiet "$UNIT"; then
    echo "==> start inactive $UNIT"
    systemctl --user restart "$UNIT"
    systemctl --user is-active "$UNIT"
  fi
  exit 0
fi

tmp="$(mktemp "${OUT}.XXXXXX")"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

echo "==> go build → $OUT (atomic)"
build_jobs="${FIREWIFI_BUILD_JOBS:-}"
if [[ -z "$build_jobs" ]]; then
  build_jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)"
  if [[ -r /proc/meminfo ]]; then
    total_mb="$(awk '/MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)"
    if (( total_mb < 2000 && build_jobs > 2 )); then build_jobs=2; fi
  fi
fi
# Go's build cache handles unchanged packages; rebuilding with -a is costly on a Pi.
go build -p "$build_jobs" -trimpath -ldflags="-s -w" -buildvcs=false -o "$tmp" .
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
