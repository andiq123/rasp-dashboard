# rasp-dashboard

FireWifi dashboard for Raspberry Pi — Go server with an embedded web UI for managing Docker Compose deployments, live resource monitoring, logs, and host settings.

## Requirements

- Go 1.26+ (see `go.mod`)
- Docker (for managed compose services)
- Linux (designed for Raspberry Pi); local macOS/Linux works for UI/API development

## Develop (live reload)

```bash
./start.sh
```

Uses [Air](https://github.com/air-verse/air): on `.go` / UI source changes it runs `go generate` (packs + minifies assets), rebuilds, and restarts.

- App: `http://localhost:8484` (`PORT` overrides)
- Browser auto-refresh: `http://localhost:8490` (Air proxy)
- Runtime data: `.devdata/` (`FIREWIFI_BASE` overrides)

Air is installed automatically via `go install` if missing.

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
- `internal/deploy` — compose deploy manager
- `internal/server` — HTTP API + SSE
- `internal/server/web` — embedded HTML/CSS/JS UI
- `.air.toml` — Air live-reload config
- `start.sh` — local dev entrypoint
- `scripts/rebuild-dashboard.sh` — Pi generate + rebuild + systemd restart
- `scripts/cmd/fwpatch` — remote source patch helper

## Notes

- UI JS sources live in `internal/server/web/assets/js/*.js`; `app.js` is generated.
- Edit `assets/dashboard.css`; `dashboard.min.css` is generated — do not edit minified outputs.
- Wi‑Fi password is never returned by `GET /api/config`; leave the password field blank to keep the stored value.
- Do not commit secrets, tokens, or host-specific `.env` files.
