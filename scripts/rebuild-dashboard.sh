#!/usr/bin/env bash
# Alias for Pi deploy — same as scripts/prod.sh.
exec "$(cd "$(dirname "$0")" && pwd)/prod.sh" "$@"
