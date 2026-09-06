---
status: accepted
date: 2026-09-06
---

# A local judge qualifies by adjudicated parity, and its ratings are provisional until it does

An open-weights judge may own `vlm_eval` — and so rate the corpus that the fine-tuning filter reads — only once it has cleared a **qualification bar** whose deciding terms are settled by human Disagreement inspection, not by agreement with the stronger judge. We decided this while pushing qualification of the local judge forward (map *Eval harness for an open-weights judge*, issue #58), after measuring that the reference itself is wrong on a share of the items it disagrees with a local judge on (two of three inspected in #50), so that raw agreement with it is neither correctness nor model-independent.

## The bar

Measured on the fixed 125 examples, under the Instrument id the judge will run, against one run of the reference under the same id. The comparison script prints each term.

- **Completeness** (mechanical, zero tolerance): every example answered; no errors, truncations, missing checklists, item-count mismatches or follow-up parser fallbacks. Items still uncertain after the zoom cap are allowed; they fail at the gate.
- **Stability** (mechanical): a second run under the same Instrument id and settings agrees with the first at or inside the reference's own floor — hard pass/fail flips at or under 2.9% of items, identical items at or above 90%. Measured, and admitted ratings produced, under **sole tenancy**: nothing but the judge's own calls on its served name, one in flight per replica (#61: 0 flips alone, 3.3% with a chat session on the pool; #65: kept as an operational rule on the shared pool, verified from the usage log after each run — no separate deployment).
- **Correctness by adjudication** (the bar proper): on every item where the candidate and the reference disagree, a human decides who is right. The candidate's confirmed false passes must not exceed the reference's confirmed false passes (a tie passes), and its confirmed false fails must not exceed twice the reference's. A false pass admits a bad example to training; a false fail costs one example, so the two sides are weighed differently, but a judge cannot qualify by failing everything.
- **Throughput** is recorded (seconds per example, hours per corpus pass) and orders candidates; it does not gate.
- **Raw agreement** with the reference is recorded and produces the disagreement set; it does not gate.

Qualification is granted per **(Judge, Instrument id)**: a Judge is the model row, thinking setting included, and any instrument revision revokes it until the mechanical terms are re-run and the items whose answers changed are re-inspected. The serving deployment is recorded as a fact, not a gate. Qualification on the 125 is **provisional until the first re-rating batch is spot-checked**: 125 re-rated examples, the reference once under the same id, disagreements inspected, the adjudicated terms re-evaluated.

While no judge is qualified, `vlm_eval` is owned by the best candidate on the mechanical screen (completeness first, then the lowest false-pass rate against the reference, ties by seconds per example), and every rating it produces is **Provisional**: kept and gate-derived as usual, excluded from the fine-tuning filter until its judge qualifies, then admitted without re-rating. The list of qualified (Judge, Instrument id) pairs lives in code beside the Instrument, changed by reviewed diff with the qualification run and the adjudication sheet linked.

## Considered options

- **An absolute error cap** (confirmed errors at or under a fixed share of all items, e.g. the reference's 2.9% self-flip floor). Not rejected on principle — it may be added as a tightening — but its number is a guess until adjudication shows what the disagreement is made of, and the corpus is reference-rated today, so "no worse than the reference where a human can tell" is what preserves trust in the training set.
- **A raw agreement threshold** (hard flips at or under a multiple of the floor, no human step). Rejected: it is parity with one model, which the reference-standard decision withdrew, and a harness tuned only against that model inherits its blind spots by construction.
- **A symmetric error count**, direction ignored. Rejected: a false pass and a false fail are not equally costly.
- **Stability as a diagnostic only, or dropped** because thinking off, temperature 0 and guided JSON make runs near deterministic. Rejected: a judge less stable than the reference is not an instrument, and the second run is cheap.
- **A fresh 125** for the adjudication that counts, against overfitting to the set every harness lever was chosen on. Rejected in favour of the spot check on the first re-rating batch, which tests the corpus that matters rather than another synthetic selection.
- **Identity per model row only** (instrument revisions do not revoke) or **per deployment as well**. Rejected: the Instrument id already exists as the staleness key and the delta re-inspection is minutes; a redeploy is caught by the stability term.
- **Keeping the unmeasured production judge, or re-rating with the reference,** while unqualified. Rejected (the second already in ADR 0003): the interim ratings are useful if marked Provisional, and the corpus should be rated by the judge that will keep rating it.
- **An admin flag or a database table** for the qualified list. Rejected: admin-editable judge configuration is how 3,015 distinct prompts happened; a table written by script is defensible but adds a migration for what a reviewed constant records.
- **A throughput ceiling as a gating term** (corpus in three days). Rejected by Daniel: recorded and used for ordering; cost is the cluster's problem.

## Consequences

- Rows carry judge identity that distinguishes thinking settings; `provider/model_name` alone does not (the instrument work, #59, stamps it).
- The fine-tuning filter admits only rows that are current (ADR 0003) **and** rated by a Qualified judge (#62); at landing, every row rated so far by a local judge is Provisional.
  - *Amended 2026-09-06 (#62, at landing):* the two conditions gate judge-derived approvals only. A human's verdict is admitted whatever the rating beside it — the verdict is the human's, not derived from that rating, and the re-rating batch never overturns it, so gating it on the instrument would exclude it for good.
- The four-judge baseline under the old harness is superseded by the screen; self-consistency sampling is out of scope while the judge runs at temperature 0.
- The adjudication hour is spent once per candidate and instrument revision, on the qualification run's disagreements; the reference's confirmed errors from that sheet are the discount on every future parity number.
