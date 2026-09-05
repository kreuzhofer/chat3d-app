---
status: accepted
date: 2026-09-05
---

# One instrument, identified by a content hash of the whole procedure

The visual judge answers under **one Instrument**, kept in code and pinned by golden tests, and every stored evaluation carries an **Instrument id**: a name plus a content hash of the whole judging procedure — the template, the response schema, the zoom follow-up prompt and its settings. Two evaluations are comparable only under the same id; one whose id is not current is **Stale**. We decided this after measuring that 3,228 stored evaluations had been produced under 3,015 distinct system prompts, so that no two scores in the corpus were known to be comparable and no judge could be compared with another without the prompts differing too (map *Eval harness for an open-weights judge*, issue #36; the instrument/specimen split itself landed under #35).

## What changes

- **One instrument.** The legacy monolith is the instrument. The eval-plan template goes; the plan's per-prompt judge instructions are no longer sent to the judge (instructions belong in the instrument, facts in the specimen — ADR 0002). The per-model preamble slot and the never-rendered zoom-tool block are deleted, not kept as options.
- **The same eight views, always.** Front, back, left, right, top, bottom, 45° down, 45° up, for every entry point. The orchestrator's narrowing by eval-plan angles and the code reviewer's "critical angles" stops; the agent path stops sending its isometric view. Same example, same views, by construction rather than by recording.
- **An id on every row.** `workbench_examples` and `vlm_experiment_results` record the Instrument id; production's name is fixed, an experiment's is its variant id. The hash covers template, schema, follow-up prompt and zoom settings, so a forgotten version bump cannot happen and an admin edit to a zoom setting is a new revision. Rows from before ids existed keep `null` and read as pre-versioning.
- **Stale by id.** A stored verdict whose id is not current is flagged, excluded from the fine-tuning filter and from any reference set, and re-rated as scheduled batch work by the judge `vlm_eval` points at — the gate-version pattern of ADR 0001, applied to the instrument.
- **The evidence clause ships in the first revision** (each item's detail names the views checked and what was seen; measured in #50 at 78% → 98% compliance and no cost). An evidence-first key order in the response schema is measured on the fixed 125 before it ships.

## Considered options

- **Keep two instruments and version both.** Rejected: the plan instrument served 1% of prompts and differed from the legacy one in more than the plan; two code paths building the instrument were themselves a source of drift.
- **Plan text as a specimen slot.** Rejected: it is instructions, restating checklist items in the spec LLM's words; a per-prompt instruction is exactly what must not vary.
- **A hand-bumped version constant.** Rejected: readable but forgettable; a hash of the procedure cannot be forgotten and changes only when the procedure does.
- **An admin-editable instrument in the database.** Rejected: editable text is how 3,015 distinct prompts happened. Changes are a reviewed diff with a failing golden test as the gate, tried first as an experiment variant.
- **Keep view filtering and record the set.** Rejected: it coupled the judge's input to another judge's output and to the entry point; recording a confound is weaker than removing it.
- **Re-rate stale rows with the reference judge.** Rejected by Daniel in favour of the production judge, with qualification of a local judge pushed now (issue #58) so the corpus is rated by the judge that will keep rating it.

## Consequences

- Every existing rating becomes Stale the moment the first revision lands; the corpus is re-rated in batches, and the fine-tuning filter admits only current, gate-passing rows.
- The eval plan keeps only its composite-weight role; whether it is still worth generating is not decided here.
- The agent path pays for eight views where it sent nine, and the orchestrator path for eight where it often sent five.
- The instrument's content — rubric, bands, caveats — is unchanged by this decision and stays a separate question.
