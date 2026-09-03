---
status: accepted
date: 2026-09-03
---

# The verdict is derived from checklist items, not from the judge's score

The visual judge emits a 0–10 score and answers a checklist. The approval gate used to require both: composite score ≥ 7.5 *and* ≥ 80% of items passing. We decided that the **verdict is a function of the items alone** — every item must pass, across whichever evaluators answered them — and that the score is kept only as a diagnostic. Measured on the same 125 examples, Sonnet agrees with itself on 75% of scores but 90.6% of item answers (1.6% hard flips): the score is the noisy instrument, the item is the stable unit, and a local judge's scores track its own items more tightly than Sonnet's do, so its polarised scoring is an item problem wearing a score costume. Making items the gate makes "is the judge right" a question about objective answers that a human can check by looking, which is the reference standard the effort settled on (map: *Eval harness for an open-weights judge*, issues #45–#47).

## Considered options

- **Keep the hybrid.** Rejected: two units of measure in one decision, and it contradicts the reference-standard decision.
- **Items only, immediately.** Rejected for now: on 1,376 real-checklist rows, 88 examples pass every item yet fail today's score threshold, and those are precisely the cases where the judge found a requirement the checklist never asked about. Switching today would admit them to the training set.
- **Items are the gate; the score stays as a temporary backstop.** Chosen. The composite ≥ 7.5 remains beside the item gate until three conditions hold: dimension-bearing criteria are routed to code review as items; the coverage decision is resolved; the rate of issues that match no item on new evaluations is below an agreed level (about 5%). Then the score leaves the gate.

## Rules that travel with the decision

- Uncertain triggers a zoom follow-up; still uncertain afterwards, the item fails.
- Fewer than three items: the example is not gate-eligible and stays pending (292 examples, 21%, had one-item checklists; 251 were approved on that single answer).
- Code review answers the code-routed items as pass/fail rather than contributing a blended score.
- Any failed code assertion rejects, unconditionally, outside the item logic.
- `issues` and `suggestions` stay as diagnostics for the fix loop; an issue matching no item is logged as a coverage signal. Nothing is optional: a badly phrased criterion is fixed in coverage, not routed around in the gate.

## Consequences

- Verdicts are re-derivable. When the gate rule changes, approval is recomputed from stored item answers; the gate version is stamped on the row so mixed standards are visible, as `eval_checklist_state` already does for the harness.
- 979 approved rows have no stored item answers (issue #44) and cannot be re-derived; they are re-evaluated.
- A reader of the code will see a score still being produced and persisted. It is not consulted for approval once the backstop is removed; it exists for comparison and diagnosis. Do not "fix" that by putting it back in the gate.
