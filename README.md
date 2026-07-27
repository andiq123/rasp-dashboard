# rasp-dashboard

FireWifi dashboard for Raspberry Pi — Go server with an embedded React web UI for managing Docker Compose deployments, live resource monitoring, files, and host settings.

## Requirements

- Go 1.26+ (see `go.mod`)
- Node.js 20+ (to build the UI via `go generate`)
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

## Production rebuild (Pi)

```bash
./scripts/rebuild-dashboard.sh
```

Or manually:

```bash
go generate ./internal/server/web
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -buildvcs=false -o firewifi-dashboard .
./firewifi-dashboard
```

## Optional hardening

| Env | Purpose |
|-----|---------|
| `FIREWIFI_AUTH=user:pass` | HTTP Basic Auth for UI + APIs (hooks keep their own tokens) |
| `FIREWIFI_FILES_ROOT` | Files browser chroot (default: `$HOME`) |
| `FIREWIFI_BASE` | Config / token base directory |
| `HOME` | Deployments root (`$HOME/deployments`) and default paths |
| `PORT` | Listen port (default `8484`) |

## Layout

- `main.go` — entrypoint (graceful shutdown)
- `web-ui/` — React 19 + TypeScript + CSS Modules (Vite)
- `internal/deploy` — compose deploy manager
- `internal/server` — HTTP API + SSE
- `internal/server/web` — embeds Vite `dist/` + `go generate`
- `.air.toml` — Air live-reload config
- `start.sh` — local dev entrypoint
- `scripts/rebuild-dashboard.sh` — Pi generate + rebuild + systemd restart

## Notes

- Edit UI under `web-ui/src/`; do not hand-edit `internal/server/web/dist/`.
- Feature UI: `web-ui/src/features/<name>/`; shared primitives: `web-ui/src/components/ui/`.
- Wi‑Fi password is never returned by `GET /api/config`; leave the password field blank to keep the stored value.
- Do not commit secrets, tokens, or host-specific `.env` files.
