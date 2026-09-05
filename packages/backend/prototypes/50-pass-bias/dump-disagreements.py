#!/usr/bin/env python3
"""
PROTOTYPE (wayfinder #50) — dump the items where a candidate run disagrees with
the reference, with the control run's answer alongside, as Markdown for the
human inspection step the map prescribes (disagreements are what gets inspected).

Usage: dump-disagreements.py <candidate_run> <control_run> <reference_run> > out.md
"""
import json
import subprocess
import sys


def psql(sql: str):
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "chat3d", "-d", "chat3d", "-At", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return json.loads(out) if out else []


def fetch(run_id: str):
    rows = psql(f"""
      select coalesce(json_agg(row_to_json(t)), '[]') from (
        select r.example_id, r.visual_score, r.checklist_results,
               p.prompt, c.name as category
        from vlm_experiment_results r
        join workbench_examples e on e.id = r.example_id
        join workbench_example_prompts p on p.id = e.prompt_id
        join workbench_categories c on c.id = p.category_id
        where r.run_id = '{run_id}' and r.error is null
      ) t""")
    return {r["example_id"]: r for r in rows}


def st(item):
    if item is None:
        return "—"
    p = item.get("pass")
    return "pass" if p is True else "fail" if p is False else "uncertain"


def detail(item):
    return (item or {}).get("detail", "").replace("\n", " ").strip()


def main():
    cand_id, ctrl_id, ref_id = sys.argv[1:4]
    cand, ctrl, ref = fetch(cand_id), fetch(ctrl_id), fetch(ref_id)
    buckets = {"ref fail → variant pass": [], "ref pass → variant fail": [], "either uncertain": []}
    for ex in sorted(set(cand) & set(ref)):
        cl_c, cl_r = cand[ex]["checklist_results"] or [], ref[ex]["checklist_results"] or []
        cl_k = (ctrl.get(ex) or {}).get("checklist_results") or []
        for i in range(min(len(cl_c), len(cl_r))):
            r, c = st(cl_r[i]), st(cl_c[i])
            k = cl_k[i] if i < len(cl_k) else None
            if r == c:
                continue
            key = ("ref fail → variant pass" if (r, c) == ("fail", "pass")
                   else "ref pass → variant fail" if (r, c) == ("pass", "fail")
                   else "either uncertain")
            buckets[key].append((ex, cand[ex], i, cl_r[i], cl_c[i], k))

    print(f"# Disagreements: variant `{cand_id[:8]}` vs reference `{ref_id[:8]}` (control `{ctrl_id[:8]}` alongside)\n")
    for key, rows in buckets.items():
        print(f"## {key} — {len(rows)} items\n")
        for ex, row, i, ir, ic, ik in rows:
            print(f"### {row['category']} · `{ex[:8]}` · item {i + 1}")
            print(f"**Prompt:** {row['prompt'].strip()[:400]}\n")
            print(f"**Item:** {ir.get('question', '').strip()}\n")
            print(f"- **reference ({st(ir)})**: {detail(ir)}")
            print(f"- **variant ({st(ic)})**: {detail(ic)}")
            print(f"- **control ({st(ik)})**: {detail(ik)}\n")


if __name__ == "__main__":
    main()
