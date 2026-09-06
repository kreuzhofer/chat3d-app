#!/usr/bin/env python3
"""Summarise gateway-poll.py output: per member, samples with inflight>0, inflight-seconds (share), max inflight.
Usage: gateway-summary.py <out.tsv> [start-iso] [end-iso]"""
import sys
from collections import defaultdict
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if "\t" in l and "ERROR" not in l]
lo = sys.argv[2] if len(sys.argv) > 2 else ""; hi = sys.argv[3] if len(sys.argv) > 3 else "~"
rows = [r for r in rows if lo <= r[0] <= hi]
busy = defaultdict(int); secs = defaultdict(float); peak = defaultdict(int); samples = defaultdict(int); notserving = defaultdict(int)
for ts, node, serving, inflight, *_ in rows:
    n = int(inflight) if inflight not in ("None", "") else 0
    samples[node] += 1; busy[node] += n > 0; secs[node] += 2 * n; peak[node] = max(peak[node], n)
    notserving[node] += serving != "True"
total = sum(secs.values()) or 1
print(f"samples per member: {dict(samples)}  window {rows[0][0] if rows else '-'} .. {rows[-1][0] if rows else '-'}")
for node in sorted(secs):
    print(f"  {node:14s} busy samples {busy[node]:5d} ({100*busy[node]/max(samples[node],1):5.1f}%) | inflight-seconds {secs[node]:8.0f} ({100*secs[node]/total:5.1f}%) | peak inflight {peak[node]} | not-serving samples {notserving[node]}")
