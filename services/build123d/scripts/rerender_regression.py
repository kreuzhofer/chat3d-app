#!/usr/bin/env python3
"""Re-render regression check for a Build123d service upgrade (#135).

Re-renders a seeded, category-stratified sample of approved corpus code on two
service instances (the current image and the candidate) and compares render
success, solid count and bounding box.

Stdlib only; runs on the host against the dev instance:

    # 1. the sample: approved rows, every category (reads Postgres via docker exec)
    rerender_regression.py sample --size 400 --seed 135 --out sample.jsonl
    # 2. render it on each instance (resumable: rows already in --out are skipped)
    rerender_regression.py render --sample sample.jsonl --url http://localhost:30230 --container rr-old --out old.jsonl
    rerender_regression.py render --sample sample.jsonl --url http://localhost:30231 --container rr-new --out new.jsonl
    # 3. the report
    rerender_regression.py report --sample sample.jsonl --old old.jsonl --new new.jsonl --out report.md

The code is wrapped in the backend's CODE_TEMPLATE, read from
packages/backend/src/utils/workbench-code-utils.ts so the check renders exactly
what production sends. A probe after the exports writes `<name>.geom.json`
(solid count, volume and bounding box of root_part, the compound written to
STEP/STL);
the service returns it with the other outputs. A probe failure never turns a
successful render into a failure: the geometry is then simply missing.
"""
import argparse
import base64
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict

REPO = pathlib.Path(__file__).resolve().parents[3]
TEMPLATE_SOURCE = REPO / "packages/backend/src/utils/workbench-code-utils.ts"
RENDER_TIMEOUT_S = 180
# Absolute tolerance on bounding-box coordinates, mm.
BBOX_TOL = 0.01
# Relative tolerance on volume: kernel and tessellation-free, so 0.5% is a real change.
VOLUME_RTOL = 0.005

GEOM_PROBE = """
try:
    import json as _rr_json
    _rr_bb = root_part.bounding_box()
    with open("###FILENAME###.geom.json", "w") as _rr_fh:
        _rr_json.dump({
            "solids": len(root_part.solids()),
            "volume": root_part.volume,
            "bbox": [_rr_bb.min.X, _rr_bb.min.Y, _rr_bb.min.Z,
                     _rr_bb.max.X, _rr_bb.max.Y, _rr_bb.max.Z],
        }, _rr_fh)
except Exception as _rr_err:
    with open("###FILENAME###.geom.json", "w") as _rr_fh:
        _rr_fh.write('{"probe_error": %r}' % str(_rr_err)[:200])
"""


def load_template() -> str:
    src = TEMPLATE_SOURCE.read_text(encoding="utf-8")
    m = re.search(r"export const CODE_TEMPLATE = `(.*?)`;", src, re.S)
    if not m or "###CODE###" not in m.group(1):
        sys.exit(f"CODE_TEMPLATE not found in {TEMPLATE_SOURCE}")
    # The TS literal escapes no characters the template uses except backticks.
    return m.group(1)


def wrap(template: str, code: str, name: str) -> str:
    return (template.replace("###CODE###", code) + GEOM_PROBE).replace("###FILENAME###", name)


# ── sample ────────────────────────────────────────────────────────────

SAMPLE_SQL = """
with approved as (
  select e.id, e.code, c.name as category,
         row_number() over (partition by c.id order by md5(e.id::text || '{seed}')) as rn,
         count(*) over (partition by c.id) as n_cat,
         count(*) over () as n_all
  from workbench_examples e
  join workbench_example_prompts p on p.id = e.prompt_id
  join workbench_categories c on c.id = p.category_id
  where e.approval_status = 'auto_approved' and e.render_status = 'success'
    and e.code is not null and e.code <> ''
)
select json_build_object('id', id, 'category', category, 'code', code)
from approved
where rn <= greatest({floor}, round({size}::numeric * n_cat / n_all))
order by category, rn
"""


def cmd_sample(a):
    sql = SAMPLE_SQL.format(seed=int(a.seed), floor=int(a.floor), size=int(a.size))
    out = subprocess.run(
        ["docker", "exec", "-i", a.pg_container, "psql", "-U", a.pg_user, "-d", a.pg_db,
         "-tA", "-c", sql],
        check=True, capture_output=True, text=True,
    ).stdout
    rows = [json.loads(line) for line in out.splitlines() if line.strip()]
    with open(a.out, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")
    per_cat = Counter(r["category"] for r in rows)
    print(f"{len(rows)} rows from {len(per_cat)} categories -> {a.out}")
    for cat, n in sorted(per_cat.items(), key=lambda kv: -kv[1]):
        print(f"  {n:4d}  {cat}")


# ── render ────────────────────────────────────────────────────────────

def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def wait_healthy(url: str, deadline_s: float = 120) -> bool:
    end = time.time() + deadline_s
    while time.time() < end:
        try:
            with urllib.request.urlopen(url.rstrip("/") + "/", timeout=5):
                return True
        except Exception:
            time.sleep(3)
    return False


def render_one(url: str, template: str, row: dict) -> dict:
    name = "rr_" + row["id"].replace("-", "")[:16]
    payload = json.dumps({"code": wrap(template, row["code"], name),
                          "filename": f"{name}.step"}).encode()
    req = urllib.request.Request(url.rstrip("/") + "/render/", data=payload,
                                 headers={"Content-Type": "application/json"})
    started = time.time()
    with urllib.request.urlopen(req, timeout=RENDER_TIMEOUT_S) as res:
        body = json.loads(res.read())
    result = {"id": row["id"], "seconds": round(time.time() - started, 2)}
    files = {f["filename"]: f["content"] for f in body.get("files", [])}
    geom_b64 = files.pop(f"{name}.geom.json", None)
    exts = sorted(os.path.splitext(f)[1] for f in files)
    # Success as production sees it: the service said so and the STL came back.
    result["ok"] = bool(body.get("success")) and ".stl" in exts
    result["outputs"] = exts
    if not result["ok"]:
        msg = body.get("message") or ""
        # The head names the exception, the tail locates it.
        result["error"] = msg if len(msg) <= 1500 else msg[:500] + "\n…\n" + msg[-1000:]
    if geom_b64 is not None:
        result["geom"] = json.loads(base64.b64decode(geom_b64))
    return result


def cmd_render(a):
    template = load_template()
    sample = read_jsonl(a.sample)
    done = {r["id"] for r in read_jsonl(a.out)}
    todo = [r for r in sample if r["id"] not in done]
    print(f"{len(done)} done, {len(todo)} to render on {a.url}", flush=True)
    with open(a.out, "a", encoding="utf-8") as out:
        for i, row in enumerate(todo, 1):
            result = None
            for attempt in range(1, 4):
                try:
                    result = render_one(a.url, template, row)
                    break
                except OSError as err:  # URLError, timeouts, refused connections
                    # A timeout or a crashed worker (OCCT segfault restarts the
                    # container): wait for health, then retry.
                    kind = "timeout" if "timed out" in str(err) else "unreachable"
                    result = {"id": row["id"], "ok": False, "infra": kind, "error": str(err)}
                    if kind == "timeout":
                        # The single worker is still busy with this render and
                        # would time out every row queued behind it: restart it.
                        if a.container:
                            subprocess.run(["docker", "restart", a.container],
                                           check=True, capture_output=True)
                        if not wait_healthy(a.url):
                            sys.exit(f"{a.url} did not come back after a restart")
                        break  # a 180 s render is the row's result, not the service's
                    if not wait_healthy(a.url):
                        sys.exit(f"{a.url} unreachable, stopping (rerun resumes)")
            out.write(json.dumps(result) + "\n")
            out.flush()
            if i % 10 == 0 or not result.get("ok"):
                status = "ok" if result.get("ok") else ("FAIL " + result.get("infra", ""))
                print(f"[{i}/{len(todo)}] {row['category']}: {status}", flush=True)


# ── report ────────────────────────────────────────────────────────────

def first_error_line(err: str) -> str:
    lines = [l.strip() for l in (err or "").splitlines() if l.strip()]
    # The service puts the exception message on the first line, the traceback after.
    msg = lines[0] if lines else ""
    return msg[:220]


def bbox_change(old, new):
    if not old or not new or "bbox" not in old or "bbox" not in new:
        return "unknown"
    o, n = old["bbox"], new["bbox"]
    if all(abs(x - y) <= BBOX_TOL for x, y in zip(o, n)):
        return "same"
    size_o = [o[i + 3] - o[i] for i in range(3)]
    size_n = [n[i + 3] - n[i] for i in range(3)]
    if all(abs(x - y) <= BBOX_TOL for x, y in zip(size_o, size_n)):
        return "moved"
    return "resized"


def volume_change(old, new):
    if not old or not new or "volume" not in old or "volume" not in new:
        return "unknown"
    vo, vn = old["volume"], new["volume"]
    return "same" if abs(vo - vn) <= VOLUME_RTOL * max(abs(vo), 1e-9) else "changed"


def cmd_report(a):
    sample = {r["id"]: r for r in read_jsonl(a.sample)}
    old = {r["id"]: r for r in read_jsonl(a.old)}
    new = {r["id"]: r for r in read_jsonl(a.new)}
    ids = [i for i in sample if i in old and i in new]
    cats = defaultdict(lambda: Counter())
    rows = []
    for i in ids:
        s, o, n = sample[i], old[i], new[i]
        c = cats[s["category"]]
        c["n"] += 1
        c["old_ok"] += o.get("ok", False)
        c["new_ok"] += n.get("ok", False)
        geo = bbox_change(o.get("geom"), n.get("geom")) if o.get("ok") and n.get("ok") else None
        so_, sn_ = o.get("geom", {}).get("solids"), n.get("geom", {}).get("solids")
        solids_same = (None if geo is None or so_ is None or sn_ is None else so_ == sn_)
        vol = volume_change(o.get("geom"), n.get("geom")) if geo is not None else None
        rows.append((s, o, n, geo, solids_same, vol))

    total = Counter()
    for c in cats.values():
        total.update(c)
    both = [r for r in rows if r[3] is not None]
    lines = []
    w = lines.append
    w(f"# Re-render regression: {a.old_label} → {a.new_label}\n")
    w(f"Sample: {len(ids)} approved corpus rows, {len(cats)} categories "
      f"(seeded, stratified; every row rendered successfully when it was stored).\n")
    w("## Render success\n")
    w(f"| | {a.old_label} | {a.new_label} |\n|---|---|---|")
    w(f"| rendered | {total['old_ok']}/{total['n']} ({100 * total['old_ok'] / max(1, total['n']):.1f}%) "
      f"| {total['new_ok']}/{total['n']} ({100 * total['new_ok'] / max(1, total['n']):.1f}%) |\n")
    w(f"| Category | n | {a.old_label} | {a.new_label} |\n|---|---|---|---|")
    for cat, c in sorted(cats.items(), key=lambda kv: -kv[1]["n"]):
        w(f"| {cat} | {c['n']} | {c['old_ok']} | {c['new_ok']} |")
    w("")

    w("## Geometry, where both rendered\n")
    geo = Counter(r[3] for r in both)
    solids = Counter({True: "same", False: "changed", None: "unknown"}[r[4]] for r in both)
    vols = Counter(r[5] for r in both)
    w(f"Rows rendered by both: {len(both)}. Bounding box (tolerance {BBOX_TOL} mm): "
      + ", ".join(f"{k} {v}" for k, v in geo.most_common()) + ". "
      + "Solid count: " + ", ".join(f"{k} {v}" for k, v in solids.most_common()) + ". "
      + f"Volume (tolerance {VOLUME_RTOL:.1%}): "
      + ", ".join(f"{k} {v}" for k, v in vols.most_common()) + ".\n")
    changed = [r for r in both if r[3] != "same" or r[4] is False or r[5] != "same"]
    if changed:
        w("| Row | Category | bbox | solids old → new | volume old → new (mm³) |\n|---|---|---|---|---|")
        for s, o, n, g, _, _ in changed:
            og, ng = o.get("geom", {}), n.get("geom", {})
            fv = lambda v: f"{v:,.1f}" if isinstance(v, (int, float)) else "—"
            w(f"| `{s['id'][:8]}` | {s['category']} | {g} | "
              f"{og.get('solids')} → {ng.get('solids')} | {fv(og.get('volume'))} → {fv(ng.get('volume'))} |")
        w("")

    def failure_table(title, pick):
        sel = [r for r in rows if pick(r)]
        w(f"## {title} ({len(sel)})\n")
        if not sel:
            w("None.\n")
            return
        w("| Row | Category | Error |\n|---|---|---|")
        for s, o, n, *_ in sel:
            res = n if not n.get("ok") else o
            err = res.get("infra") or first_error_line(res.get("error", ""))
            w(f"| `{s['id']}` | {s['category']} | {err.replace('|', '/')} |")
        w("")

    failure_table(f"Regressions: rendered on {a.old_label}, failed on {a.new_label}",
                  lambda r: r[1].get("ok") and not r[2].get("ok"))
    failure_table(f"Fixed: failed on {a.old_label}, rendered on {a.new_label}",
                  lambda r: not r[1].get("ok") and r[2].get("ok"))
    failure_table("Failed on both", lambda r: not r[1].get("ok") and not r[2].get("ok"))

    secs = lambda d: [r["seconds"] for r in d.values() if r.get("ok") and "seconds" in r]
    so, sn = secs(old), secs(new)
    if so and sn:
        med = lambda v: sorted(v)[len(v) // 2]
        w(f"Median render time of successful rows: {a.old_label} {med(so):.2f} s, "
          f"{a.new_label} {med(sn):.2f} s.\n")
    text = "\n".join(lines)
    pathlib.Path(a.out).write_text(text, encoding="utf-8")
    print(text)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sample")
    s.add_argument("--size", type=int, default=400)
    s.add_argument("--floor", type=int, default=8, help="minimum rows per category (all if fewer)")
    s.add_argument("--seed", default="135")
    s.add_argument("--out", required=True)
    s.add_argument("--pg-container", default="chat3d-postgres")
    s.add_argument("--pg-user", default=os.environ.get("DB_USER", "chat3d"))
    s.add_argument("--pg-db", default=os.environ.get("DB_NAME", "chat3d"))
    s.set_defaults(fn=cmd_sample)
    r = sub.add_parser("render")
    r.add_argument("--sample", required=True)
    r.add_argument("--url", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--container", help="docker container behind --url, restarted after a timeout")
    r.set_defaults(fn=cmd_render)
    q = sub.add_parser("report")
    q.add_argument("--sample", required=True)
    q.add_argument("--old", required=True)
    q.add_argument("--new", required=True)
    q.add_argument("--old-label", default="old")
    q.add_argument("--new-label", default="new")
    q.add_argument("--out", required=True)
    q.set_defaults(fn=cmd_report)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
