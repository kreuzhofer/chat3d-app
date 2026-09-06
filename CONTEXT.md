# Chat3D

AI-powered 3D CAD modeling: users describe parts in natural language chat, and an LLM pipeline produces Build123d code that is rendered into CAD files.

## Language

### LLM configuration

**Provider**:
A configured LLM endpoint (cloud API or self-hosted server) with credentials and a provider type that selects the SDK integration. Identified by name (e.g. `vllm-gx10`, `nebius`).
_Avoid_: backend, vendor

**Model**:
A named model served by a Provider, with capability flags (thinking, vision, embeddings, streaming) and token limits.

**Purpose**:
A pipeline role (e.g. `conversation`, `agent_codegen`, `vlm_eval`, `embedding`) that is assigned exactly one Model via the purpose map. Purposes are the unit of model selection.
_Avoid_: task type, use case

**Thinking effort**:
Per-model (or per-purpose override) control of reasoning depth: `low`/`medium`/`high`/`max`, or `off`. **`off` means the model does not reason at all** — for models whose serving template enables thinking by default, "off" must actively disable it, not merely skip enabling it.
_Avoid_: reasoning budget (that is one provider-specific realization of effort)

**Short internal call**:
A small utility LLM call with a tight output cap that is not user-visible chat (chat naming, tag suggestion, decomposition decision). Short internal calls always run with thinking off, regardless of the assigned Model's thinking configuration.

### Evaluation

**Judge**:
The model, under a specific prompt and set of rendered views, that answers a Checklist for an example. A judge is a role, not a model name; the same model under a different harness is a different judge.
_Avoid_: evaluator, grader, VLM (a capability, not the role)

**Instrument**:
The stable part of a Judge's prompt: role, caveats, rubric, output shape (the response schema included). Held identical across every example, every entry point and every judge model so that two answers are comparable. It is a template with named slots for the Specimen; production ships one, and an experiment run may carry another (a *variant*). Every evaluation records the Instrument id it was answered under.
_Avoid_: system prompt (instrument and specimen interleaved), rubric (one part of it), preamble, eval plan (per-prompt instructions; not sent to the judge)

**Instrument id**:
The identity of the Instrument a Judge answered under: a name (production's, or an experiment variant's) plus a content hash of the whole procedure: the template, the response schema, the zoom follow-up prompt and its settings; stamped on every stored evaluation. Two evaluations are comparable only under the same Instrument id. Evaluations stored before ids existed have none and are read as pre-versioning.
_Avoid_: version number (hand-bumped and forgettable), prompt hash (the specimen would change it per example)

**Stale**:
A stored evaluation whose Instrument id is not the current one. Still readable, excluded from any set that assumes comparability (the Reference standard, the fine-tuning filter), and re-rated as scheduled batch work by the judge `vlm_eval` points at.
_Avoid_: outdated, invalid (the answer was valid under its own instrument)

**Qualification**:
The bar a Judge clears before it owns `vlm_eval` and its ratings feed training. On the fixed measurement set: complete, stable against itself at or inside the reference's own floor, and, on the items where it disagrees with the Reference standard, no more confirmed false passes than the reference and no more than twice its confirmed false fails, as decided by Disagreement inspection. Granted per Judge and Instrument id; provisional until the first re-rating batch is spot-checked.
_Avoid_: benchmark, accuracy threshold, parity (with the reference — the arbiter decides, not resemblance)

**Qualified judge**:
A Judge that has cleared Qualification under the current Instrument id. Recorded with the Instrument; an instrument revision revokes it until the mechanical terms are re-run and the changed items re-inspected.
_Avoid_: production judge (a role assignment, not a status), approved model, trusted model

**Provisional**:
A rating produced under the current Instrument id by a Judge that has not cleared Qualification. Kept and gate-derived as usual, excluded from the fine-tuning filter until its Judge qualifies, then admitted without re-rating. Distinct from Stale, which needs re-rating.
_Avoid_: untrusted, temporary, draft

**Screen**:
The mechanical part of Qualification: completeness, stability, throughput and the agreement counts against the Reference standard, computed by script with no human step (`packages/backend/scripts/qualification-screen.ts`, which also writes the disagreement dump). A screen orders candidates and produces the disagreement set for inspection; it never qualifies a judge by itself.
_Avoid_: benchmark, leaderboard, eval run

**Specimen**:
The per-example part of a Judge's prompt: the user's request, the category and its complexity, the construction spec, the Checklist items. The views are the same eight for every example and every entry point, so they are not part of what varies. Injected into the Instrument through its slots, never restated by it.
_Avoid_: context, example data, prompt (ambiguous with the user's request)

**Requirement**:
A property of an example that the prompt states or necessarily implies ("four standoffs" means exactly four; "a through hole" passes through). Requirements are what criteria are generated from, and the only things a Checklist item may gate on.
_Avoid_: detail, feature, spec

**Assumption**:
A choice the spec made where the prompt was silent. Never gates. Becomes a Requirement only once a clarification pass writes it into the prompt.
_Avoid_: default, interpretation

**Checklist item**:
One question about a visible property of an example, answered pass / fail / uncertain. Derived from a criterion; the criterion is the source, the item is what a judge or rater is actually asked.
_Avoid_: check, question, criterion (the source, not the question)

**Gate**:
The rule that turns Checklist item answers into a Verdict for an example. Items are the unit: every item must pass, across whichever evaluators answered them. A judge's emitted score is never the gate; at most a temporary backstop beside it.
_Avoid_: threshold, auto-approve, scoring

**Verdict**:
The Gate's decision for an example: approved, pending, or rejected. A verdict is derived, never emitted by a judge, and is re-derivable whenever the gate rule or the item answers change.
_Avoid_: approval status, rating, score

**Reference standard**:
What a judge's item answers are checked against: a Consensus set for iteration, and human Disagreement inspection as the arbiter. A judge's own output is never its reference, and no pre-labelled corpus is assumed.
_Avoid_: ground truth, gold set, baseline

**Disagreement inspection**:
A human looking at the checklist items on which two judges disagree, and deciding which is right. Targeted and small; the arbiter when consensus cannot settle an item.
_Avoid_: rating session, labelling, review

**Coverage signal**:
An issue a judge raises that matches no Checklist item. Diagnostic, never a gate input; its rate per category is the measure of whether the checklist asked the right questions.
_Avoid_: unlisted issue, gap

**Consensus set**:
Labels produced by running a frontier judge several times over the same examples and taking the majority per item. Cheaper than gold; inherits that judge's blind spots, so it iterates but never validates.
_Avoid_: silver set

**Held-out set**:
Prompts reserved for benchmarking the codegen model and excluded from its training data. Not a reference for the judge.
_Avoid_: gold set, test set

**Blind**:
A rating is blind when the rater has seen nothing a judge produced for that example: no score, no verdict, no issues. A rating made after seeing any of those is not blind, whatever else it is.
_Avoid_: unbiased, independent

