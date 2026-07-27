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

## Production (Pi) — after `git pull`

One command packs the **latest** frontend into the binary and restarts the service:

```bash
./scripts/prod.sh
```

That always:

1. `npm ci` when lockfile changed
2. Builds Vite → `internal/server/web/dist` (`go generate`)
3. Builds a trimmed Go binary with that UI **embedded**
4. Restarts `firewifi-dashboard.service` (user unit) if present

```bash
# build only (no systemd)
FIREWIFI_SKIP_RESTART=1 ./scripts/prod.sh

# custom binary path
FIREWIFI_BIN=/usr/local/bin/firewifi-dashboard ./scripts/prod.sh
```

`./scripts/rebuild-dashboard.sh` is the same entrypoint (alias).

**Important:** the UI is compile-time embedded. `git pull` alone does not update a running binary — run `./scripts/prod.sh` after pull.

## Optional hardening

| Env | Purpose |
|-----|---------|
| `FIREWIFI_AUTH=user:pass` | HTTP Basic Auth for UI + APIs (hooks keep their own tokens) |
| `FIREWIFI_FILES_ROOT` | Files browser chroot (default: `$HOME`) |
| `FIREWIFI_BASE` | Config / token base directory |
| `HOME` | Deployments root (`$HOME/deployments`) and default paths |
| `PORT` | Listen port (default `8484`) |
| `FIREWIFI_BIN` | Production binary path for `prod.sh` |
| `FIREWIFI_SKIP_RESTART=1` | `prod.sh` builds only |

## Layout

- `main.go` — entrypoint (graceful shutdown)
- `web-ui/` — React 19 + TypeScript + Tailwind/daisyUI (Vite)
- `internal/deploy` — compose deploy manager
- `internal/server` — HTTP API + SSE
- `internal/server/web` — embeds Vite `dist/` + `go generate`
- `scripts/build-ui.sh` — reusable UI pack into embed dist
- `scripts/prod.sh` — production UI + binary + restart
- `scripts/air-build.sh` — Air incremental build
- `start.sh` — local Air dev entrypoint

## Notes

- Edit UI under `web-ui/src/`; do not hand-edit `internal/server/web/dist/`.
- Feature UI: `web-ui/src/features/<name>/`; shared primitives: `web-ui/src/components/ui/`.
- Wi‑Fi password is never returned by `GET /api/config`; leave the password field blank to keep the stored value.
- Do not commit secrets, tokens, or host-specific `.env` files.
