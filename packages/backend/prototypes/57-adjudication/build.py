#!/usr/bin/env python3
"""Build the #57 adjudication material from third-opinion-69.json.

  python3 build.py sheet                      -> third-opinion-69.md (next to this file)
  python3 build.py page VIEWS_DIR OUT.html    -> the adjudication page, views inlined

VIEWS_DIR holds the eight standard views per example, laid out as the storage
paths in workbench_examples (workbench/<ctx>/artifacts/<id>-screenshot-<view>.png);
copy them out of the backend container with
  docker exec -i chat3d-backend sh -c "cd /data/storage && tar -cf - -T -" < paths.txt | tar -x -C VIEWS_DIR
where paths.txt lists the screenshot_* columns of the 40 examples.
"""
import base64, collections, html, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ITEMS = json.load(open(os.path.join(HERE, "third-opinion-69.json")))
VIEWS = ["front", "back", "left", "right", "top", "bottom", "ortho_45", "ortho_45_bottom"]
VIEW_LABEL = {"front": "Front", "back": "Back", "left": "Left", "right": "Right", "top": "Top",
              "bottom": "Bottom", "ortho_45": "45° down", "ortho_45_bottom": "45° up"}
REF, CAND = "Claude Sonnet 4.6 (thinking off)", "qwen3.8-27b-nvfp4 (thinking off)"
INSTRUMENT = "production@22e0f10b0505"
RUNS = "arm 1 `62b4fa58` vs the re-made reference `6f6bb5c0`"


def direction(r):
    q, s = r["qwen"], r["sonnet"]
    if q == "fail" and s == "pass": return "qwen fails, Sonnet passes"
    if q == "pass" and s == "fail": return "qwen passes, Sonnet fails"
    return f"Sonnet uncertain, qwen {q}s"


def tally(items, verdict_of):
    """Counts under the bar's terms for the hard flips; verdict_of(item) -> R/C/N/None."""
    t = dict(qfp=0, sfp=0, qff=0, sff=0, n=0, undecided=0, hard=0)
    for r in items:
        if r["sonnet"] not in ("pass", "fail"): continue
        t["hard"] += 1
        v = verdict_of(r)
        if v is None: t["undecided"] += 1; continue
        if v == "N": t["n"] += 1; continue
        if r["qwen"] == "fail":   # Sonnet passed
            if v == "R": t["qff"] += 1
            else: t["sfp"] += 1
        else:                     # qwen passed, Sonnet failed
            if v == "R": t["qfp"] += 1
            else: t["sff"] += 1
    return t


def sheet():
    T = tally(ITEMS, lambda r: r["third"])
    by_dir = collections.defaultdict(collections.Counter)
    for r in ITEMS: by_dir[direction(r)][r["third"]] += 1
    out = []
    out.append(f"# Third opinion on all 69 disagreements: {CAND} vs {REF}, the 125\n")
    out.append(f"Instrument `{INSTRUMENT}`, {RUNS} (#64). Triage for #57 per the standing decision on map #45: "
               "Fable 5.1 read the eight stored views of every example (two 2×2 contact sheets per example, single views "
               "at full size where a count or a small feature decided it) and gave each disagreeing item a verdict. "
               "**Daniel is the arbiter**; nothing here counts toward the bar until he confirms it. "
               "Verdict: **R** the reference (Sonnet) is right, **C** the candidate (qwen) is right, **N** neither, or "
               "the item cannot be answered from renders. 23 verdicts carry over from the 26-item sample "
               "(`../61-qualification/third-opinion-sample.md`, judged against the previous reference `444483ec`); "
               "the other 46 are new. Sonnet's zoom angle is from the backend log of the re-made run; qwen's run "
               "predates the container restart and its angles are not recoverable.\n")
    out.append("## Tally (third opinion, not verdicts)\n")
    out.append("| direction | items | R (Sonnet right) | C (qwen right) | N |\n|---|---|---|---|---|")
    for d in ["qwen fails, Sonnet passes", "qwen passes, Sonnet fails", "Sonnet uncertain, qwen passs", "Sonnet uncertain, qwen fails"]:
        c = by_dir.get(d)
        if c: out.append(f"| {d.replace('passs', 'passes')} | {sum(c.values())} | {c['R']} | {c['C']} | {c['N']} |")
    out.append("")
    out.append(f"On the {T['hard']} hard flips: **qwen false passes {T['qfp']} vs Sonnet false passes {T['sfp']}** "
               f"(bar: qwen ≤ Sonnet — {'holds' if T['qfp'] <= T['sfp'] else 'fails'}); "
               f"**qwen false fails {T['qff']} vs Sonnet false fails {T['sff']}** "
               f"(bar: qwen ≤ 2× Sonnet = {2 * T['sff']} — {'holds' if T['qff'] <= 2 * T['sff'] else 'fails'}); "
               f"{T['n']} items N. The four Sonnet-uncertain items are not hard flips; qwen is right on all four.\n")
    out.append("## The table\n")
    out.append("| # | example | item | qwen | Sonnet | third | conf. | what the views show | deciding view | resolved by | source | **Daniel** |")
    out.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in ITEMS:
        z = f" (zoom→{r['sonnet_zoom_angle']})" if r.get("sonnet_zoom_angle") else ""
        src = "sample" if r["source"].startswith("carried") else "new"
        out.append(f"| {r['ex']} | {r['category']} `{r['short']}` | {r['item']} {r['text']} | {r['qwen'][0].upper()} | "
                   f"{r['sonnet'][0].upper()}{z} | **{r['third']}** | {r['confidence']} | {r['what']} | {r['deciding_view']} | {r['resolved_by']} | {src} |  |")
    out.append("")
    open(os.path.join(HERE, "third-opinion-69.md"), "w").write("\n".join(out) + "\n")
    print("sheet written;", T)


def page(views_dir, out_path):
    paths = json.load(open(os.path.join(views_dir, "views.json")))
    by_id = {e["id"]: e for e in paths}
    view_data = {}
    for short in sorted({r["short"] for r in ITEMS}):
        e = next(v for v in paths if v["id"].startswith(short))
        view_data[short] = {k: "data:image/png;base64," + base64.b64encode(open(os.path.join(views_dir, e[k]), "rb").read()).decode()
                            for k in VIEWS}
    items = []
    for r in ITEMS:
        items.append(dict(id=f"{r['short']}-{r['item']}", ex=r["ex"], category=r["category"], short=r["short"],
                          example_id=r["example_id"], item=r["item"], text=r["text"], prompt=r["prompt"],
                          qwen=r["qwen"], qwen_detail=r["qwen_detail"], sonnet=r["sonnet"], sonnet_detail=r["sonnet_detail"],
                          zoom=r.get("sonnet_zoom_angle"), third=r["third"], confidence=r["confidence"], what=r["what"],
                          view=r["deciding_view"], resolved_by=r["resolved_by"], carried=r["source"].startswith("carried"),
                          direction=direction(r)))
    tpl = open(os.path.join(HERE, "page.template.html")).read()
    doc = (tpl.replace("/*__ITEMS__*/", json.dumps(items, ensure_ascii=False))
              .replace("/*__VIEWS__*/", json.dumps(view_data)))
    open(out_path, "w").write(doc)
    print("page written:", out_path, f"{os.path.getsize(out_path) / 1e6:.1f} MB")


if __name__ == "__main__":
    if sys.argv[1] == "sheet": sheet()
    elif sys.argv[1] == "page": page(sys.argv[2], sys.argv[3])
