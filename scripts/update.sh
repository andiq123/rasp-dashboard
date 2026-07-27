#!/usr/bin/env bash
# Pi entrypoint: pull latest → pack UI → rebuild binary → restart service.
#
# From the dashboard checkout on the Pi:
#   ./scripts/update.sh
#
# Env (optional):
#   FIREWIFI_BIN            binary path (default: $HOME/apps/firewifi-dashboard)
#   FIREWIFI_SKIP_RESTART=1 build only (passed through to prod.sh)
#   FIREWIFI_SKIP_PULL=1    skip git pull (rebuild current checkout)
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

if [[ ! -d .git ]]; then
  echo "error: $ROOT is not a git checkout" >&2
  exit 1
fi

if [[ "${FIREWIFI_SKIP_PULL:-}" != "1" ]]; then
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "error: tracked changes present — commit or stash before update" >&2
    git status -sb >&2
    exit 1
  fi
  echo "==> git pull --ff-only"
  before="$(git rev-parse --short HEAD)"
  git pull --ff-only
  after="$(git rev-parse --short HEAD)"
  if [[ "$before" == "$after" ]]; then
    echo "==> already at $after"
  else
    echo "==> $before → $after"
  fi
fi

exec "$ROOT/scripts/prod.sh"
