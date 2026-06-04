# Simplify Hard Prompts (sub-skill of improve-category)

Use when an `improve-category` run has hit Phase 5 saturation **or** completed 3 rounds without reaching the 90–95% target, and the remaining failures look like prompts that are either too vague or too compound for the agent to solve in one shot.

**Core mechanism: the agent proves its thesis by generating a simpler version of a stuck prompt and adding it to the category as a stepping-stone — never by editing the original.** The original prompt is preserved and re-run afterwards to see whether the agent can now build the full complexity on top of the simpler RAG example.

> Loaded by `SKILL.md` Phase 5.5. Do not invoke standalone — depends on auth, `$categoryId`, and the per-prompt eval data already gathered by the orchestrator.

## When this sub-skill applies

Trigger after Phase 5 when **both** are true:
- The 90–95% approval target was not reached
- Either the saturation signal hit (no sub-skills spawned, no new approvals), or 3 rounds completed

Skip this sub-skill if `research-missing-knowledge.md` was just run and the orchestrator hasn't yet re-tried a regen round with the new KB entries — give the new KB a chance first.

## Classify stuck prompts

For each pending prompt with `bestScore < 7.5` after Phase 5, pull the best example's eval issues and classify the failure mode:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
# Get the example detail to see issues + suggestions
curl -s "http://localhost/api/admin/workbench/examples/$bestExampleId" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; e=json.load(sys.stdin); print('issues:', e.get('evalIssues')); print('suggestions:', e.get('evalSuggestions')); print('score:', e.get('evalScore'))"
```

Map to one of four buckets:

| Bucket | Signal | Treatment |
|--------|--------|-----------|
| **Vague** | Eval issues mention "missing dimensions", "ambiguous", "assumed value"; prompt text lacks explicit measurements; agent's spec contains lots of `assumed_*` values | Add a simpler stepping-stone prompt that **fully dimensions** the core feature (drop the vague parts) |
| **Compound** | Prompt cleanly lists 3+ distinct features (e.g., base case + lid + standoffs + side cutouts + fan vent + side-by-side display); failing code attempts most of them but one or two collapse | Add a stepping-stone prompt that keeps **only the core feature** (e.g., the base case + standoffs), dropping decorative or assembly-display extras |
| **Unrealistic** | Eval issues mention geometric impossibility ("port cutout exceeds wall height", "standoff inside board outline"); dimensions don't physically fit | Should have been caught by **Phase 2.5 validate-prompts**; if it surfaces here, the gate missed it. Flag for the user with a note that the prompt needs Phase 2.5-style repair, do not generate a stepping stone |
| **Composable-but-hard** | Well-specified, dimensions plausible, eval issues mention "missing fillet", "wrong corner orientation" — small details, agent got 90% right | NOT a simplify candidate; let the orchestrator stop and report. Further regens are diminishing returns |

Only the **Vague** and **Compound** buckets are actionable here. Build the candidate list as a markdown table and present it before generating anything:

```
| Prompt # | bucket    | original score | simplification thesis |
|----------|-----------|----------------|-----------------------|
| #14      | Compound  | 4.0            | Drop PoE HAT stacking and fan vent; keep base case + standard cutouts |
| #27      | Vague     | 5.0            | Wemos D1 Mini case fully dimensioned: 38×30×15 walls 2mm, M2 standoffs 4mm tall, micro-USB cutout 8×3mm |
| #62      | Vague     | 6.4            | Add explicit wall thickness, lid thickness, standoff diameter to the existing minimum-text prompt |
```

Cap at **3–5 candidates per round** — each one costs a generation (~$0.20), and the re-run of originals costs another generation each.

## Draft the simpler prompt

For each candidate, write a new prompt that:

1. **Preserves the core technique** of the original. The point is to give RAG a working example the agent can compose on top of. A simplified PCB Cases prompt should still be a PCB case (hollow box + standoffs + ≥1 port cutout + lid), not a different category.

2. **Removes only the parts that pushed it over the edge.** Common removals:
   - Multi-part assembly positioning ("side by side, 20mm gap", "exploded view") → leave as a single assembled object
   - Stacked HATs / accessories → keep the base board only
   - Decorative features (fan vents, ventilation slots, logo cutouts) → drop
   - Non-standard cutouts → use the standard cutout size from the connector KB
   - Compound dimension constraints ("10mm taller to accommodate X") → use a fixed value

3. **Adds explicit dimensions** for anything the original left ambiguous. Wall thickness, lid thickness, standoff height/diameter, cutout sizes, board offset above floor, gap between board and lid, etc. Pull values from KB reference entries when possible.

4. **Names the stepping stone in the description.** Use a description like `Stepping stone for prompt #14: base case without PoE/fan to anchor RAG. The original requires both stacked-board height accommodation and lid fan vent.` so future readers know why the simpler prompt is there.

5. **Is short.** 1–3 sentences. The intent is RAG signal, not training data variety.

Example for PCB Cases:

> **Original (#27, score 5.0):** "A Wemos D1 Mini case. The board is 34mm × 25mm. The case has 2mm standoffs at the four corners; micro-USB cutout on the short end. Display as an exploded view with all parts on the same vertical axis and a 15mm gap between them."
>
> **Simplification:** "A Wemos D1 Mini enclosure: rectangular box 38mm × 30mm × 12mm with 2mm walls. Four M2 standoffs 4mm tall at the corners (hole positions 23.62mm × 17.78mm spacing from PCB datasheet). One micro-USB cutout 8mm × 3mm centered on a short side, 3mm above the floor. Flat lid 38mm × 30mm × 2mm sitting on top of the case (assembled view)."

The simpler version: drops the exploded-view assembly, adds wall thickness, adds lid thickness, sets a fixed case height, fixes standoff diameter (M2) and height (4mm) and corner offset (from the Wemos D1 Mini KB entry), pins the cutout size and position.

## Test the simplification

For each drafted simplification, **add it to the category and generate once**:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
CID="<the category id>"

# 1. Add the simpler prompt to the category
ADD_RESP=$(curl -s -X POST "http://localhost/api/admin/workbench/categories/$CID/prompts" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"prompts\": [\"<simpler prompt text>\"]}")
NEW_ID=$(echo "$ADD_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prompts',[{}])[0].get('id') or d.get('promptIds',[None])[0])")

# 2. Generate a single example for it (one-at-a-time, watch the job)
JOB_RESP=$(curl -s -X POST "http://localhost/api/admin/workbench/generate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"promptId\": \"$NEW_ID\"}")
JOB_ID=$(echo "$JOB_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])")
# poll $JOB_ID until completed (same pattern as orchestrator)
```

Then read back the result and classify:

```bash
curl -s "http://localhost/api/admin/workbench/categories/$CID/prompts" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json, os
data = json.load(sys.stdin)
prompts = data if isinstance(data, list) else data.get('prompts', [])
p = next((x for x in prompts if x['id'] == os.environ['NEW_ID']), None)
print(f\"score={p.get('bestScore')} approval={p.get('bestApproval')}\")"
```

- **Pass (auto_approved or score ≥ 7.5):** thesis confirmed for this simplification. Keep the new prompt in the category — it is now a permanent stepping stone in the curriculum and a RAG example for the original.
- **Fail (score < 7.5):** the simplification still wasn't simple enough, OR the failure isn't about composition complexity. Note it but do not iterate further this round — drop the new prompt out of the candidate list and report it.

## Re-run the original

For every simplification that passed, re-run the **original** prompt once. The new simpler example is now in RAG, so the agent gets a working scaffold to extend.

```bash
ORIG_JOB=$(curl -s -X POST "http://localhost/api/admin/workbench/generate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"promptId\": \"$ORIGINAL_ID\"}")
# poll, then read the new bestScore for the original
```

Record: did the original's `bestScore` improve, stay flat, or go down? Did it flip to `auto_approved`?

**Critical: the original prompt's text is never altered.** Only its examples are regenerated. Curated prompts are immutable from this sub-skill's perspective.

## Report

Hand back to the orchestrator a markdown report shaped like:

```
## Simplification round — <N candidates tested>

| # | Original prompt    | bucket   | orig score | simpler prompt added             | simpler score | original re-run score | net effect |
|---|--------------------|----------|------------|----------------------------------|---------------|-----------------------|------------|
| 1 | #14 PoE HAT case   | compound | 4.0        | base case w/o HAT, fan vent      | 8.0 ✓         | 6.5 (was 4.0)         | improved   |
| 2 | #27 Wemos D1 Mini  | vague    | 5.0        | fully dimensioned base+lid       | 8.5 ✓         | 7.8 (was 5.0) ✓auto   | promoted   |
| 3 | #62 Orange Pi case | vague    | 6.4        | added wall+lid+standoff dims     | 5.0 ✗         | 6.4 (unchanged)       | failed     |

Stepping stones added: 3 new prompts (now part of the category curriculum)
Originals promoted: 1 (#27)
Originals improved but not promoted: 1 (#14)
Originals unchanged: 1 (#62)

Manual review needed for:
- #62: simpler version also failed — likely composition issue, not simplification target. Recommend marking as Composable-but-hard or rejecting from the curriculum.
- #38, #71: classified as Unrealistic during candidate selection. Dimensions don't fit physically; require human edit.
```

## What NOT to do

- **Do not edit any existing prompt text.** Curated content is immutable from this sub-skill. The orchestrator may still call `PATCH /workbench/prompts/:id` for other reasons, but this sub-skill only adds new prompts.
- **Do not delete the simpler prompts after testing.** They are now part of the curriculum. They help future generation runs and serve as RAG anchors for the harder prompts.
- **Do not iterate on a failing simplification within the same round.** If the simpler version also scored <7.5, the failure isn't composition complexity — additional simplification attempts will burn cost without insight. Report and move on.
- **Do not draft simpler prompts that change the category's theme.** A PCB Cases simplification stays a PCB case. A Boolean Operations simplification stays a boolean operation. Don't pivot to a different problem.
- **Do not run more than 5 simplifications per round.** Each one costs ~2 generations (~$0.40). Cap to keep cost predictable.

## Stop conditions for this sub-skill

Hand back to the orchestrator when:
1. All candidates in the round (≤5) have been tested with simpler-version + original-re-run, OR
2. The first 3 simpler prompts all failed (score <7.5) — strong signal that the failure mode isn't compositional and this sub-skill cannot help further; stop and report.

The orchestrator decides whether the resulting approval-rate improvement warrants another `improve-category` round or whether to stop and report final state to the user.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Simpler prompt changes the category's domain (e.g., "case" → "plate") | Keep the same nominal object; remove features only |
| Dropping the feature the prompt was actually testing (e.g., simplifying a "with cutout" prompt by removing the cutout) | Identify the test target before drafting; remove around it, not through it |
| Adding the simpler prompt to a different category | The simpler prompt belongs in the **same category** as the original — it's a stepping stone for that curriculum slot |
| Treating a `Composable-but-hard` failure as a simplification candidate | If the prompt scored 7.0–7.4 and eval issues are detail-level (fillet, edge orientation), simplification won't help — these need targeted-fix-loop, not stepping stones |
| Editing the original prompt to "match" the simpler version | Originals are immutable here. They get re-run only |
| Generating 10+ simpler prompts in one round | Cap at 5; cost balloons quickly and the saturation signal will tell you faster |
