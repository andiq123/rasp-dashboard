#!/usr/bin/env bash
# Pi entrypoint: sync checkout → rebuild only what changed → restart.
#
# From the dashboard checkout on the Pi:
#   ./scripts/update.sh
#
# Dependency and compiler caches are preserved. An already-current Pi exits fast.
#
# Env (optional):
#   FIREWIFI_BIN            binary path (default: $HOME/apps/firewifi-dashboard)
#   FIREWIFI_SKIP_RESTART=1 build only (passed through to prod.sh)
#   FIREWIFI_SKIP_PULL=1    skip git sync
#   FIREWIFI_FORCE=1        rebuild even when the checkout is current
#   FIREWIFI_CLEAN=1        force npm ci and clear UI caches
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Non-interactive shells (ssh, timers) often miss nvm / Go.
if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.nvm/nvm.sh"
  nvm use default >/dev/null 2>&1 || true
fi
export PATH="/usr/local/go/bin:${HOME}/go/bin:${PATH:-}"
export FIREWIFI_BIN="${FIREWIFI_BIN:-$HOME/apps/firewifi-dashboard}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing required command: $1" >&2
    exit 1
  fi
}

need_cmd git

if [[ ! -d .git ]]; then
  echo "error: $ROOT is not a git checkout" >&2
  exit 1
fi

if [[ "${FIREWIFI_SKIP_PULL:-}" != "1" ]]; then
  if ! git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    echo "error: no upstream branch — set tracking (e.g. git push -u origin main)" >&2
    exit 1
  fi

  ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  if [[ "$ahead" != "0" ]]; then
    echo "error: local commits not on remote ($ahead ahead) — push or drop them before update" >&2
    git log --oneline '@{u}..HEAD' >&2
    exit 1
  fi

  dirty_runtime="$(git diff --name-only -- main.go go.mod internal web-ui || true)"
  echo "==> git fetch --prune"
  before="$(git rev-parse --short HEAD)"
  git fetch --prune origin

  upstream="$(git rev-parse --abbrev-ref '@{u}')"
  echo "==> reset --hard $upstream (override local/stale checkout)"
  git reset --hard '@{u}'
  # Remove only obsolete generated UI assets; Vite hashes filenames per build.
  git clean -fd internal/server/web/dist >/dev/null
  after="$(git rev-parse --short HEAD)"
  if [[ "$before" == "$after" ]]; then
    echo "==> already at $after"
  else
    echo "==> $before → $after"
  fi

  if [[ "${FIREWIFI_FORCE:-}" != "1" && "$before" == "$after" && -z "$dirty_runtime" \
    && -x "$FIREWIFI_BIN" && -f internal/server/web/dist/index.html ]]; then
    unit="firewifi-dashboard.service"
    if systemctl --user cat "$unit" >/dev/null 2>&1 && ! systemctl --user is-active --quiet "$unit"; then
      echo "==> code current; restart inactive $unit"
      systemctl --user restart "$unit"
      systemctl --user is-active "$unit"
    else
      echo "==> code, UI, and binary already current"
    fi
    exit 0
  fi
fi

need_cmd go
need_cmd node
need_cmd npm

exec "$ROOT/scripts/prod.sh"
