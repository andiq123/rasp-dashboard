#!/usr/bin/env bash
# Pi entrypoint: sync to remote → clean UI + Go rebuild → restart service.
#
# From the dashboard checkout on the Pi:
#   ./scripts/update.sh
#
# Always:
#   1. fetch + hard-reset to upstream (drops local build dirt / stale tracked files)
#   2. clean pack of web-ui into embed dist (fresh npm ci + wipe dist)
#   3. rebuild Go binary atomically and restart firewifi-dashboard.service
#
# Env (optional):
#   FIREWIFI_BIN            binary path (default: $HOME/apps/firewifi-dashboard)
#   FIREWIFI_SKIP_RESTART=1 build only (passed through to prod.sh)
#   FIREWIFI_SKIP_PULL=1    skip git sync (still does a clean rebuild)
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
export FIREWIFI_CLEAN=1

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing required command: $1" >&2
    exit 1
  fi
}

need_cmd git
need_cmd go
need_cmd node
need_cmd npm

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

  echo "==> git fetch --prune"
  before="$(git rev-parse --short HEAD)"
  git fetch --prune origin

  upstream="$(git rev-parse --abbrev-ref '@{u}')"
  echo "==> reset --hard $upstream (override local/stale checkout)"
  git reset --hard '@{u}'
  # Leftover hashed Vite assets not in git must not be embedded.
  rm -rf internal/server/web/dist
  mkdir -p internal/server/web/dist

  after="$(git rev-parse --short HEAD)"
  if [[ "$before" == "$after" ]]; then
    echo "==> already at $after"
  else
    echo "==> $before → $after"
  fi
fi

exec "$ROOT/scripts/prod.sh"
