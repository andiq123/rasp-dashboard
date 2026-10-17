#!/usr/bin/env python3
"""Keep Cloudflare's encrypted tunnel transport independent of the hotspot VPN."""
import json
import subprocess
import sys

# Cloudflare Tunnel edge networks, TCP/UDP 7844 only. The main table follows
# the physical uplink's DHCP gateway; all other traffic keeps its VPN policy.
RULES = [
    (20000 + i, network, protocol)
    for i, (network, protocol) in enumerate(
        (network, protocol)
        for network in ("198.41.192.0/24", "198.41.200.0/24")
        for protocol in ("tcp", "udp")
    )
]


def destination(rule):
    address = rule.get("dst", "")
    return address if "/" in address else f"{address}/{rule.get('dstlen', 32)}"


def apply(action):
    existing = json.loads(subprocess.check_output(["ip", "-j", "-4", "rule", "show"]))
    for priority, network, protocol in RULES:
        matches = [r for r in existing if r.get("priority") == priority]
        if any(destination(r) != network or r.get("ipproto") != protocol
               or str(r.get("dport")) != "7844" or r.get("table") != "main"
               or r.get("src") != "all" for r in matches):
            raise SystemExit(f"Routing priority {priority} is already in use; leaving it unchanged")
    for priority, network, protocol in RULES:
        matches = [r for r in existing if r.get("priority") == priority]
        args = ["pref", str(priority), "to", network, "ipproto", protocol,
                "dport", "7844", "lookup", "main"]
        if action == "start" and not matches:
            subprocess.run(["ip", "-4", "rule", "add", *args], check=True)
        elif action == "stop":
            for _ in matches:
                subprocess.run(["ip", "-4", "rule", "del", *args], check=True)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("start", "stop"):
        raise SystemExit("Usage: cloudflare-routing.py start|stop")
    apply(sys.argv[1])
