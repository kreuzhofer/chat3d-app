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
A small utility LLM call with a tight output cap that is not user-visible chat (chat naming, tag suggestion, decomposition decision). Short internal calls always run with thinking off, regardless of the assigned Model's thinking configuration. A **judge evaluation in a VLM experiment** likewise runs at `off` unless the run explicitly carries another effort (issue #99): a Judge is qualified per thinking setting (ADR 0004), so the Model row's default never decides what an experiment measures.

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

**Uncontended serving**:
The condition under which a Judge's answers reproduce: no replica of its pool handles more than one request at a time for the whole of a run — requests in flight at or below serving replicas. Necessary always; measured sufficient for the qwen judge on our prompts, never a general guarantee. Two things break it — another tenant on the pool, and the pool losing a replica — so it is secured from three sides: Sole tenancy by rule, Serving provenance by record, the Serving gate by refusal to dispatch.
_Avoid_: determinism (a stronger claim than this buys), isolation (implies a separate deployment), quiet hours

**Sole tenancy**:
The operator-side half of Uncontended serving: while a judge run is on, nothing but the judge's own calls are submitted to its served name. A judge sharing a replica with other traffic is not the judge that qualified — the batch composition changes its arithmetic. It is a rule kept by hand and verified from the usage log after the run; it cannot cover the pool shrinking under the run, which no rule can catch. The Serving gate now enforces the same condition from the judge's side, so a co-tenant costs a run seconds of back-off rather than its trustworthiness; the rule remains the cheaper way to not have one.
_Avoid_: quiet hours, maintenance window (about people, not the pool), isolation (implies a separate deployment)

**Serving provenance**:
What a stored evaluation records about the pool that produced it: the judge's published name, the serving replica count, the driver's own concurrency, and the highest per-replica requests in flight seen at the time. Stamped per judge call, so a rating can be checked against Uncontended serving long after the run. Absent on calls taken before it was recorded, which read as unknown rather than as satisfied.
_Avoid_: pool health, load (about the cluster's wellbeing, not the rating's provenance)

**Serving gate**:
The harness's own check of Uncontended serving, evaluated before each judge dispatch on the same snapshot Serving provenance is stamped from. Concurrency is clamped to the serving replica count rather than refused; a co-tenant backs the next dispatch off, a lost replica halts the run for the operator to resume. A production rating whose dispatch would violate the condition is not written at all — the row stays Stale and is re-rated — while an experiment result is written with its run marked, because it is an observation rather than an assertion about the corpus. Carried only by the drivers we schedule; production's own `vlm_eval` records and does not gate.
_Avoid_: rate limit (about capacity, not comparability), circuit breaker (about the pool's health, not the rating's), throttle

**Fine-tuning filter**:
The rule that decides which approved workbench rows the training export reads. A row is admitted on one of two grounds: a human decided its status, or a Judge did under the current Instrument id while Qualified under it. Stale and Provisional rows wait outside it; a human's verdict is admitted whatever rating sits beside it, because the verdict is the human's and not derived from that rating.
_Avoid_: export filter (the export also filters by score and category, which are not about trust), approval (the gate's verdict; admission is stricter than approval)

**Screen**:
The mechanical part of Qualification: completeness, stability, throughput and the agreement counts against the Reference standard, computed by script with no human step (`packages/backend/scripts/qualification-screen.ts`, which also writes the disagreement dump). A screen orders candidates and produces the disagreement set for inspection; it never qualifies a judge by itself.
_Avoid_: benchmark, leaderboard, eval run

**Specimen**:
The per-example part of a Judge's prompt: the user's request, the category and its complexity, the construction spec, the Checklist items. The views are the same eight for every example and every entry point, so they are not part of what varies. Injected into the Instrument through its slots, never restated by it.
_Avoid_: context, example data, prompt (ambiguous with the user's request)

**Requirement**:
A property of an example that the prompt states or necessarily implies ("four standoffs" means exactly four; "a through hole" passes through). Requirements are what criteria are generated from, and the only things a Checklist item may gate on.
_Avoid_: detail, feature, spec

**Requirement atom**:
The unit spec generation and enrichment emit for a Requirement: `{text, visibility}`, one requirement per entry, the visibility saying which evaluator can answer it (`visual` for what a render shows — shape, openings, and the count, presence, openness and placement the prompt states; `code` for every measurement; `both` only without a number). A bare string, an entry without a visibility, or a bundled entry (a visual fact carrying a millimetre figure) is a refused reply, retried once and then surfaced — never an atom by default (ADR 0002).
_Avoid_: criterion string, check, annotated criterion

**Assumption**:
A choice the spec made where the prompt was silent. Never gates. Becomes a Requirement only once a clarification pass writes it into the prompt.
_Avoid_: default, interpretation

**Checklist item**:
One question about a visible property of an example, answered pass / fail / uncertain. Derived from a criterion; the criterion is the source, the item is what a judge or rater is actually asked.
_Avoid_: check, question, criterion (the source, not the question)

**Gate**:
The rule that turns Checklist item answers into a Verdict for an example. Items are the unit: every item must pass, across whichever evaluators answered them. A judge's emitted score is never the gate; at most a temporary backstop beside it.
_Avoid_: threshold, auto-approve, scoring

**Gate-eligible**:
An example the Gate can decide at all: its render succeeded and it holds the stored Checklist item answers the rule needs. An example that is not gate-eligible has no Verdict to derive and stays pending — it is never approved because the check could not be performed, and never rejected for it either.
_Avoid_: skipped (implies the gate ran and stood aside), no-gate, bypass

**Verdict**:
The Gate's decision for an example: approved, pending, or rejected. A verdict is derived, never emitted by a judge, and is re-derivable whenever the gate rule or the item answers change.
_Avoid_: approval status, rating, score

**Reference standard**:
What a judge's item answers are checked against: a Consensus set for iteration, and human Disagreement inspection as the arbiter. A judge's own output is never its reference, and no pre-labelled corpus is assumed.
_Avoid_: ground truth, gold set, baseline

**Disagreement inspection**:
A human looking at the checklist items on which two judges disagree, and deciding which is right. Targeted and small; the arbiter when consensus cannot settle an item.
_Avoid_: rating session, labelling, review

**Sitting**:
One bounded pass of Disagreement inspection: a Disagreement set drawn from one candidate and one reference under one Instrument id, worked by one adjudicator until every item carries an Adjudication or is left open. A sitting is the unit that is started, resumed and completed.
_Avoid_: session (auth and chat already own the word), sheet, batch

**Disagreement set**:
The checklist items on which the candidate and the reference answered differently, paired by example and position, as the Screen finds them. Fixed when the Sitting starts; it never grows.
_Avoid_: dump, sample (the sample is the examples the runs covered; the set is the items that disagree)

**Adjudication**:
The human's decision on one item of a Disagreement set: R when the reference was right, C when the candidate was right, N when neither was or the item cannot be answered from renders, with a note. Adjudications are what the bar's adjudicated terms count and what the judge fine-tune learns from.
_Avoid_: verdict (the Gate's word), label, vote

**Triage**:
A third model's reading of one disagreement before the human looks: a would-be adjudication with its confidence, what the views show and the deciding view. Stamped with the model that gave it, kept beside the Adjudication, never counted toward the bar, never a judge.
_Avoid_: third judge, second opinion, verdict

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

