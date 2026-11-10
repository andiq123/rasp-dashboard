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
npm run dev
```

Root-level npm commands proxy to `web-ui/`. Run `npm run build`, `npm run typecheck`,
`npm run lint`, or `npm run check` directly from the checkout root.

## Production (Pi) — get latest + rebuild

One command on the Pi syncs to remote, reloads the newly pulled updater, incrementally builds what changed, and restarts when needed:

```bash
cd ~/sources/dashboard
./scripts/update.sh
```

The updater:

1. `git fetch` + `reset --hard` to upstream (overrides local/stale tracked files; refuses if you have unpushed commits)
2. Re-executes the newly downloaded `update.sh`, so updater changes apply immediately
3. Runs `npm ci` only when dependencies changed or are missing
4. Rebuilds the embedded UI only when its sources changed
5. Uses Go's build cache and atomically replaces `FIREWIFI_BIN`
6. Restarts and verifies `firewifi-dashboard.service` after a new binary is built

When the checkout, UI, binary, and service are already current, the command exits immediately. Node memory and Go compiler parallelism are capped automatically on low-memory Pis.

```bash
# rebuild current checkout only (no git sync)
FIREWIFI_SKIP_PULL=1 ./scripts/update.sh

# build only (no systemd)
FIREWIFI_SKIP_RESTART=1 ./scripts/update.sh

# custom binary path
FIREWIFI_BIN=/usr/local/bin/firewifi-dashboard ./scripts/update.sh

# deliberately discard caches and rebuild everything
FIREWIFI_CLEAN=1 FIREWIFI_FORCE=1 ./scripts/update.sh
```

`./scripts/prod.sh` is incremental build+restart only (no git sync).
`./scripts/rebuild-dashboard.sh` aliases `prod.sh`.

**Important:** the UI is compile-time embedded. `git pull` alone does not update a running binary — run `./scripts/update.sh`.

## Deployable services

A service is a GitHub repository compiled on the Pi into one static binary that runs in
an Alpine container with `PORT` set and linked database / bucket / Redis env injected.

| Source | Detected by | Build |
|--------|-------------|-------|
| Go | `go.mod` in the root directory | `go build` in a `golang` container (custom build command allowed) |
| Rust | `Cargo.toml` (and no `go.mod`) | `cargo build --release --locked` in `rust:alpine`, static musl binary |

Rust builds share one Cargo registry cache and keep compiled artifacts per service, so
only the first build is slow (20–40 minutes on a Pi 4; later deploys recompile what
changed). The app must listen on `PORT` on all interfaces.

## Service networking

Apps run on the host network as one unprivileged user (uid 64000), and the dashboard
keeps a policy routing rule (`pref 20100 uidrange 64000-64000 lookup main`, IPv4 and
IPv6) that sends that user's traffic out the physical uplink. Services therefore never
use the hotspot VPN, with nothing to configure per service. Hotspot clients are
unaffected: their traffic is forwarded, not sent by that user, and stays on the VPN
rules the hotspot scripts install. Apps resolve names through public resolvers,
because the host's resolver is the VPN's while the VPN is up.

## Optional hardening

| Env | Purpose |
|-----|---------|
| `FIREWIFI_AUTH=user:pass` | HTTP Basic Auth for UI + APIs (hooks keep their own tokens) |

## Monitor history

The dashboard stores one lightweight host and per-service sample every 30 seconds in
`$HOME/deployments/monitor/history.db`. The embedded pure-Go Bolt store keeps seven
days of data, removes expired samples in every write transaction, and
downsamples API responses to at most 360 points. This keeps disk writes, response size,
and browser chart work bounded on a Raspberry Pi.

- System history: `GET /api/history/system?range=1h|6h|24h|7d`
- Service history: `GET /api/groups/{group}/services/{service}/history?range=...`

## Remote dashboard through Cloudflare

Overview → **Remote dashboard** can expose the dashboard origin
`http://127.0.0.1:8484`. Stable mode uses a remotely managed Cloudflare Tunnel and
stores its connector token in an owner-only file. Its user-systemd connector runs
independently of dashboard rebuilds and is restored after reboot.

Protect the hostname with a Cloudflare Access application before enabling the route.
Temporary `trycloudflare.com` previews are accepted only when `FIREWIFI_AUTH` is set.
The dashboard verifies the public route after starting it and never returns a saved
connector token to the browser.

### Tunnel routing with Mullvad

If Mullvad blocks Cloudflare's outbound tunnel transport, install the optional
host routing service from this repository on the Pi:

```sh
sudo install -m 755 scripts/cloudflare-routing.py /usr/local/sbin/firewifi-cloudflare-routing
sudo install -m 644 scripts/firewifi-cloudflare-routing.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now firewifi-cloudflare-routing.service
```

Only TCP/UDP port 7844 to Cloudflare's two IPv4 tunnel edge networks uses the
main routing table and physical uplink. Other traffic retains the VPN policy.
The service persists across reboot and refuses to overwrite unrelated routing
rules at priorities 20000–20003. Restart the affected user-systemd tunnel
connectors after installation, then verify their public health endpoints.

For VPN repairs and relay changes, add these hooks inside `[Interface]` in the
WireGuard configuration used by `wg-quick` (back up the configuration first):

```ini
PreUp = if systemctl is-enabled --quiet firewifi-cloudflare-routing.service; then /usr/local/sbin/firewifi-cloudflare-routing stop; fi
PostUp = if systemctl is-enabled --quiet firewifi-cloudflare-routing.service; then /usr/local/sbin/firewifi-cloudflare-routing start; fi
```

WireGuard automatically assigns priorities ahead of existing rules. Removing the
Cloudflare exceptions before startup and restoring them afterward keeps tunnel
traffic on the physical uplink across VPN reconnects. Relay refreshes must preserve
these hooks. Remove the hooks before uninstalling the routing helper.

Check routing with `ip route get 198.41.192.67 ipproto tcp dport 7844` and
`ip route get 1.1.1.1`: the first should use the physical uplink, the second the
VPN. Roll back with `sudo systemctl disable --now firewifi-cloudflare-routing.service`;
this removes only the service's four rules.

Routing tests: `python3 -m unittest discover -s scripts -p 'test_cloudflare_routing.py'`.

| `FIREWIFI_FILES_ROOT` | Files browser chroot (default: `$HOME`) |
| `FIREWIFI_BASE` | Config / token base directory |
| `HOME` | Deployments root (`$HOME/deployments`) and default paths |
| `PORT` | Listen port (default `8484`) |
| `FIREWIFI_BIN` | Production binary path for `prod.sh` / `update.sh` |
| `FIREWIFI_SKIP_RESTART=1` | `prod.sh` / `update.sh` builds only |
| `FIREWIFI_SKIP_PULL=1` | `update.sh` skips git sync |
| `FIREWIFI_CLEAN=1` | Force `npm ci` and wipe frontend build caches |
| `FIREWIFI_FORCE=1` | Force UI/binary rebuild even when inputs are current |
| `FIREWIFI_NODE_MEMORY_MB` | Override the automatically selected Node heap cap |
| `FIREWIFI_BUILD_JOBS` | Override Go compiler parallelism |

## Layout

- `main.go` — entrypoint (graceful shutdown)
- `web-ui/` — React 19 + TypeScript + Tailwind/daisyUI (Vite)
- `internal/deploy` — compose deploy manager
- `internal/server` — HTTP API + SSE
- `internal/server/web` — embeds Vite `dist/` + `go generate`
- `scripts/build-ui.sh` — reusable UI pack into embed dist
- `scripts/prod.sh` — production UI + binary + restart
- `scripts/update.sh` — upstream sync then `prod.sh` (Pi one-liner)
- `scripts/air-build.sh` — Air incremental build
- `start.sh` — local Air dev entrypoint

## Notes

- Edit UI under `web-ui/src/`; do not hand-edit `internal/server/web/dist/`.
- Feature UI: `web-ui/src/features/<name>/`; shared primitives: `web-ui/src/components/ui/`.
- Wi‑Fi password is never returned by `GET /api/config`; leave the password field blank to keep the stored value.
- Do not commit secrets, tokens, or host-specific `.env` files.
