# Validate Prompts (sub-skill of improve-category)

Use as a **gate** before the rest of the improvement workflow. Detects prompts that are dead ends — contradicting instructions, physically impossible geometry, or unresolvable ambiguity — and proposes targeted fixes or rejection for user approval.

**This is the ONE exception to the "never alter existing prompt text" rule.** Invalid prompts cannot be salvaged by KB research or stepping stones; they will fail forever. Either repair them (small edit) or remove them from the curriculum. All actions require explicit user confirmation.

> Loaded by `SKILL.md` Phase 2.5. Runs after Phase 2 re-evals so fresh eval issues are available as signal. Do not invoke standalone — depends on auth and `$categoryId` already resolved.

## When this sub-skill applies

Trigger after Phase 2 re-evals, **before** Phase 3 gap analysis, when any of these are true:

- ≥1 prompt scored <5 in the latest evals
- Eval issues across the category mention `contradict`, `contradiction`, `impossible`, `exceeds`, `doesn't fit`, `cannot fit`, `geometric impossibility`, `no valid geometry`, `larger than the part`, `inside the board outline`, `wall too thin`, `ambiguous` paired with `fundamental`/`unresolvable`
- A prompt's text contains an obvious internal contradiction visible without generation (caught in the optional pre-pass below)

If none of these apply, **skip this phase** and continue to Phase 3 — most categories have no invalid prompts.

## Two-pass detection

**Pass 1 — Text-only pre-check (optional, run before Phase 1.5 if many prompts have 0 examples).** For each prompt without examples, read the prompt text and look for:
- Self-contradicting dimensions: "10mm tall box with 25mm interior", "50×50 face on a 40×40 block", "5mm hole through a 3mm cylinder"
- Mutually exclusive states: "fully closed enclosure" + "fully open top", "solid block" + "hollow interior" with no transition
- Underspecified anchoring references: "fits a Raspberry Pi" with no model (which Pi?), "standard PCB" with no dimensions
- Implausible thicknesses: walls <0.4mm (below FDM minimum), standoffs <2mm diameter for M2.5 screws

This pass catches blatant cases cheaply, saving the ~$0.20 per blatant-fail generation in Phase 1.5.

**Pass 2 — Eval-informed check (the main pass, after Phase 2 re-evals).** For each prompt with `bestScore < 5` OR whose best example's eval issues match the keyword list above:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
curl -s "http://localhost/api/admin/workbench/examples/$bestExampleId" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
e = json.load(sys.stdin)
print('--- eval issues ---'); [print(f'  - {i}') for i in e.get('evalIssues') or []]
print('--- eval suggestions ---'); [print(f'  - {s}') for s in e.get('evalSuggestions') or []]
print('--- spec assumed values ---')
spec = e.get('spec') or {}
for k, v in (spec.get('assumedValues') or {}).items(): print(f'  {k}: {v}')
"
```

Read prompt text + eval issues together. Classify the prompt as one of:

| Bucket | What it looks like | Action |
|--------|--------------------|--------|
| **Valid** | Eval issues are about composition or details, dimensions are consistent and physically realizable | Continue normal flow; no action |
| **Repairable** | One identifiable contradiction or missing dimension with an obvious correct value (typo, swapped numbers, missing wall thickness) | Draft a minimal-diff fix; present to user; on confirmation `PATCH /workbench/prompts/:id` |
| **Reject** | Fundamental conflict (two requirements that cannot both hold), physical impossibility, or ambiguity so deep that fixing it would change what the prompt asks | Propose removal or rejection-flag; present to user; on confirmation `DELETE /workbench/prompts/:id` |
| **Needs Input** | Genuinely ambiguous but salvageable with one clarifying choice (which board model? which port layout?) | Ask the user the single clarifying question; on answer, draft a Repairable-style fix and confirm |

## Drafting a Repairable fix

The fix is the **smallest possible edit** that resolves the contradiction. Do not rewrite the prompt — preserve voice, structure, and every detail not implicated in the conflict.

Examples:

| Original (broken) | Issue | Minimal fix |
|-------------------|-------|-------------|
| "A box 50mm × 50mm × 10mm with a 25mm-tall standoff inside" | Standoff height exceeds box interior (10mm box, 25mm standoff) | Change box height to `30mm` (next sensible round number ≥ 25mm + lid clearance) OR change standoff to `8mm` (just shy of interior). Pick the change that preserves the prompt's evident intent — if the prompt is about "tall standoffs", grow the box; if it's about "shallow case", shrink the standoffs. State the assumption in the fix proposal. |
| "Raspberry Pi case with USB-C cutout 7mm wide and Ethernet cutout 17mm wide on the same 3mm-tall wall edge" | Both cutouts exceed wall height | Increase the wall height to `≥16mm` (Ethernet 15mm + 1mm safety) so both cutouts fit |
| "Wemos D1 Mini case with 0.2mm walls" | Walls below FDM minimum (~0.4mm) | Raise walls to `2mm` (the project's standard from existing PCB Cases prompts) |
| "Fits a Raspberry Pi" (no model) | Underspecified anchoring | Ask user "which Pi model?"; on answer, edit to "Fits a Raspberry Pi 4 Model B" (Needs Input → Repairable) |

A fix proposal table goes to the user **before** any PATCH is issued:

```
| # | Prompt # | Issue                                         | Proposed minimal edit                                     | Bucket     |
|---|----------|-----------------------------------------------|-----------------------------------------------------------|------------|
| 1 | #38      | Box height 10mm < standoff 25mm               | Change "10mm" → "30mm" in the height field                | Repairable |
| 2 | #71      | USB-C cutout exceeds wall (7mm vs 3mm wall)   | Change "3mm walls" → "8mm walls" (USB-C 7mm + 1mm safety) | Repairable |
| 3 | #14      | "Fully closed + open top" contradiction       | Remove "fully closed" — the lid description implies open  | Repairable |
| 4 | #92      | "PCB case for any board" — no board specified | Needs Input: which board model?                           | Needs Input|
| 5 | #57      | Solid block AND hollow interior with no transition geometry described — would require complete rewrite to resolve | Propose removal from curriculum                            | Reject     |
```

## Applying changes (only after user confirmation)

For each row the user approves:

**Repairable:**
```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
curl -s -X PATCH "http://localhost/api/admin/workbench/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"prompt\": \"<corrected prompt text>\"}"
```

After a PATCH, delete the existing examples for that prompt (they were generated against the broken text):
```bash
curl -s -X DELETE "http://localhost/api/admin/workbench/prompts/$PROMPT_ID/examples" \
  -H "Authorization: Bearer $TOKEN"
```

The orchestrator's later phases will generate fresh examples.

**Reject:**
```bash
curl -s -X DELETE "http://localhost/api/admin/workbench/prompts/$PROMPT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

This removes the prompt from the curriculum entirely so it stops counting against the approval rate. If the user wants to keep the prompt for audit but exclude it from active runs, propose adding a "rejected" tag instead and skip the DELETE — leave that decision to the user.

**Needs Input:**
Ask the single clarifying question, wait for the user's answer, then either follow the Repairable path or the Reject path based on the answer.

## After validation

1. **Re-fetch the prompt list** — the dataset changed if anything was PATCHed or DELETEd.
2. **Recompute approval rate and score histogram** — removed prompts are no longer in the denominator; PATCHed prompts have no example yet (Phase 1.5 will regenerate).
3. **Loop back to Phase 1.5** to generate examples for PATCHed prompts before moving forward, OR continue to Phase 3 directly if no PATCHes happened.

## What NOT to do

- **Do not PATCH or DELETE without user confirmation.** Curated content is human-authored; even repairs are proposals.
- **Do not rewrite prompts beyond the minimal-diff fix.** The job here is resolving the conflict, not improving the prompt's clarity or style. Phase 5.5 (`simplify-hard-prompts`) handles complexity reduction; it does that by adding new prompts, not editing existing ones.
- **Do not classify a prompt as Reject just because its score is low.** Low score might be composition or KB problem. Only mark Reject when the prompt itself cannot succeed regardless of generation quality.
- **Do not use this sub-skill to clean up curated prompts.** Validation is for invalid prompts only. A prompt that scores 7.5 and asks for an "exploded view" is not invalid — it's hard, and Phase 5.5 handles that.
- **Do not loop.** One validation pass per `improve-category` run. If the user rejects a proposed fix, defer to Phase 7's "Unresolved follow-ups" section in the final report.

## Stop conditions for this sub-skill

Hand back to the orchestrator when:
1. All flagged prompts have a user decision (apply, reject the fix, or defer), OR
2. No flagged prompts in Pass 2 → no action needed, return immediately, OR
3. User declines to review the list → return with all flagged prompts moved to "Unresolved follow-ups" for Phase 7.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Treating "low score" as "invalid" | Only mark invalid when the prompt's text itself contains the conflict, not when generation quality is poor |
| Editing more than the conflicting detail | One conflict, one minimal edit. If multiple conflicts, propose separate edits in the table so the user can approve each |
| Skipping the example deletion after PATCH | Stale examples from the broken prompt skew the next round's metrics |
| Confusing `Vague` (Phase 5.5) with `Repairable` (Phase 2.5) | Vague = underspecified but possible to attempt (stepping-stone helps). Repairable = the prompt actively conflicts with itself or with physics (must be fixed before any further work) |
| Asking many clarifying questions in one batch | Ask only the questions that resolve a `Needs Input` bucket. Don't expand scope into "let me also clean up the wording while I'm here" |
| Running validation every round | Once per `improve-category` run, at the gate. Subsequent rounds assume the prompts that survived are valid |
