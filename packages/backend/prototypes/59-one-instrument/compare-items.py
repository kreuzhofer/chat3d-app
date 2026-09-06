#!/usr/bin/env python3
"""
PROTOTYPE (wayfinder #50) — item-level comparison of two VLM experiment runs.

Usage: compare-items.py <candidate_run_id> <reference_run_id> [--first-pass]

Matches checklist items by example and position, then reports the numbers the
map measures by (identical %, hard pass<->fail flips, either-uncertain, pass
rates, same score, mean abs delta, gate disagreements at 7.5), split into
first-pass items and items resolved by the zoom follow-up ("[2x zoom]" prefix).
Also prints the 3x3 reference x candidate matrix, the one-directional bias
rates, and the share of candidate details that name a view (the evidence check).

--first-pass: treat "[2x zoom]" items in BOTH runs as uncertain again (the
first-pass level used for the Sonnet-vs-Sonnet noise floor in #54).

Reads the DB through `docker compose exec postgres psql`. Throwaway.
"""
import json
import re
import subprocess
import sys
from collections import Counter

ZOOM = "[2x zoom]"
VIEW_WORDS = re.compile(
    r"\b(front|back|left|right|top|bottom|45|isometric|ortho|angled|side|underside|overhead|profile|plan)\b",
    re.I,
)


def fetch(run_id: str):
    sql = f"""
    select coalesce(json_agg(row_to_json(t) order by t.example_id), '[]'::json) from (
      select example_id, visual_score, checklist_results, error, duration_ms,
             prompt_tokens, completion_tokens,
             length(coalesce(raw_response,'')) as raw_len,
             length(coalesce(reasoning,'')) as reasoning_len
      from vlm_experiment_results where run_id = '{run_id}'
    ) t;
    """
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "chat3d", "-d", "chat3d", "-At", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    rows = json.loads(out)
    return {r["example_id"]: r for r in rows}


def state(item, first_pass: bool):
    """pass -> 'P', fail -> 'F', uncertain -> 'U'."""
    if item is None:
        return "U"
    detail = item.get("detail") or ""
    if first_pass and detail.startswith(ZOOM):
        return "U"
    p = item.get("pass")
    return "P" if p is True else "F" if p is False else "U"


def is_zoomed(item):
    return bool(item) and (item.get("detail") or "").startswith(ZOOM)


def pct(n, d):
    return f"{100.0 * n / d:5.1f}%" if d else "  n/a "


def summarize(label, pairs):
    """pairs: list of (ref_state, cand_state, cand_item, ref_item)."""
    n = len(pairs)
    if n == 0:
        print(f"  {label}: no items")
        return
    ident = sum(1 for r, c, *_ in pairs if r == c)
    hard = sum(1 for r, c, *_ in pairs if {r, c} == {"P", "F"})
    unc = sum(1 for r, c, *_ in pairs if "U" in (r, c))
    rp = sum(1 for r, c, *_ in pairs if r == "P")
    cp = sum(1 for r, c, *_ in pairs if c == "P")
    ru = sum(1 for r, c, *_ in pairs if r == "U")
    cu = sum(1 for r, c, *_ in pairs if c == "U")
    print(f"  {label}: items {n} | identical {pct(ident, n)} | hard flips {pct(hard, n)} ({hard}) | "
          f"either uncertain {pct(unc, n)} | pass rate ref {pct(rp, n)} cand {pct(cp, n)} | "
          f"uncertain ref {ru} cand {cu}")


def matrix(pairs):
    m = Counter((r, c) for r, c, *_ in pairs)
    print("    ref \\ cand     P      F      U")
    for r in "PFU":
        print(f"    {r:>10}  " + "  ".join(f"{m[(r, c)]:5d}" for c in "PFU"))
    rf = sum(m[("F", c)] for c in "PFU")
    rp = sum(m[("P", c)] for c in "PFU")
    ru = sum(m[("U", c)] for c in "PFU")
    print(f"    of ref FAIL ({rf}): cand pass {pct(m[('F','P')], rf)}, cand uncertain {pct(m[('F','U')], rf)}")
    print(f"    of ref PASS ({rp}): cand fail {pct(m[('P','F')], rp)}, cand uncertain {pct(m[('P','U')], rp)}")
    if ru:
        print(f"    of ref UNCERTAIN ({ru}): cand pass {pct(m[('U','P')], ru)}, cand fail {pct(m[('U','F')], ru)}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    first_pass = "--first-pass" in sys.argv
    cand_id, ref_id = args[0], args[1]
    cand, ref = fetch(cand_id), fetch(ref_id)

    common = sorted(set(cand) & set(ref))
    print(f"candidate {cand_id[:8]}: {len(cand)} rows, errors {sum(1 for r in cand.values() if r['error'])}")
    print(f"reference {ref_id[:8]}: {len(ref)} rows, errors {sum(1 for r in ref.values() if r['error'])}")
    print(f"common examples: {len(common)}; first-pass mode: {first_pass}")

    pairs, mismatched_q, missing_cl = [], 0, 0
    scores, gate = [], Counter()
    cand_zoom_items, cand_first_unc, cand_resid_unc, cand_items = 0, 0, 0, 0
    evid_named, evid_total = 0, 0
    cap_hit_examples = 0
    per_example_zoom = Counter()
    dur, ptok, ctok = [], [], []

    for ex in common:
        c, r = cand[ex], ref[ex]
        if c["error"] or r["error"]:
            continue
        cl_c, cl_r = c["checklist_results"] or [], r["checklist_results"] or []
        if not cl_c or not cl_r:
            missing_cl += 1
            continue
        dur.append(c["duration_ms"] or 0)
        ptok.append(c["prompt_tokens"] or 0)
        ctok.append(c["completion_tokens"] or 0)
        # scores
        sc, sr = float(c["visual_score"]), float(r["visual_score"])
        scores.append((sc, sr))
        gc, gr = sc >= 7.5, sr >= 7.5
        if gc != gr:
            gate["cand_pass_ref_fail" if gc else "cand_fail_ref_pass"] += 1
        # items
        n = min(len(cl_c), len(cl_r))
        if len(cl_c) != len(cl_r):
            print(f"  ! item count differs on {ex[:8]}: cand {len(cl_c)} ref {len(cl_r)}")
        zoomed_here = 0
        for i in range(n):
            ic, ir = cl_c[i], cl_r[i]
            if (ic.get("question") or "").strip() != (ir.get("question") or "").strip():
                mismatched_q += 1
            pairs.append((state(ir, first_pass), state(ic, first_pass), ic, ir))
            cand_items += 1
            if is_zoomed(ic):
                cand_zoom_items += 1
                zoomed_here += 1
            if is_zoomed(ic) or ic.get("pass") is None:
                cand_first_unc += 1
            if ic.get("pass") is None:
                cand_resid_unc += 1
            d = (ic.get("detail") or "").replace(ZOOM, "")
            if d.strip():
                evid_total += 1
                if VIEW_WORDS.search(d):
                    evid_named += 1
        per_example_zoom[zoomed_here] += 1
        if zoomed_here >= 3 and any(x.get("pass") is None for x in cl_c):
            cap_hit_examples += 1

    print(f"\nexamples compared: {len(scores)}; missing checklist skipped: {missing_cl}; question mismatches: {mismatched_q}")
    print("\nITEMS (all)")
    summarize("all", pairs)
    matrix(pairs)
    if not first_pass:
        print("\nITEMS split by how the CANDIDATE answered")
        summarize("candidate first-pass items", [p for p in pairs if not is_zoomed(p[2])])
        summarize("candidate zoom-resolved items", [p for p in pairs if is_zoomed(p[2])])
        print("  candidate zoom-resolved items matrix:")
        matrix([p for p in pairs if is_zoomed(p[2])])
        print("\nITEMS split by how the REFERENCE answered")
        summarize("reference first-pass items", [p for p in pairs if not is_zoomed(p[3])])
        summarize("reference zoom-resolved items", [p for p in pairs if is_zoomed(p[3])])

    print("\nCANDIDATE uncertainty and zoom")
    print(f"  items {cand_items} | uncertain at first pass {pct(cand_first_unc, cand_items)} ({cand_first_unc}) | "
          f"resolved by zoom {cand_zoom_items} | residual uncertain {pct(cand_resid_unc, cand_items)} ({cand_resid_unc})")
    print(f"  zoom follow-ups per example: " + ", ".join(f"{k}:{v}" for k, v in sorted(per_example_zoom.items())) +
          f" | examples with residual uncertain after >=3 follow-ups (cap): {cap_hit_examples}")
    print(f"  details naming a view: {pct(evid_named, evid_total)} ({evid_named}/{evid_total})")

    print("\nSCORES (first pass, untouched by zoom)")
    n = len(scores)
    same = sum(1 for a, b in scores if a == b)
    mad = sum(abs(a - b) for a, b in scores) / n if n else 0
    print(f"  same score {pct(same, n)} | mean abs delta {mad:.3f} | mean cand {sum(a for a, _ in scores)/n:.2f} "
          f"ref {sum(b for _, b in scores)/n:.2f}")
    print(f"  gate at 7.5: cand passes {sum(1 for a, _ in scores if a >= 7.5)} ref passes {sum(1 for _, b in scores if b >= 7.5)} | "
          f"disagreements {sum(gate.values())} (cand pass/ref fail {gate['cand_pass_ref_fail']}, cand fail/ref pass {gate['cand_fail_ref_pass']}, "
          f"net {gate['cand_pass_ref_fail'] - gate['cand_fail_ref_pass']:+d})")

    print("\nCANDIDATE cost")
    if dur:
        print(f"  latency {sum(dur)/len(dur)/1000:.1f} s per example | tokens in {sum(ptok)/1e6:.3f}M out {sum(ctok)/1e3:.1f}K "
              f"({sum(ctok)/len(ctok):.0f} out per example)")


if __name__ == "__main__":
    main()
