# rasp-dashboard

FireWifi dashboard for Raspberry Pi — Go server with an embedded web UI for managing Docker Compose deployments, live resource monitoring, logs, and host settings.

## Requirements

- Go 1.22+
- Docker (for managed compose services)
- Linux (designed for Raspberry Pi)

## Build

```bash
./scripts/rebuild-dashboard.sh
```

Or manually:

```bash
go generate ./internal/server/web
go build -o firewifi-dashboard .
```

## Run

```bash
./firewifi-dashboard
```

Default listen address is configured in the app (typically `:8484`).

## Layout

- `main.go` — entrypoint
- `internal/deploy` — compose deploy manager
- `internal/server` — HTTP API + SSE
- `internal/server/web` — embedded HTML/CSS/JS UI
- `scripts/rebuild-dashboard.sh` — generate assets + rebuild
- `scripts/cmd/fwpatch` — remote source patch helper

## Notes

- UI JS sources live in `internal/server/web/assets/js/*.js`; `app.js` is generated.
- Do not commit secrets, tokens, or host-specific `.env` files.
