# web-ui

React dashboard source. Production assets are packed into `../internal/server/web/dist` and **embedded in the Go binary**.

```bash
npm run dev      # Vite, proxies /api → :8484
./scripts/build-ui.sh   # from repo root — pack into embed dist
./scripts/prod.sh       # from repo root — pack UI + production binary
```
