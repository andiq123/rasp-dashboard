# rasp-dashboard

FireWifi dashboard for Raspberry Pi — Go server with an embedded React web UI for managing Docker Compose deployments, live resource monitoring, files, and host settings.

## Requirements

- Go 1.26+ (see `go.mod`)
- Node.js 20+ (to build the UI)
- Docker (for managed compose services)
- Linux (designed for Raspberry Pi); local macOS/Linux works for UI/API development

## Develop (live reload)

```bash
./start.sh
```

Uses [Air](https://github.com/air-verse/air): watches `internal/` + `web-ui/src` (never `node_modules`), rebuilds the Vite UI when UI sources change, then rebuilds/restarts the Go binary.

- App: `http://localhost:8484` (`PORT` overrides)
- Browser auto-refresh: `http://localhost:8490` (Air proxy)
- Runtime data: `.devdata/` (`FIREWIFI_BASE` overrides)

UI-only Vite dev (proxies `/api` → `:8484`):

```bash
npm run dev
```

Root-level npm commands proxy to `web-ui/`. Run `npm run build`, `npm run typecheck`,
`npm run lint`, or `npm run check` directly from the checkout root.

## Production (Pi) — get latest + rebuild

One command on the Pi syncs to remote, reloads the newly pulled updater, incrementally builds what changed, and restarts when needed:

```bash
cd ~/sources/dashboard
./scripts/update.sh
```

The updater:

1. `git fetch` + `reset --hard` to upstream (overrides local/stale tracked files; refuses if you have unpushed commits)
2. Re-executes the newly downloaded `update.sh`, so updater changes apply immediately
3. Runs `npm ci` only when dependencies changed or are missing
4. Rebuilds the embedded UI only when its sources changed
5. Uses Go's build cache and atomically replaces `FIREWIFI_BIN`
6. Restarts and verifies `firewifi-dashboard.service` after a new binary is built

When the checkout, UI, binary, and service are already current, the command exits immediately. Node memory and Go compiler parallelism are capped automatically on low-memory Pis.

```bash
# rebuild current checkout only (no git sync)
FIREWIFI_SKIP_PULL=1 ./scripts/update.sh

# build only (no systemd)
FIREWIFI_SKIP_RESTART=1 ./scripts/update.sh

# custom binary path
FIREWIFI_BIN=/usr/local/bin/firewifi-dashboard ./scripts/update.sh

# deliberately discard caches and rebuild everything
FIREWIFI_CLEAN=1 FIREWIFI_FORCE=1 ./scripts/update.sh
```

`./scripts/prod.sh` is incremental build+restart only (no git sync).
`./scripts/rebuild-dashboard.sh` aliases `prod.sh`.

**Important:** the UI is compile-time embedded. `git pull` alone does not update a running binary — run `./scripts/update.sh`.

## Optional hardening

| Env | Purpose |
|-----|---------|
| `FIREWIFI_AUTH=user:pass` | HTTP Basic Auth for UI + APIs (hooks keep their own tokens) |
| `FIREWIFI_FILES_ROOT` | Files browser chroot (default: `$HOME`) |
| `FIREWIFI_BASE` | Config / token base directory |
| `HOME` | Deployments root (`$HOME/deployments`) and default paths |
| `PORT` | Listen port (default `8484`) |
| `FIREWIFI_BIN` | Production binary path for `prod.sh` / `update.sh` |
| `FIREWIFI_SKIP_RESTART=1` | `prod.sh` / `update.sh` builds only |
| `FIREWIFI_SKIP_PULL=1` | `update.sh` skips git sync |
| `FIREWIFI_CLEAN=1` | Force `npm ci` and wipe frontend build caches |
| `FIREWIFI_FORCE=1` | Force UI/binary rebuild even when inputs are current |
| `FIREWIFI_NODE_MEMORY_MB` | Override the automatically selected Node heap cap |
| `FIREWIFI_BUILD_JOBS` | Override Go compiler parallelism |

## Layout

- `main.go` — entrypoint (graceful shutdown)
- `web-ui/` — React 19 + TypeScript + Tailwind/daisyUI (Vite)
- `internal/deploy` — compose deploy manager
- `internal/server` — HTTP API + SSE
- `internal/server/web` — embeds Vite `dist/` + `go generate`
- `scripts/build-ui.sh` — reusable UI pack into embed dist
- `scripts/prod.sh` — production UI + binary + restart
- `scripts/update.sh` — upstream sync then `prod.sh` (Pi one-liner)
- `scripts/air-build.sh` — Air incremental build
- `start.sh` — local Air dev entrypoint

## Notes

- Edit UI under `web-ui/src/`; do not hand-edit `internal/server/web/dist/`.
- Feature UI: `web-ui/src/features/<name>/`; shared primitives: `web-ui/src/components/ui/`.
- Wi‑Fi password is never returned by `GET /api/config`; leave the password field blank to keep the stored value.
- Do not commit secrets, tokens, or host-specific `.env` files.
