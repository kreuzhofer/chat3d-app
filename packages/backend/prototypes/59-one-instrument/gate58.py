"""Item-level gate (ADR 0001): an example is approved when every checklist item passes (after zoom).
Compares candidate vs reference on examples with >=3 items in both. Usage: gate58.py <cand_run> <ref_run>"""
import sys, importlib.util
spec = importlib.util.spec_from_file_location("ci", sys.argv[0].rsplit("/",1)[0] + "/compare-items.py")
ci = importlib.util.module_from_spec(spec); spec.loader.exec_module(ci)
cand, ref = ci.fetch(sys.argv[1]), ci.fetch(sys.argv[2])
common = [e for e in cand if e in ref and not cand[e]["error"] and not ref[e]["error"]]
n = agree = fa = fr = ca = ra = 0
for e in common:
    cl_c, cl_r = cand[e]["checklist_results"] or [], ref[e]["checklist_results"] or []
    if len(cl_c) < 3 or len(cl_r) < 3 or len(cl_c) != len(cl_r): continue
    n += 1
    vc = all(ci.state(i, False) == "P" for i in cl_c)
    vr = all(ci.state(i, False) == "P" for i in cl_r)
    ca += vc; ra += vr
    if vc == vr: agree += 1
    elif vc and not vr: fa += 1
    else: fr += 1
print(f"gate-eligible examples {n} | verdicts agree {agree} ({100*agree/n:.1f}%) | false accepts {fa} | false rejects {fr} | approves cand {ca} ref {ra}")
