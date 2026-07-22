# Dashboard web UI

Concerns are split under `assets/js/`:

| File | Responsibility |
|------|----------------|
| `01-core.js` | Shared state, API, toast, formatters |
| `02-live-panels.js` | VPN + System panels (live-patched) |
| `02b-ui.js` | Shared form/UI primitives |
| `03-cselect.js` | Searchable combobox |
| `04-folds.js` | Accordion folds |
| `05-resources.js` | Pi capacity sliders |
| `06-services.js` | Groups + service cards |
| `06b-docker.js` | Docker housekeeping UI |
| `07-wizard.js` | Deploy wizards |
| `08-render.js` | `render` / actions |
| `09-activity.js` | Activity console |
| `10-events.js` | DOM events + boot |

`app.js` is the concatenated bundle embedded into the dashboard binary.

```bash
# From repo root (or from this directory):
go generate ./internal/server/web

# Then rebuild:
go build -buildvcs=false -o ~/apps/firewifi-dashboard .
```
