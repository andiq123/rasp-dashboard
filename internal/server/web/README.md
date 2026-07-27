# Dashboard web UI (React)

Source lives in [`web-ui/`](../../../web-ui/) (Vite + React 19 + TypeScript + CSS Modules).

```
web-ui/src/
  api/            # typed client + query keys
  components/ui/  # shared primitives (Button, Field, Modal, …)
  features/       # overview | projects | settings | files
  shell/          # rail + topbar
```

Build embeds into `dist/` via Go generate:

```bash
go generate ./internal/server/web
# or from web-ui:
npm run build
```

Then rebuild the binary:

```bash
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -buildvcs=false -o ~/apps/firewifi-dashboard .
```

Dev (API proxied to Go on :8484):

```bash
# terminal 1
./start.sh   # or go run .
# terminal 2
cd web-ui && npm run dev
```

## Adding a feature

1. Create `web-ui/src/features/<name>/` with `Page.tsx` + `Page.module.css`
2. Add API helpers under `web-ui/src/api/` if needed
3. Register a route in `app/App.tsx`
4. Reuse `components/ui/*` — do not duplicate button/field styles
