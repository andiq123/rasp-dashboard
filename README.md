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

Develop the UI on another machine against the live Pi:

```bash
cd web-ui && FIREWIFI_API=http://rasp.local:8484 npx vite --port 5180
```

Root-level npm commands proxy to `web-ui/`. Run `npm run build`, `npm run typecheck`,
`npm run lint`, or `npm run check` directly from the checkout root.

## Production (Pi) — rebuild

The UI is embedded at compile time, so rebuild the binary after every pull:

```bash
cd ~/sources/dashboard
git pull
./scripts/build-ui.sh
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -buildvcs=false -o ~/apps/firewifi-dashboard .
systemctl --user restart firewifi-dashboard.service
```

Commit and push changes before pulling on the Pi; there is no updater that resets
the checkout.

## Deployable services

A service is a GitHub repository compiled on the Pi into one static binary that runs in
an Alpine container with `PORT` set and linked database / bucket / Redis env injected.

| Source | Detected by | Build |
|--------|-------------|-------|
| Go | `go.mod` in the root directory | `go build` in a `golang` container (custom build command allowed) |

The app must listen on `PORT` on all interfaces.

## Service networking

Apps run on the host network as one unprivileged user (uid 64000). A policy routing
rule on the host (`pref 20100 uidrange 64000-64000 lookup main`) sends that user's
IPv4 traffic out the physical uplink, and its IPv6 is refused (the uplink has none, and
it would otherwise fall through to the VPN), so services never use the hotspot VPN,
with nothing to configure per service. Hotspot clients are unaffected: their traffic
is forwarded, not sent by that user, and stays on the VPN rules the hotspot scripts
install. Apps resolve names through public resolvers, because the host's resolver is
the VPN's while the VPN is up.

The rule is installed by `scripts/host/firewifi-cloudflare-routing` (copied to
`/usr/local/sbin/`), the same script that keeps Cloudflare tunnels off the VPN. The
WireGuard config runs it with `stop` in `PreUp` and `start` in `PostUp`, because
wg-quick puts its own rule in front of whatever is first when the VPN comes up. The
dashboard warns in the deploy log when the rule is missing or behind the VPN's.

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
| `FIREWIFI_CLEAN=1` | Force `npm ci` and wipe frontend build caches |
| `FIREWIFI_FORCE=1` | Force a UI rebuild even when inputs are current |
| `FIREWIFI_NODE_MEMORY_MB` | Override the automatically selected Node heap cap |

## Layout

- `main.go` — entrypoint (graceful shutdown)
- `web-ui/` — React 19 + TypeScript + Tailwind/daisyUI (Vite)
- `internal/deploy` — compose deploy manager
- `internal/server` — HTTP API + SSE
- `internal/server/web` — embeds Vite `dist/` + `go generate`
- `scripts/build-ui.sh` — reusable UI pack into embed dist
- `scripts/air-build.sh` — Air incremental build
- `start.sh` — local Air dev entrypoint

## Notes

- Edit UI under `web-ui/src/`; do not hand-edit `internal/server/web/dist/`.
- Feature UI: `web-ui/src/features/<name>/`; shared primitives: `web-ui/src/components/ui/`.
- Wi‑Fi password is never returned by `GET /api/config`; leave the password field blank to keep the stored value.
- Do not commit secrets, tokens, or host-specific `.env` files.
