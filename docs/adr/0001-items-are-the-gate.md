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
  - *Amended 2026-09-08 (#44):* the zero-item case landed first, on its own — with no stored items there is no verdict to derive, whether the prompt asked nothing, the judge did not answer, or the answers were lost, so the row stays pending; before this the gate approved such rows on score alone. A failed render is likewise never gate-eligible, and every caller now says whether its render succeeded. The one-to-two-item rule and the gate version stamp follow with the gate itself (#88).
- Code review answers the code-routed items as pass/fail rather than contributing a blended score.
- Any failed code assertion rejects, unconditionally, outside the item logic.
- `issues` and `suggestions` stay as diagnostics for the fix loop; an issue matching no item is logged as a coverage signal. Nothing is optional: a badly phrased criterion is fixed in coverage, not routed around in the gate.

## Amendment 2026-10-05: structural items gate first (#114)

A feature question about the wrong object is unanswerable, and the judge's answer to it is noise the gate then counts. Daniel's example: a U-channel whose cover was fused into it, asked about its lip. So the items are no longer equal.

- **Structural items** are a checklist item's first class: how many separate bodies, whether parts the request names separately are separate, which parts are connected, and whether the overall shape is recognisably the requested object. The spec generator marks each atom `role: structural | feature`; everything not structural is a feature.
- **The body count is measured, not judged.** The spec states the expected number of separate bodies (1 when the request names no separate parts), and the count is read from the model file. A mismatch is a structural fail decided by the measurement. It is the first fact of the geometry route.
- **One judge call**, structural questions first. **Only a structural item answered "fail" cascades:** the example's feature items become **Not assessable** and their zoom follow-ups are skipped. The verdict fails on the structural item alone. A structural item still *uncertain* after its zoom fails as the rule above says, but does **not** cascade, so a judge unsure of a count cannot void a whole checklist.
- **Not assessable is the Gate's treatment, never a judge's answer:** a flag on the item, the raw answer kept for diagnosis, not counted by the Gate, and never a training label. The failed structural item stays an ordinary label.
- **The fix loop** hears only the structural failure when there is one, so the codegen agent learns what is fundamentally wrong before any feature complaint.
- **It changes the judge's procedure, so it is an instrument revision.** It ships in one revision with the orientation contract (ADR 0007), with rc0 re-qualified on the Measurement set before the corpus is re-rated. Existing prompts get the role marks, the expected body count and the Orientation declaration by a marking pass, not a regeneration (#114).

## Consequences

- Verdicts are re-derivable. When the gate rule changes, approval is recomputed from stored item answers; the gate version is stamped on the row so mixed standards are visible, as `eval_checklist_state` already does for the harness.
- 979 approved rows have no stored item answers (issue #44) and cannot be re-derived; they are re-evaluated.
- A reader of the code will see a score still being produced and persisted. It is not consulted for approval once the backstop is removed; it exists for comparison and diagnosis. Do not "fix" that by putting it back in the gate.
