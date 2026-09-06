#!/usr/bin/env python3
"""
PROTOTYPE (wayfinder #59) — item-level agreement on a subset of examples.

Usage: subset59.py <candidate_run> <reference_run> <subset-file>

The subset file holds one example id per line (here: the 33 plan-carrying
examples of the 125). Prints identical / hard flips / pass rates for the
subset and for the rest, all items and first-pass items, using
compare-items.py's fetch/state. Throwaway.
"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("ci", sys.argv[0].rsplit("/", 1)[0] + "/compare-items.py")
ci = importlib.util.module_from_spec(spec); spec.loader.exec_module(ci)

cand, ref = ci.fetch(sys.argv[1]), ci.fetch(sys.argv[2])
subset = {l.strip() for l in open(sys.argv[3]) if l.strip()}


def pairs_for(examples, first_pass):
    out = []
    for e in examples:
        c, r = cand.get(e), ref.get(e)
        if not c or not r or c["error"] or r["error"]:
            continue
        cl_c, cl_r = c["checklist_results"] or [], r["checklist_results"] or []
        for i in range(min(len(cl_c), len(cl_r))):
            out.append((ci.state(cl_r[i], first_pass), ci.state(cl_c[i], first_pass), cl_c[i], cl_r[i]))
    return out


common = sorted(set(cand) & set(ref))
inside = [e for e in common if e in subset]
outside = [e for e in common if e not in subset]
print(f"candidate {sys.argv[1][:8]} vs reference {sys.argv[2][:8]}: subset {len(inside)} examples, rest {len(outside)}")
for first_pass in (False, True):
    print(f"\n{'FIRST-PASS' if first_pass else 'ALL'} items")
    ci.summarize("plan-carrying", pairs_for(inside, first_pass))
    ci.summarize("rest         ", pairs_for(outside, first_pass))
