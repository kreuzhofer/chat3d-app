# Research From Failures (sub-skill of improve-category)

Use when Phase 5.5 stepping stones have failed (3 of 3 simpler variants scored <7.5) **or** when Phase 5 hit saturation and no Phase 5.5 candidates exist (e.g., all remaining failures are Composable-but-hard). Discovers sub-pattern KB gaps from the **eval issues of failing examples** — the same research+add+validate flow as `research-missing-knowledge.md`, but with a different discovery trigger.

**Key distinction from `research-missing-knowledge.md`:**

| Sub-skill | Discovery trigger | When |
|---|---|---|
| `research-missing-knowledge.md` | Entity extraction from **prompt text** | Phase 3.5 (upfront, before regen) |
| `research-from-failures.md` | Pattern clustering across **eval-issue strings** | Phase 5.7 (after Phase 5/5.5 saturation) |

Same downstream pipeline: search build123d corpora → research authoritative sources → author Cookbook entries → validate → embed → spot-check retrieval.

> Loaded by `SKILL.md` Phase 5.7. Do not invoke standalone — depends on auth, `$categoryId`, and the eval-issue data from saturated prompts.

## When this sub-skill applies

Trigger after Phase 5 or Phase 5.5 hit saturation **and** at least one of these is true:

- Multiple still-pending prompts share **recurring eval-issue keywords** (≥3 prompts mention similar sub-pattern failures: "hinge segments not connected", "exploded gap arithmetic", "face after subtraction", "hex pattern", "ribbon cable slot", etc.)
- Phase 5.5 stepping stones all failed (signals composition isn't the bottleneck; it's a specific missing idiom)
- Phase 5 had zero sub-skills spawned **but** there are still many in-scope failures — the spec LLM's decomposition heuristic missed the gap; this sub-skill catches what decomposition missed

Skip when:
- The dominant failures are visual / VLM-eval false negatives (cosmetic issues, not code issues) — KB additions can't fix VLM problems
- Eval issues are all dimension-level (`[PARAM]` or `[CODE]`-tagged numeric mismatches) with no idiom-level pattern — those are agent-execution bugs, not KB gaps
- All in-scope prompts have heterogeneous failures (every prompt's issues are unique) — no cluster forms; researching one-offs is too expensive

## Step 1: Collect eval issues

Pull `evalIssues` + `evalSuggestions` for every in-scope prompt (`bestApproval ∈ {pending, rejected}` AND `bestScore < 7.5`):

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
python3 <<'PY'
import json, subprocess, os
tok = os.environ['TOKEN']
cid = os.environ['CATEGORY_ID']
# Fetch in-scope prompts
r = subprocess.run(
    ['curl','-s',f'http://localhost/api/admin/workbench/categories/{cid}/prompts',
     '-H',f'Authorization: Bearer {tok}'],
    capture_output=True, text=True
)
data = json.loads(r.stdout)
prompts = data if isinstance(data, list) else data.get('prompts', [])
def fnum(v):
    try: return float(v)
    except: return None
in_scope = [p for p in prompts if p.get('bestApproval') in ('pending','rejected') and (fnum(p.get('bestScore')) or 99) < 7.5]

issues_corpus = []
for p in in_scope:
    eid = p.get('bestExampleId')
    if not eid: continue
    er = subprocess.run(
        ['curl','-s',f'http://localhost/api/admin/workbench/examples/{eid}',
         '-H',f'Authorization: Bearer {tok}'],
        capture_output=True, text=True
    )
    e = json.loads(er.stdout)
    for i in (e.get('evalIssues') or []):
        issues_corpus.append({
            'prompt_id': p['id'],
            'prompt_excerpt': (p.get('prompt') or '')[:140],
            'issue': str(i),
        })

with open('/tmp/p57-issues-corpus.json','w') as f:
    json.dump(issues_corpus, f, indent=2)
print(f'Collected {len(issues_corpus)} issues across {len(in_scope)} in-scope prompts')
PY
```

Typical scale: 50 in-scope prompts × 3-10 issues each = ~200-500 issue strings.

## Step 2: Cluster issues (LLM, no API cost — done by the orchestrator)

The orchestrator (you) reads `/tmp/p57-issues-corpus.json` and produces a JSON cluster summary **as part of its thinking**, not via a separate API call:

```
For each cluster, identify:
{
  "pattern_name": "short kebab-case identifier",
  "description": "one-line explanation of the missing idiom",
  "example_issues": ["verbatim issue 1", "verbatim issue 2", ...],
  "prompt_ids": [<list of prompt IDs that exhibited this pattern>],
  "frequency": <count of prompts mentioning this pattern>
}
```

**Clustering rules:**
- Match on the underlying **sub-pattern**, not on board name or specific dimensions. "Standoffs floating outside box" + "standoffs detached" + "standoffs not visible" → all the same pattern (`integrated-standoff-attachment`)
- Cluster only when ≥3 distinct prompts share the pattern (signal threshold)
- Cap at top **5 clusters** by frequency (cost bound)
- Discard `[PARAM]` and dimensional `[CODE]` issues during clustering — those are agent-execution bugs, not idiom gaps. Keep narrative/structural issues only

Write the cluster summary to `/tmp/p57-clusters.json` and present it to the user as a table before researching anything:

```
| # | Pattern                              | Freq | Example issue (one per cluster)                                |
|---|--------------------------------------|------|----------------------------------------------------------------|
| 1 | multi-layer-exploded-view-gaps       | 6    | "Assembly gaps between parts are inconsistent: 47mm vs 17mm"   |
| 2 | hinge-mechanism-interlocking-knuckles | 4    | "hinge barrels not geometrically mated; assembly cannot rotate" |
| 3 | face-reselection-after-subtraction   | 3    | "front_face2 re-acquired after extrude(SUBTRACT); topology unsafe" |
```

## Step 3: Research each cluster

For each cluster, follow the **idiom path** from `research-missing-knowledge.md` Step "Research a build123d idiom":

1. **Search the KB first** for terms matching the pattern (`hinge`, `exploded view`, `face selector`, etc.):
   ```bash
   curl -s "http://localhost/api/admin/knowledge?search=<term>&limit=10" -H "Authorization: Bearer $TOKEN"
   ```
   If a relevant entry exists but didn't surface for the failing prompts, that's a **retrieval problem** — re-title/re-describe the existing entry with richer keywords rather than authoring a new one.

2. **Search build123d sources externally**:
   ```bash
   gh search code --repo gumyr/build123d --extension py "<pattern>"
   gh search code --repo gumyr/bd_warehouse --extension py "<pattern>"
   ```
   Plus WebSearch `"build123d <pattern> example"` filtered to `site:github.com OR site:build123d.readthedocs.io`.

3. **Author a minimal working example** (Cookbook entry). **Critical anti-drift requirements** — observed failure mode on 2026-06-04: cookbook entries carrying concrete connector dimensions (USB-A 13.5mm, HDMI 14mm, etc.) pulled the agent's attention away from the prompt's own spec dimensions, causing the new attempt to score worse than the existing best. The rules below are designed to prevent this drift:
   - **Use generic parameter names** (`port_w`, `port_h`, `board_w`, `board_d`, `wall`, `case_h`) — never a name that implies a specific component (`usb_c_w`, `hdmi_h`)
   - **Mark every concrete dimension as an example** with an inline comment: `port_w = 13.5  # example value — replace with prompt spec` and `# Substitute the prompt's own dimensions when using this idiom.` at the top of the parameters block
   - **Avoid burying connector/fastener dimensions inside idiom entries** — those live in the `Connector & Fastener Dimensions` reference source and are pre-retrieved by keyword. Idiom entries should demonstrate the STRUCTURE and ARITHMETIC, not carry authoritative numbers
   - <60 lines, executable, algebra mode preferred (matches the existing PCB enclosure idiom format)
   - Title is keyword-rich and matches eval-issue phrasing — e.g., `"Hinge mechanism with interlocking knuckles (rotating joint)"`, `"Multi-layer exploded view: stacking parts along Z with consistent gap arithmetic"`
   - Description lists: the pattern, the symptoms it solves, the build123d operations used
   - **Description must end with the mandatory anti-drift guard sentence (verbatim):** *"Use the idiom and arithmetic shown; substitute the prompt's own dimensions throughout — concrete numbers below are illustrative, not normative."*
   - Cite source if adapted from an existing example

4. **POST to Cookbook** source:
   ```bash
   curl -s -X POST "http://localhost/api/admin/knowledge/entries" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"sourceId":"<cookbook id>","title":"...","code":"...","description":"..."}'
   ```

## Step 4: Validate and embed

```bash
# Validate (runs syntax + build123d execution)
curl -s -X POST "http://localhost/api/admin/knowledge/validate" -H "Authorization: Bearer $TOKEN"
# Embed
curl -s -X POST "http://localhost/api/admin/knowledge/embed" -H "Authorization: Bearer $TOKEN"
```

Poll both jobs via `/api/admin/knowledge/jobs/:id`. If an entry **fails validation**, drop it from the candidate list (do not push broken code into the KB). If all 5 fail, stop the sub-skill and surface to the user — the proposed patterns aren't realizable as minimal examples.

## Step 5: Auto-loop back to Phase 5 once

**This is the key feedback loop.** After embedding new entries, the orchestrator automatically runs **one additional Phase 5 round** against the saturated candidates with the new RAG. Cap: one loop per `improve-category` run, no nesting.

Loop-back round selection:
- Re-run the in-scope prompts whose eval issues clustered into the patterns we just added (max 6 per round, same as a normal Phase 5 round)
- Apply the same stop conditions as Phase 5 (target reached / saturation / 3-round equivalent cap; here just one round)
- Capture before/after delta per prompt for the report

## Report

Hand back to the orchestrator a markdown block shaped like:

```
## Phase 5.7 — Failure-driven KB additions

| # | Cluster                              | Freq | KB entry added                         | Validation | Loop-back delta             |
|---|--------------------------------------|------|----------------------------------------|------------|------------------------------|
| 1 | multi-layer-exploded-view-gaps       | 6    | "Multi-layer exploded view assembly"   | passed     | 2/3 retried prompts flipped  |
| 2 | hinge-mechanism-interlocking-knuckles | 4    | "Hinge mechanism (rotating joint)"     | passed     | 1/3 retried prompts flipped  |
| 3 | face-reselection-after-subtraction   | 3    | "Persistent face selection across booleans" | passed | 0/3 retried prompts flipped |

Approval rate: 52% → 56% (+3 from loop-back)
Cost: ~$1.10 (5 generations × $0.20 + embed)
```

## What NOT to do

- **Do not invent patterns.** If a cluster's example issues don't form a coherent build123d operation, drop it. Authoring made-up examples pollutes the KB.
- **Do not loop more than once.** A second loop-back would invite cost runaway; saturation after one loop means stop and report.
- **Do not author entries that duplicate existing KB content.** Re-title/re-describe the existing entry instead (`PATCH /api/admin/knowledge/:id` with `title` and `description`).
- **Do not include dimensional bugs in clusters.** `[PARAM] height=3 expected==25` is the agent miscalculating, not a missing idiom. Filter those out in Step 2.
- **Do not skip validation.** A non-executing Cookbook entry teaches the agent broken code. The endpoint runs in a sandbox; let it reject bad entries.
- **Do not author for prompt-specific issues.** "Ribbon cable slot offset by 3mm in this Pi camera prompt" is one-off, not a pattern. Cluster threshold is ≥3 distinct prompts.

## Stop conditions for this sub-skill

Hand back to the orchestrator when:
1. All ≤5 clusters processed (entries added or dropped) and loop-back round completed, OR
2. Zero clusters cleared the ≥3-prompt threshold → no action, return immediately, OR
3. All proposed entries failed validation → return with the failed list noted in the final report.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Clustering by prompt board name ("all Arduino failures") instead of by sub-pattern | Cluster on the **structural** issue (hinge, exploded view, face reselection), not the entity that contained it |
| Authoring a "PCB Cases" generic example that overlaps the existing Phase 3.5 entry | Phase 3.5 entry covers the BASE composite. This sub-skill covers SPECIFIC sub-patterns that base entry doesn't show |
| Including dimensional mismatches in clusters | Filter `[PARAM]` and pure numeric `[CODE]` issues during Step 2 — those are calculation bugs |
| Looping back twice "to see if it converges" | One loop-back per run. The skill caps cost deliberately. If saturation persists, surface to user |
| Authoring entries from a single failing prompt's issues | ≥3 distinct prompts. Single-prompt issues are noise, not signal |
| **Cookbook example carries concrete dimensions (USB-A 13.5mm, HDMI 14mm)** | Mark every concrete number as illustrative via inline comment. Use generic parameter names. End the description with the mandatory anti-drift sentence. Verified failure on 2026-06-04: a Blue Pill prompt regressed from score 7 → 3 because the agent copied USB-A example dimensions instead of the prompt's USB-C spec. |
| Authoring entries that duplicate connector/fastener dimensions already in the reference KB | Keep idiom entries dimension-agnostic where possible. Connector & Fastener Dimensions are pre-retrieved by keyword; idiom entries should be about STRUCTURE and ARITHMETIC, not authoritative numbers |
