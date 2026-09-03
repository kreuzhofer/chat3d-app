---
status: accepted
date: 2026-09-03
---

# Requirements come from the prompt, and criteria are split at generation

A checklist item may gate approval only on a **Requirement**: something the prompt states or necessarily implies. Choices the spec made where the prompt was silent are **Assumptions** and never gate; when an ambiguity matters, a clarification pass rewrites the curated prompt so the choice becomes explicit. We decided this after finding that the judge was being asked almost none of the right questions — not because enrichment failed to write them, but because it bundled each visual fact with a millimetre figure and a dimension filter then deleted the whole criterion: 71% of production criteria, and 74 of the 147 requirements the judge penalised on examples whose checklist had fully passed (map *Eval harness for an open-weights judge*, issues #45, #48, #49).

## What changes

- **Split at generation.** Enrichment emits one requirement per entry as `{text, visibility}`, the shape spec generation already uses: "exactly four standoffs" (visual), "standoffs near the corners" (visual), "standoff offset is 5mm" (code). No regex decides what the judge sees; the dimension filter stays only as a safety net expected to catch nothing.
- **Bare strings are a failure.** A response of bare strings or bundled atoms is a failed enrichment, retried or surfaced. It is not normalised to `visibility: "both"` by default — that silent default is how #33 stayed hidden for months.
- **The judge sees the prompt and the items.** The LLM-written spec is no longer the judge's "primary reference"; shown at all, it is marked as assumptions. Eleven penalised requirements existed only in that block.
- **Measurements get a proxy only when a proportion is visible.** Code review checks the number; the judge is never asked to estimate an absolute size from a screenshot.
- **Count, presence, openness and placement are mandatory when stated.** A prompt that states one and a checklist that lacks it is a generation failure, not a coverage statistic.
- **Coverage is measured every batch** as the unlisted-issue rate — evaluations with an issue matching no item — per category, with a staged target of 25%, 10%, then 5%. Reaching 5% is one of the three conditions for removing the score backstop (ADR 0001).

## Considered options

- **Route mixed criteria whole to code review.** Rejected: the judge would still never see "four standoffs".
- **Split by a post-processing pass.** Rejected: an extra call per prompt and a second place the shape can drift; the shape belongs at the source.
- **Let spec-invented defaults gate.** Rejected: the model would be judged against things the user never asked for. Broader coverage on paper; wrong contract.

## Consequences

- Criteria for all existing prompts (~2,855) are regenerated under these rules, approved examples first because they feed training, with the old criteria kept alongside so before/after coverage is measurable. Examples are then re-rated under the item gate.
- A phased, interactive discussion agent for complex constructions — start simpler, get feedback, split into phases — was raised while deciding this. It is feasible and out of scope for this map; it gets its own.
