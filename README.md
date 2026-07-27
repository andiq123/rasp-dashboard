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
cd web-ui && npm run dev
```

## Production (Pi) — get latest + rebuild

One command on the Pi pulls `main`, packs the **latest** frontend into the binary, and restarts the service:

```bash
cd ~/sources/dashboard
./scripts/update.sh
```

That always:

1. `git pull --ff-only` (fails if tracked files are dirty)
2. `npm ci` when lockfile changed
3. Builds Vite → `internal/server/web/dist` (`go generate`)
4. Builds a trimmed Go binary with that UI **embedded**
5. Restarts `firewifi-dashboard.service` (user unit) if present

```bash
# rebuild current checkout only (no pull)
FIREWIFI_SKIP_PULL=1 ./scripts/update.sh

# build only (no systemd)
FIREWIFI_SKIP_RESTART=1 ./scripts/update.sh

# custom binary path
FIREWIFI_BIN=/usr/local/bin/firewifi-dashboard ./scripts/update.sh
```

`./scripts/prod.sh` is the build+restart step only (no git pull).  
`./scripts/rebuild-dashboard.sh` aliases `prod.sh`.

**Important:** the UI is compile-time embedded. `git pull` alone does not update a running binary — run `./scripts/update.sh` (or `prod.sh` after pull).

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
| `FIREWIFI_SKIP_PULL=1` | `update.sh` skips `git pull` |

## Layout

- `main.go` — entrypoint (graceful shutdown)
- `web-ui/` — React 19 + TypeScript + Tailwind/daisyUI (Vite)
- `internal/deploy` — compose deploy manager
- `internal/server` — HTTP API + SSE
- `internal/server/web` — embeds Vite `dist/` + `go generate`
- `scripts/build-ui.sh` — reusable UI pack into embed dist
- `scripts/prod.sh` — production UI + binary + restart
- `scripts/update.sh` — `git pull` then `prod.sh` (Pi one-liner)
- `scripts/air-build.sh` — Air incremental build
- `start.sh` — local Air dev entrypoint

## Notes

- Edit UI under `web-ui/src/`; do not hand-edit `internal/server/web/dist/`.
- Feature UI: `web-ui/src/features/<name>/`; shared primitives: `web-ui/src/components/ui/`.
- Wi‑Fi password is never returned by `GET /api/config`; leave the password field blank to keep the stored value.
- Do not commit secrets, tokens, or host-specific `.env` files.
