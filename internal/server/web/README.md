# Dashboard web UI (React)

Source lives in [`web-ui/`](../../../web-ui/) (Vite + React 19 + TypeScript + Tailwind/daisyUI).

```
web-ui/src/
  api/            # typed client + query keys
  components/ui/  # shared primitives (Button, Field, Modal, …)
  features/       # overview | projects | settings | files
  shell/          # rail + topbar
```

## Pack into the Go binary

```bash
./scripts/build-ui.sh          # reusable: npm + go generate → dist/
./scripts/prod.sh              # UI + production binary (+ systemd restart on Pi)
```

Or manually:

```bash
go generate ./internal/server/web
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -buildvcs=false -o firewifi-dashboard .
```

The binary embeds `dist/` at **compile time**. After `git pull` on the Pi, run `./scripts/prod.sh` so the running service gets the new UI.

## Dev

```bash
./start.sh                     # Air: rebuild UI when sources change
# or UI-only:
cd web-ui && npm run dev       # proxies /api → :8484
```

## Adding a feature

1. Create `web-ui/src/features/<name>/`
2. Add API helpers under `web-ui/src/api/` if needed
3. Register a route in `app/App.tsx`
4. Reuse `components/ui/*` and `lib/ui` tokens
