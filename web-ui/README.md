# FireWifi web UI

React 19 + TypeScript + Vite + CSS Modules. Embedded by the Go server after `go generate ./internal/server/web`.

```bash
npm install
npm run dev      # http://localhost:5173 (proxies /api → :8484)
npm run build    # → ../internal/server/web/dist
```

Conventions: feature folders under `src/features/`, shared UI under `src/components/ui/`. Styling: Tailwind CSS 4 + daisyUI (dark theme) + Lucide icons.
