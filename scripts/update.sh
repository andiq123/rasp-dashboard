#!/usr/bin/env bash
# One-command Pi update: sync → reload this script → build → restart.
#
# From the dashboard checkout on the Pi:
#   ./scripts/update.sh
#
# The script re-executes itself after Git sync, so newly pulled updater logic is
# used immediately. Dependency/compiler caches are preserved for fast Pi builds.
#
# Env (optional):
#   FIREWIFI_BIN            binary path (default: $HOME/apps/firewifi-dashboard)
#   FIREWIFI_SKIP_RESTART=1 build only (passed through to prod.sh)
#   FIREWIFI_SKIP_PULL=1    skip git sync
#   FIREWIFI_FORCE=1        rebuild even when the checkout is current
#   FIREWIFI_CLEAN=1        force npm ci and clear UI caches
#   FIREWIFI_POST_SYNC=1    internal re-exec guard; do not set manually
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

if [[ "${FIREWIFI_SKIP_PULL:-}" != "1" && "${FIREWIFI_POST_SYNC:-}" != "1" ]]; then
  echo "==> [1/4] Sync repository"
  if ! git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    echo "error: no upstream branch — set tracking (e.g. git push -u origin main)" >&2
    exit 1
  fi

  upstream="$(git rev-parse --abbrev-ref '@{u}')"
  remote="${upstream%%/*}"
  before="$(git rev-parse --short HEAD)"
  echo "    fetch $remote"
  git fetch --prune "$remote"

  ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  if [[ "$ahead" != "0" ]]; then
    echo "error: local commits not on remote ($ahead ahead) — push or drop them before update" >&2
    git log --oneline '@{u}..HEAD' >&2
    exit 1
  fi

  echo "    reset to $upstream"
  git reset --hard '@{u}'
  # Remove only obsolete generated UI assets; Vite hashes filenames per build.
  git clean -fd internal/server/web/dist >/dev/null
  after="$(git rev-parse --short HEAD)"
  if [[ "$before" == "$after" ]]; then
    echo "    already current · $after"
  else
    echo "    updated · $before → $after"
  fi

  echo "==> [2/4] Reload updater"
  exec env FIREWIFI_POST_SYNC=1 "$ROOT/scripts/update.sh" "$@"
fi

echo "==> [3/4] Verify toolchain"
need_cmd go
need_cmd node
need_cmd npm

echo "    $(go version)"
echo "    node $(node --version) · npm $(npm --version)"

echo "==> [4/4] Build and activate dashboard"
"$ROOT/scripts/prod.sh"

commit="$(git rev-parse --short HEAD)"
if [[ "${FIREWIFI_SKIP_RESTART:-}" == "1" ]]; then
  echo "==> complete · $commit built (restart skipped)"
else
  echo "==> complete · $commit is installed"
  echo "    refresh the dashboard to load the latest UI"
fi
