#!/usr/bin/env python3
"""
PROTOTYPE (wayfinder #59) — watch the gateway's pool for one published name while a run executes.

Usage: gateway-poll.py <publishedName> <out.tsv>   (Ctrl-C or kill to stop)
Every 2 s: one line per member — ISO time, node, serving, inflight — read from
GET http://192.168.44.14:4000/api/gateway (dgx-manager: least-outstanding selection with a
per-pool rotation; this is the live view of that selection). Summarise with gateway-summary.py.
"""
import json, sys, time, urllib.request
from datetime import datetime, timezone

name, out = sys.argv[1], sys.argv[2]
with open(out, "a") as f:
    while True:
        try:
            d = json.load(urllib.request.urlopen("http://192.168.44.14:4000/api/gateway", timeout=5))
            ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
            for p in d.get("pools", []):
                if (p.get("publishedName") or p.get("name")) != name:
                    continue
                for m in p.get("members", []):
                    f.write(f"{ts}\t{m.get('node')}\t{m.get('serving')}\t{m.get('inflight')}\t{m.get('deploymentId')}\n")
            f.flush()
        except Exception as e:  # keep polling through transient gateway errors
            f.write(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}\tERROR\t{e}\n"); f.flush()
        time.sleep(2)
