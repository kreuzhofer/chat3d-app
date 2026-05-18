# Code Generation Harness Audit

> **Status:** Draft v1 — methodology + per-stage failure-mode taxonomy.
> **Date:** 2026-05-18
> **Companions:**
> - [`codegen-pipeline-and-workbench.md`](codegen-pipeline-and-workbench.md) — *what* the harness is (architecture, services, schema).
> - [`workbench-pipeline-analysis-extrusions.md`](workbench-pipeline-analysis-extrusions.md) — single-category failure analysis (Extrusions & Revolutions). Source of patterns A–F cited throughout.
>
> **Purpose:** Catalogue, per harness stage, the failure modes that limit generation quality — and explicitly separate the ones that fine-tuning can fix from the ones that only harness changes can fix. Even frontier models (Claude Opus, GPT-4) hit a complexity ceiling on Build123d; this doc maps where that ceiling sits *for each stage of the pipeline* so we can prioritise the right interventions.

---

## 0. How to Read This Document

### 0.1 What this is

A stage-by-stage catalogue of failure modes, with for each:

- **Evidence pointer** — where in the database or filesystem to find concrete examples
- **Training-fixable?** — `yes` / `partial` / `no`. A fine-tuned model removes some failures (e.g. wrong API usage) but cannot fix harness-architectural issues (e.g. spec over-constraining, error feedback channel being text-only, no clarification gate)
- **Harness fix** — concrete intervention; one-liner
- **Effort / Lift** — rough order-of-magnitude

### 0.2 What this is NOT

- The architecture spec → see `codegen-pipeline-and-workbench.md`
- A per-category failure list → we have one for Extrusions; the methodology in §6 lets us regenerate it for other categories
- An implementation plan → after triage, each top-priority fix gets its own plan under `docs/superpowers/plans/`

### 0.3 Severity rubric

| Severity | Meaning |
|---|---|
| **S1** | Causes silent quality loss — the model still produces output but it's wrong, and the eval may not catch it |
| **S2** | Causes visible failure — render fails or eval flags it; agent gets a chance to recover |
| **S3** | Causes pipeline cost without quality impact — wasted tokens, redundant work |

### 0.4 Training-fixable rubric

| Marker | Meaning |
|---|---|
| **yes** | A model fine-tuned on the curated dataset, with no harness changes, would reduce or eliminate this failure |
| **partial** | Training helps but the harness still contributes the failure — both are needed |
| **no** | Architectural — no amount of training fixes this; only a harness change does |

---

## 1. The Harness as a Pipeline of Decisions

The codegen harness is a *sequence of decisions*, each made by a different LLM or deterministic component, each consuming evidence from the previous stage and producing evidence for the next. Errors compound: a wrong spec leads to wrong code leads to wrong eval leads to wrong auto-approval.

```
User prompt
  │
  ▼
[1] Conversation routing (chat only)         ── decides: codegen vs chat-only
  │
  ▼
[2] Spec generation                          ── produces: interpretation, checklist, assertions, complexity
  │
  ▼
[3] Research / technique decomposition       ── produces: technique list, per-technique RAG hits
  │
  ▼
[4] Spec enrichment                          ── produces: refined spec with retrieved dimensions
  │
  ▼
[5] Few-shot example retrieval               ── produces: up to 6 approved workbench examples
  │
  ▼
[6] Knowledge retrieval (keyword pre-fetch)  ── produces: reference entries auto-injected
  │
  ▼
[7] System prompt assembly (tiered)          ── produces: Tier 1 + Tier 2 sections selected
  │
  ▼
[8] Multi-agent decomposition gate           ── decides: single-agent vs 2–6 sub-agents
  │
  ▼
[9] Agent loop (planning + tool selection)   ── produces: tool-use trajectory
  │     │
  │     ├── text_editor (view/create/str_replace/insert)
  │     ├── validate_code / validate_and_render
  │     ├── render_project
  │     ├── search_examples / search_knowledge / lookup_api
  │     └── submit_result
  │
  ▼
[10] Pre-render validation (AST + 10 lints)  ── gates render
  │
  ▼
[11] Render (Build123d service)              ── produces: .step/.stl/.3mf or error
  │
  ▼
[12] Error classification + fix loop         ── 7 categories, in-loop agent recovers
  │
  ▼
[13] Screenshot (9 angles)
  │
  ▼
[14] VLM evaluation                          ── produces: score, issues, checklist results
  │
  ▼
[15] Code evaluation (assertions + review)   ── produces: score, issues
  │
  ▼
[16] Composite scoring + auto-approval gate  ── decides: approved / pending / reject
```

Each `[N]` is a section below.

### 1.1 Evidence sources (where to look)

| Source | Stage(s) covered | Schema/path |
|---|---|---|
| `generation_traces.trace` JSONB | 7, 8, 9 (full agent DAG) | per-run; live + persisted |
| `workbench_examples.spec_raw_response` + `spec_system_prompt` | 2 | per example |
| `workbench_examples.agent_conversation` + `agent_system_prompt` | 9 | full multi-turn history |
| `workbench_examples.vlm_raw_response` + `vlm_system_prompt` | 14 | per example |
| `workbench_examples.code_review_raw_response` + `code_review_system_prompt` | 15 | per example |
| `workbench_examples.eval_score` + `eval_visual_score` + `eval_code_score` + `eval_checklist_results` | 14, 15, 16 | per example |
| `workbench_examples.render_status` + `render_error` | 10, 11, 12 | per example |
| `workbench_examples.approval_status` + `auto_approval_reason` | 16 | per example |
| `curation_candidates.distilled_prompt` + `notes` | 1, 2 (chat-side) | per candidate |
| `rag_gaps` table | 5, 6 | per missed technique |
| `llm_usage_events` (source context = workbench/chat/experiment) | all | cost attribution |
| File: `chat/{contextId}/code/{itemId}.b123d` + `artifacts/` | 9, 11 | source + artifacts |

---

## 2. Per-Stage Failure Mode Catalogue

> **Status legend:** ⚠ = inferred but not yet validated against production data; ✅ = validated in extrusions analysis or trace inspection.

### 2.1 Conversation Routing (chat only)

**File:** chat conversation LLM (purpose=`conversation`).
**Produces:** `[CODEGEN_NEEDED]` or `[CHAT_ONLY]`.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 1.1 | Misclassifies refinement (e.g. "make the handle longer") as `[CHAT_ONLY]` — no codegen runs | S2 | `chat_items` where prior item has a render and current item has no code project change ⚠ | partial | Force codegen branch when an active code project exists and user message isn't a clear question |
| 1.2 | Classifies pure conversation (e.g. "thanks", "what does that mean?") as `[CODEGEN_NEEDED]` — wastes a full pipeline run | S3 | `generation_traces` with empty spec interpretations or no model change ⚠ | yes | Add deterministic pre-filter for short/conversational messages |
| 1.3 | Doesn't pass enough conversation history into spec stage — refinement loses anchor | S1 | `spec_raw_response` for context.iteration > 1 that re-derives dimensions from scratch ⚠ | partial | Forward the previous spec + delta intent, not just the raw user message |

**Why training alone doesn't fix this:** the routing decision is structural; even a perfect model still gets a context window with the wrong information if upstream slicing is wrong.

### 2.2 Spec Generation

**Service:** `spec-generation.service.ts`
**Produces:** interpretation, verification checklist, code assertions, complexity class, disambiguation questions.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 2.1 | **Over-constraining (extrusions Pattern C ✅)** — extrapolates exact dimensions / arc centres / construction methods from a vague prompt. Adding spec detail makes scores *worse* (banana 7.4→6.5). | S1 | extrusions doc §3; `spec_raw_response` length / dimension-count vs prompt token count | no | Cap spec to prompt-stated dimensions + obvious derived values; forbid extrapolation of construction parameters |
| 2.2 | **Prescribes construction method (Pattern B ✅)** — "use BuildLine + Polyline + RadiusArc" leaks the *how*, then penalised when codegen picks a different valid path | S1 | extrusions doc §2 Pattern B; cross-check `spec_raw_response` for keywords (BuildLine, Polyline, revolve, loft) | no | Constrain spec to *what* (shape + dimensions + features); strip construction-method prescriptions in post-processing |
| 2.3 | **Derived-value fragility (Pattern C ✅)** — spec computes `inner_radius = outer - wall_thickness` one way, code computes another; both correct geometrically but eval penalises | S1 | extrusions doc §3 | no | Make assertions geometric (volume, bbox, hole count) not value-equality |
| 2.4 | **Disambiguation questions ignored** — spec generates 2–3 questions but workbench pipeline doesn't pause; chat may or may not surface them | S2 | `spec_raw_response.disambiguation_questions` field non-empty AND no user response ⚠ | no | Workbench: pre-rank prompts by ambiguity; high-ambiguity prompts go through human review or skip. Chat: surface as inline UI (already done?) |
| 2.5 | Spec regenerated on every retry → wasted tokens (~30% per-attempt cost, extrusions §7) | S3 | extrusions doc §7 | no | Cache spec per `(prompt_text, prompt_version)`; only regenerate when text changes |
| 2.6 | Complexity classification is operation-count, not reasoning-depth | S1 | `workbench_examples.eval_score` distribution within each complexity class — high variance suggests the bucket isn't capturing actual difficulty ⚠ | partial | Add a "spatial reasoning depth" classifier (e.g. counts nested operations, asymmetric constraints, tolerances) |

**Cross-cutting:** the spec stage is the single highest-leverage harness lever — it sets the targets that downstream evaluation will judge against. Spec-side false constraints become false failures.

### 2.3 Research / Technique Decomposition

**Services:** `research-technique-decomp.service.ts`, `research-search.service.ts`, `research-agent.service.ts`.
**Produces:** per-technique RAG hits, gap recordings.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 3.1 | Technique decomposition over-splits — generates 8+ techniques for a 2-feature prompt → noisy retrieval | S3 | `generation_traces.trace` nodes of kind `technique_decomp` with >6 entries on simple prompts ⚠ | partial | Bound technique count by complexity class |
| 3.2 | Under-splits — single "make a snap-fit hinge" technique that retrieves nothing useful | S2 | `rag_gaps` table entries with low per-technique recall ⚠ | partial | Iterative decomposition — if zero hits, split further |
| 3.3 | Decomposed techniques don't match how knowledge is indexed (vocabulary mismatch) | S2 | `rag_gaps` table — high-volume gaps reveal the mismatch | no | Maintain a controlled-vocabulary technique taxonomy; map free-text → canonical |

### 2.4 Spec Enrichment

**Service:** `spec-enrichment.service.ts`
**Produces:** spec refined using retrieved knowledge.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 4.1 | Enrichment hallucinates dimensions when knowledge base has no relevant hit | S1 | enrichment that adds dimensions not in original spec and not in any retrieved knowledge entry ⚠ | partial | If RAG returns nothing for a technique, skip enrichment for that technique (don't fabricate) |
| 4.2 | Enrichment compounds Pattern C — already over-specified spec gets more over-specified | S1 | length of enriched spec vs base spec on the same prompt ⚠ | no | Enrichment should *replace* placeholder dimensions, not add new ones |

### 2.5 Few-Shot Example Retrieval (RAG)

**Service:** `workbench-embeddings.service.ts` (search), `prompts/` (insertion into context).
**Produces:** up to 6 approved workbench examples in the system prompt.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 5.1 | Retrieved examples teach the wrong construction approach (Pattern B ✅) — examples use BuildLine, target prompt wants extrude-then-fillet | S2 | `workbench_examples` for low-score runs: do top-K retrieved examples use a different construction style than what spec prescribes? ⚠ | partial | Re-rank by spec construction-method match, not only operation overlap |
| 5.2 | No negative examples — model never sees "here's the common wrong way" (extrusions §8) | S2 | extrusions doc §8; structural | no | Add `workbench_negative_examples` table — failed-then-corrected pairs |
| 5.3 | Organic shapes underrepresented (extrusions §8) — retrieval returns geometric-only neighbours for guitar/vase prompts | S2 | category vs `detected_operations` distribution in approved examples | partial | Stratified sampling in retrieval — guarantee 1+ organic example if prompt has organic markers |
| 5.4 | All 6 retrieved examples are near-duplicates (same prompt seed × different runs) | S2 | retrieved example IDs in trace ⚠ | no | Diversity bonus in ranker — penalise high pairwise prompt similarity in the result set |
| 5.5 | Retrieval blind to dimensions — finds a "soap dish" example with 5mm fillet when prompt asks for 1.5mm | S2 | low-code-score runs where top-K examples have dimensional mismatch ⚠ | partial | Inject the spec's dimensional summary into the retrieval query, not only the prompt |

### 2.6 Knowledge Retrieval (Keyword Pre-Fetch + Search Tools)

**Service:** `knowledge-search.service.ts`, keyword pre-fetch in prompt assembly.
**Produces:** reference entries auto-injected; agent-callable `search_knowledge` / `lookup_api`.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 6.1 | Keyword pre-fetch fires false positives — "USB-C" in a non-electronic context injects connector specs that waste tokens | S3 | system_prompt size vs detected_operations mismatch ⚠ | no | Gate keyword groups by category + spec |
| 6.2 | `search_knowledge` returns chunks (semantic similarity high, application low) | S2 | agent traces where the agent calls search_knowledge then doesn't use the result ⚠ | partial | Add per-result rerank using the agent's last tool call as context |
| 6.3 | `lookup_api` rarely used by agents — Tier 3 sections sit idle even on tasks that need them | S3 | trace tool-call frequency: `lookup_api` count vs operation type ⚠ | partial | Surface Tier 3 sections proactively when the agent's first attempt fails with an API_MISUSE error |

### 2.7 System Prompt Assembly (Tiered)

**File:** `prompts/system-prompts.ts` (25 sections, 3 tiers).
**Produces:** assembled prompt with Tier 1 + Tier 2 sections selected by operation detection.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 7.1 | Operation detection misses → Tier 2 section omitted → API hallucination | S2 | API_MISUSE errors correlated with missing Tier 2 section that documents the misused API ⚠ | partial | Add post-hoc check: if error class is API_MISUSE for class `X`, escalate to Tier 2 section for `X` on retry |
| 7.2 | Operation detection over-includes → prompt bloat → cache miss → cost | S3 | `system_prompt` token count vs operation count ⚠ | no | Tighten keyword → section mapping |
| 7.3 | Common-mistakes Tier 1 section grows without bound — every fix adds a "don't do X" — model gets noisy negative space | S1 | Tier 1 section length over time (git history); model perf on prompts that don't touch any of the listed mistakes ⚠ | no | Periodic audit: remove mistakes that haven't fired in N traces |

### 2.8 Multi-Agent Decomposition Gate

**Service:** `agent-multi.service.ts`
**Triggers:** complexity = `complex` (6+ detected operations).

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 8.1 | Trigger is operation-count, not reasoning depth — a 4-operation prompt with awkward spatial composition (e.g. snap-fit) doesn't decompose; an 8-operation prompt of unrelated primitives over-decomposes | S2 | compare `complexity` class to actual `eval_score` outcomes ⚠ | no | Add a second trigger: "spatial coupling" — when components have geometric dependencies (alignment, fit, clearance) |
| 8.2 | Decomposition LLM creates components with hidden dependencies — assembly agent has to guess alignments | S2 | `generation_traces` showing assembly agent making large edits to component files ⚠ | partial | Force the decomposition LLM to emit explicit interfaces (mating faces, datum coordinates) per component |
| 8.3 | Sub-agents validate-only (no render) — assembly is first time geometry is checked; if a sub-component is geometrically broken, all decomposition work was wasted | S2 | assembly-time render failures with sub-agent component imports ⚠ | no | Cheap sanity-render per sub-component (BBox only, no STL) — fail fast |
| 8.4 | Fallback to single-agent loses the decomposition signal — when multi-agent fails, single-agent retries with no hint that the prompt is structurally complex | S2 | failed multi-agent runs followed by lower-score single-agent runs ⚠ | partial | On fallback, surface the decomposition LLM's component list to the single agent as a planning hint |

### 2.9 Agent Loop — Planning

**Service:** `agent-codegen.service.ts`
**Produces:** tool-call sequence.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 9.1 | Agent writes full file then validates — burns steps; should write incrementally with validate-as-you-go | S3 | trace: single `text_editor:create` followed by long validate→error→str_replace chain ⚠ | partial | System-prompt nudge: "validate after each construction phase" |
| 9.2 | Agent gets stuck looping on the same error — same str_replace, same validation failure | S2 | trace: ≥3 identical tool calls in a window | partial | Stuck-detector already exists (nudge loop) — extend to: after 2 retries on same error, force `search_knowledge` |
| 9.3 | Agent submits without rendering ("submit_result" called before a successful render) | S2 | trace: `submit_result` without a prior successful `render_project` | no | Hard gate: reject `submit_result` if no render succeeded since last code change |
| 9.4 | Agent ignores its own validation warnings | S2 | warnings present in last validate response, then submit_result called | partial | Surface warnings as a structured "remaining issues" block in the submit gate |

### 2.10 Tool: `text_editor`

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 10.1 | `str_replace` with non-unique target — agent retries 3× with slightly different anchors | S3 | trace: error="multiple matches" / "no matches" + retry pattern | yes (mostly) | Return matched-anchors list on failure; force agent to disambiguate |
| 10.2 | `create` overwrites existing file silently → lost work | S2 | trace: `create` on existing path ⚠ | no | Refuse `create` if file exists; require explicit replace flow |

### 2.11 Tool: `validate_code` / `validate_and_render`

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 11.1 | 10 AST lints catch known bad patterns; everything else slips through to render | S2 | render errors that an AST rule could catch — sample render_errors by category | no | Add lints as we find recurring errors; track lint-vs-render-error ratio |
| 11.2 | Lints don't catch geometric impossibility (e.g. shell thicker than min wall) | S2 | KERNEL_ERROR or GEOMETRY render errors | no | New `/analyze/` Build123d endpoint with geometric pre-checks (roadmap §9.5) |

### 2.12 Tool: `render_project`

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 12.1 | Render error message is OCC-flavoured C++ text — the agent must understand "Standard_OutOfRange in BRep_Tool::Curve" | S1 | `render_error` corpus | partial | Already partially handled by error classification (§2.13); deepen the translation per category |
| 12.2 | No incremental geometry inspection — render is all-or-nothing | S2 | repeated full-render attempts on a partially-correct model | no | `POST /execute-partial` (roadmap §9.5) so agent can render up to line N and inspect |

### 2.13 Render Error Classification + Fix Loop

**File:** `utils/render-errors.ts` — 7 categories.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 13.1 | UNKNOWN category is large — fix guidance is generic | S2 | `render_error` rows classified as UNKNOWN — count and sample | no | Triage UNKNOWN bucket → new categories |
| 13.2 | GEOMETRY guidance is the same for "self-intersecting wire" and "empty face" — different root causes | S2 | sample GEOMETRY errors | no | Sub-classify GEOMETRY into wire/face/solid/boolean |
| 13.3 | Fix-loop is text-only — agent never sees the screenshots of the failed render (when partial geometry exists) | S1 | structural | no | Capture screenshots even on partial failure; feed back to agent (multimodal) |

### 2.14 Tool: `search_examples` / `search_knowledge` / `lookup_api`

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 14.1 | Agent calls search with the user's *original* prompt instead of a focused query | S3 | trace: search query text == prompt | partial | System-prompt nudge: search with the *technique you need*, not the whole task |
| 14.2 | Agent reads search results but doesn't cite them in code | S3 | trace: search call followed by code that doesn't import or echo anything from the result | yes | Training signal: workbench examples should track which retrieved snippets were *used* |

### 2.15 Tool: `submit_result`

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 15.1 | Agent submits prematurely on a low-confidence render (geometry rendered but obviously wrong) | S2 | trace: submit_result followed by low VLM score | partial | Agent self-eval gate before submit (cheap call to itself: "is this what was asked?") |
| 15.2 | Agent never submits — keeps editing, hits step limit | S2 | trace: step limit hit, no submit_result | partial | Soft-prompt at step N-3: "you have 3 steps left, submit your best result" |

### 2.16 Pre-Render Validation (recap, already in §2.11)

(see 11.1, 11.2)

### 2.17 Screenshot Capture (9 angles)

**Service:** `screenshot-service` (Puppeteer).

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 17.1 | Auto-framing crops small features off-screen | S1 | low VLM "feature-presence" score on prompts with small features ⚠ | no | Spec → screenshot framing hint (e.g. "preserve fillet detail") |
| 17.2 | 9 angles is fixed — orthographic detail of an asymmetric part may be hidden in all of them | S2 | low VLM scores with high zoom-detail-view calls ⚠ | no | Spec-driven angle selection (already partially done via VLM zoom — but proactive selection is missing) |
| 17.3 | All angles same lighting/material — VLM can't distinguish concave/convex on smooth surfaces | S2 | Pattern F (extrusions §2) ✅ | no | Adaptive lighting (e.g. matcap with curvature highlights for organic shapes) |

### 2.18 VLM Evaluation

**Service:** `visual-eval.service.ts`

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 18.1 | Visual vs code score mismatch (Pattern D ✅) — visual=9, code=5 (looks right, implemented wrong) and vice versa | S2 | extrusions doc §5; correlation between `eval_visual_score` and `eval_code_score` per category | no | Adaptive weight by category — already configurable; needs per-category defaults |
| 18.2 | VLM can't see small features (10mm cove on 500mm object) — scores low for non-existent reasons (extrusions Pattern D ✅) | S1 | low visual score + high code score combo, especially on Surface-Modification category | no | Feature-scale awareness — spec emits a per-feature "expected visible scale" hint |
| 18.3 | VLM zoom requests not always usable (zoom region picked from a bad angle) | S2 | zoom call traces ⚠ | partial | Re-rank zoom angles by where the relevant feature is most visible (geometric pre-computation) |
| 18.4 | Verification checklist questions get yes/no but no confidence — a "maybe" answer gets coerced | S2 | checklist results with ambiguous prompts ⚠ | partial | Add a confidence field to checklist responses; treat low-confidence "yes" as "needs human review" |
| 18.5 | VLM model drift between runs — same example scored differently on re-eval | S2 | VLM experiment data — inter-rater variance for the same model | partial | Per-model preamble already exists; needs continuous calibration on a held-out anchor set |

### 2.19 Code Evaluation (Assertions + Review)

**Services:** `code-eval-assertions.service.ts`, `code-eval.service.ts`

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 19.1 | **Checks implementation not result (extrusions §4 ✅)** — soap-dish-via-ellipsoid-subtraction and soap-dish-via-shell-offset score differently for identical geometry | S1 | extrusions doc §4 | no | Replace value-equality assertions with geometric assertions (bbox, volume, hole count) via Build123d analyze endpoint |
| 19.2 | **No tolerance band (extrusions §4 ✅)** — 2.8mm fails when spec says 3.0mm | S1 | extrusions §4 | no | `approx` operator exists; default it for non-critical dimensions; surface tolerance band in the assertion definition |
| 19.3 | Assertion regex extraction brittle — `width = 50` matches, `width=50.0` may not, `WIDTH = 50` doesn't | S2 | code_eval logs where assertion missed but value clearly present ⚠ | no | Parse code with `ast` module, not regex |
| 19.4 | Code review LLM scores code against its own training priors, not the spec | S1 | high LLM code-review score on code that violates explicit spec assertions ⚠ | partial | Tighter code review prompt — *only* score against the assertions; ignore style |
| 19.5 | Code review can be ~free if cached but currently re-runs every retry (extrusions §7) | S3 | extrusions §7 | no | Cache code review when code hasn't changed |

### 2.20 Composite Scoring + Auto-Approval

**Function:** `computeCompositeScore()` and approval gate.

| # | Failure mode | Sev | Evidence | Training-fixable? | Harness fix |
|---|---|---|---|---|---|
| 20.1 | 50/50 visual/code blend wrong for organic shapes (Pattern F ✅) — code eval penalises a guitar body that looks fine | S2 | extrusions §5 | no | Per-category visual/code weight defaults — organic ≥ 70% visual, parametric ≥ 60% code |
| 20.2 | Threshold 7.5 is global — categories with inherently noisier eval need a different bar | S2 | distribution of `eval_score` per category, % above 7.5 | no | Per-category threshold (and possibly per-category weight, see 20.1) |
| 20.3 | Auto-approval doesn't surface *why* — when threshold met, no log of which sub-score carried the decision | S3 | structural | no | Persist `auto_approval_reason` (visual_dominant / code_dominant / both) |
| 20.4 | No partial-credit pathway — a 7.3 score (just below threshold) is treated the same as 4.0 | S2 | `eval_score` histogram — fraction in 7.0–7.5 ⚠ | no | "Near-miss" path: targeted fix loop instead of full regen (extrusions §7) |

---

## 3. Cross-Cutting Weaknesses

These don't live inside a single stage — they emerge from how stages interact.

### 3.1 Spatial reasoning ceiling

Even Claude Opus and GPT-4 lose accuracy beyond ~5 named features composed in a non-axis-aligned way. The harness currently routes prompts to the model and accepts whatever comes back. **Symptoms:** Pattern F (organic shapes), spatial-coupling failures in multi-agent assembly.

**Why training alone can't fix this:** spatial reasoning isn't a vocabulary problem (which is what fine-tuning fixes well) — it's a working-memory / planning problem. A LoRA on better examples raises the floor but the ceiling is set by base-model architecture.

**Harness levers:**
- Mandatory decomposition for spatial-coupling-high prompts (§2.8.1)
- Explicit datum/interface contracts between components (§2.8.2)
- Visual feedback in the fix loop (§2.13.3) — the agent *seeing* its own broken geometry shifts the problem to a more tractable space

### 3.2 Decomposition trigger is operation-count, not reasoning depth

§2.8.1 — repeated here as a cross-cutting concern because it touches §2.2 (complexity classification), §2.8 (decomposition gate), and §3.1.

### 3.3 No clarification gate in workbench

§2.2.4 — the spec stage emits disambiguation questions but workbench bypasses them. A prompt like "make a soap dish" has 5+ legitimate interpretations; we currently pick one silently and then judge against our own pick.

**Harness lever:** workbench-side, pre-filter prompts by ambiguity score; route the top-N most ambiguous to a single human-review pass to write a canonical interpretation that goes back into the prompt.

### 3.4 Error feedback channel is text-only

§2.13.3, §2.18.x — the agent only gets text errors from render and text+score from VLM. It never sees its own broken geometry visually during the fix loop. Multimodal agents can resolve "the fillet got chamfered" by looking; text-only agents have to deduce it.

### 3.5 No structural memory across attempts

When a prompt regenerates, the new run starts from scratch. The previous attempt's mistakes, the previous spec, the previous tool trajectory — all discarded.

**Harness lever:** persist a per-prompt "lessons learned" entry that gets retrieved on subsequent attempts ("last time, the agent failed at X because Y"). This is a distinct memory layer from RAG.

### 3.6 No negative examples

§2.5.2 — the model only ever sees "good code"; it has no representation of "common wrong code + correction". Both training data and runtime RAG would benefit from a `workbench_negative_examples` table.

### 3.7 Eval scores are not actionable signals — they're verdicts

The agent gets a single composite score after submit. It can't ask "what would have scored higher?" There's no gradient information.

**Harness lever:** structured eval response — per-checklist-item passes, per-assertion deltas, per-VLM-issue locations — used as feedback for one more fix attempt.

---

## 4. Training Helps vs. Doesn't — Summary Matrix

| Failure class | Training helps | Harness fix required |
|---|---|---|
| Wrong Build123d API usage (Box(centered=...), Shell(), etc.) | **High** — directly addressable | Lints + Tier 2 escalation still needed for tail |
| Argument order / kwargs / class vs function names | **High** | — |
| Choosing a "reasonable" but spec-wrong dimension (extrusions Pattern A) | **Medium** — better examples teach to follow the prompt | But spec over-constraining (§2.2.1) creates the conditions; harness fix needed |
| Picking a construction approach not matching spec (Pattern B) | **Medium** — but the bigger lever is the spec stopping prescribing approach | Harness primary |
| Spec over-constraining (Pattern C) | **Low** — this is the spec LLM's behaviour, training the *codegen* model doesn't change it | Harness primary (cap spec scope) |
| Visual/code score mismatch (Pattern D) | **Low** — eval is upstream of training | Harness — per-category weights, geometric assertions |
| Feasibility override (Pattern E) | **Medium** — base model behaviour, partly trainable away | Harness — explicit "follow spec exactly" prompt block |
| Organic shape difficulty (Pattern F) | **Medium** — more organic examples help | Harness — adaptive weighting, lighting, scale awareness |
| Spatial reasoning ceiling | **Low** | Decomposition + multimodal feedback |
| Error feedback channel | **Zero** — model can't fix what it can't see | Multimodal fix loop |
| No negative examples | **Medium** if added to training set | And/or RAG-side |
| No clarification gate | **Zero** | Workbench-side filter; chat-side UI |
| Spec regenerated every retry | **Zero** | Caching |

**Take-away:** roughly half the leverage is in the spec stage and evaluation. Training the agent model will improve API correctness and example-following but cannot fix the upstream constraints it's being judged against.

---

## 5. Decomposition & Clarification Hooks — Where to Add Them

Two interventions that recur across the catalogue:

### 5.1 Clarification hooks

| Hook location | Trigger | Action |
|---|---|---|
| Spec stage | spec emits ≥ 2 disambiguation questions (§2.2.4) | Workbench: queue for human pre-review. Chat: surface inline. |
| Few-shot retrieval (§2.5.1) | Top-K examples are tightly clustered (low diversity) and spec is ambiguous | Show clusters to user/reviewer with one-line summaries |
| Pre-render (§2.11.x) | AST lint fires `warning` (not error) on a construct that historically correlates with low scores | Show the warning to the user before render |
| Composite scoring (§2.20.4) | Score 7.0–7.5 with disagreement | Targeted "what would fix this" probe instead of full regen |

### 5.2 Decomposition hooks

| Hook location | Trigger | Action |
|---|---|---|
| Spec stage (§2.2.6) | Spatial-coupling metric > threshold | Force multi-agent regardless of op count |
| Multi-agent decomposition (§2.8.2) | Components have unstated dependencies | Decomp LLM emits explicit interfaces |
| Agent loop (§2.9.1) | Single agent on a complex task | Encourage incremental validation per construction phase |
| Render fix loop (§2.13.3) | Geometry partially rendered | Pass partial geometry + screenshot to agent |

---

## 6. Validation Methodology — How to Turn ⚠ into ✅

Each ⚠ failure mode in §2 is a hypothesis. To validate, run a targeted query against the production data. Here's the playbook by hypothesis class.

### 6.1 Stage-level evidence queries

**For spec-stage hypotheses (§2.2.1, 2.2.2, 2.2.3):**
```sql
-- find workbench examples where spec is much longer than prompt — proxy for over-constraining
SELECT e.id, p.prompt, length(p.prompt), length(e.spec_raw_response),
       e.eval_score
FROM workbench_examples e JOIN workbench_example_prompts p ON p.id = e.prompt_id
WHERE e.spec_raw_response IS NOT NULL
ORDER BY length(e.spec_raw_response) / GREATEST(length(p.prompt),1) DESC
LIMIT 50;
```

**For RAG hypotheses (§2.5.x):**
- Extract retrieved example IDs from `generation_traces.trace` JSON
- Compute pairwise prompt similarity to detect 5.4 (near-duplicates)
- Compare retrieved-example construction style vs spec-prescribed style for 5.1

**For VLM hypotheses (§2.18.x):**
- VLM experiment table for inter-rater variance (18.5)
- Sample low-visual-high-code and high-visual-low-code pairs for 18.1
- Cross-tab `category` × `feature_scale` (synthesised from prompts) × `visual_score` for 18.2

**For agent-loop hypotheses (§2.9.x):**
- Iterate `generation_traces.trace` JSON, extract tool-call sequences
- Pattern-match for stuck loops (9.2), premature submits (9.3), warning-ignored submits (9.4)
- Compute fraction of runs where `lookup_api` is called at all (6.3)

**For error-classification hypotheses (§2.13.x):**
```sql
SELECT classification, count(*), array_agg(distinct render_error)[1:5] AS samples
FROM workbench_examples WHERE render_status = 'error' AND render_error IS NOT NULL
GROUP BY classification ORDER BY count(*) DESC;
```

### 6.2 Cross-stage correlation queries

- **Spec-length vs eval-score** by complexity class (validates 2.2.1)
- **API_MISUSE error rate vs Tier-2 sections included** (validates 7.1)
- **Multi-agent runs vs spatial-coupling proxy** (operation overlap with mechanical assemblies) — validates 8.1

### 6.3 Output of the validation pass

Update each ⚠ entry in §2 with:
- `evidence_pointer:` query or sample IDs
- `prevalence:` % of runs affected
- `severity_revisited:` confirm or adjust S1/S2/S3
- `recommended_priority:` once we have prevalence × severity, the top-10 list in §7 becomes data-driven

---

## 6.4 Validation Findings — Production Data Snapshot (2026-05-18)

> Queries run against production Postgres on the dates above. Sample sizes per query in the relevant row. ✅ = hypothesis confirmed; ✗ = hypothesis refuted by data; ◐ = partially confirmed / nuanced. The §2 catalogue retains its original ⚠ markers; this section is the *outcome* of validation. Update §2 in next revision.

### 6.4.1 Baseline distributions

| Metric | Value |
|---|---|
| Total workbench examples | 3,436 |
| Auto-approved | 2,814 (81.9%) |
| Pending | 618 (18.0%) |
| Rejected | 4 (0.1%) |
| Render failures | 251 (7.3%) |
| Total generation_traces | 3,208 |
| Avg agent steps per run | 8 |
| Avg agent LLM calls per run | 11 |
| Avg run duration | 4m 53s |
| Avg run cost | $0.94 |
| Max steps observed | 72 (likely stuck-loop case) |

### 6.4.2 Per-category outcomes — the complexity ceiling, quantified

| Rank | Category | Cmplx | Examples | Avg score | Approval% | Render err% | Near-miss % (7.0–7.4) |
|---|---|---|---|---|---|---|---|
| 1 | Primitives | 1 | 209 | 9.21 | 92.8 | 3.8 | 2.4 |
| 2 | Sketch Ops | 2 | 187 | 8.50 | 86.6 | 5.9 | 1.1 |
| 3 | Extrusions | 3 | 155 | 8.85 | 96.1 | 5.2 | 0.0 |
| 4 | Boolean Ops | 4 | 190 | 8.52 | 86.8 | 3.2 | 2.1 |
| 5 | Surface Mods | 5 | 189 | 8.75 | 92.6 | 4.8 | 2.1 |
| 6 | Arrays | 5 | 123 | 8.73 | 92.7 | 4.9 | 0.8 |
| 7 | Simple Everyday | 6 | 172 | 8.21 | 83.1 | 4.1 | 2.9 |
| 8 | Mechanical | 7 | 133 | 7.33 | 69.9 | 8.3 | 3.0 |
| 9 | bd_warehouse | 7 | 180 | 6.94 | **51.7** | **17.2** | **9.4** |
| 10 | Electronic | 8 | 222 | 7.59 | 73.4 | 9.5 | 2.3 |
| 11 | Generic Enclosures | 9 | 116 | 6.83 | **53.4** | **25.9** | 1.7 |
| 12 | **PCB Cases** | 10 | 136 | **5.36** | **5.6** | **38.5** | **17.4** |

**Key reads:**
- Approval rate falls from ~93% (complexity 1–5) to **5.6%** (PCB Cases). The complexity ceiling is real and steep.
- PCB Cases is the disaster category on every axis. Should be **the** focus of any harness improvement that targets one category.
- Render error rate scales 5%→38% with complexity. The harness is producing un-renderable code on a third of attempts at the top end.
- Near-miss bucket (7.0–7.4) is small overall (<3%) — refutes the assumption that "targeted fix loop" (backlog item 9) would have huge impact across the board. **Exception:** PCB Cases (17.4%) and bd_warehouse (9.4%) — there a near-miss path *would* pay off.

### 6.4.3 Hypotheses confirmed (✅)

| # | Hypothesis | Evidence |
|---|---|---|
| 2.18.1 | Per-category visual/code gap varies; one weight doesn't fit all | Gap ranges from -1.20 (PCB Cases, visual much worse) to +0.40 (Mechanical, code stricter). Correlation 0.14–0.67. |
| 2.20.1 | 50/50 weight wrong for organic / mechanical / PCB | Mechanical, Generic Enclosures, bd_warehouse — code more strict (visual gap +0.23 to +0.40). PCB visual completely unreliable. |
| 2.20.4 | Near-miss path only valuable for hard categories | 17.4% near-miss for PCB Cases, 9.4% for bd_warehouse, <3% elsewhere. |
| 2.8.1 | Multi-agent trigger is broken | **2 / ~2,400 prompts trigger** the 6+ ops threshold. avg_ops detected = 2.2–3.4 across categories. Trigger is calibrated for prompts that never occur. |
| 2.9.2 | Stuck-loop pattern | **361 / 2,401 traces (15%)** have ≥3 identical (tool, input) calls. Existing nudge loop helps but doesn't catch. |
| 6.3 | `lookup_api` and `search_*` underused | 7.6% of runs use `lookup_api`, 7.5% `search_knowledge`, 3.7% `search_examples`. Tier 3 mostly idle. |
| 14.2 | Tool calls don't translate to success | Aborted runs use search/lookup tools **15× more** than completed runs (0.76 vs 0.05) — agents reach for these when already failing, and the rescue rate is poor. Suggests either tool results aren't actionable in late-stage failure, or agents only invoke them at the doom point. |
| 2.13.1 | UNKNOWN bucket dominates render errors | 187 / 251 (75%) are the generic "Agent codegen failed to render" — the actual classification from `render-errors.ts` exists at runtime but **isn't persisted in `render_error`**. Post-hoc analysis blocked. |

### 6.4.4 Hypotheses REFUTED or REVERSED (✗)

| # | Hypothesis | Actual finding |
|---|---|---|
| 2.2.1 | Spec over-constraining (length) hurts | **Reversed.** Spec expansion 10×→46× is *positively* correlated with eval score: 10× expansion → 85% approval; 35× → 97%. Only at >50× expansion (8 prompts) does it degrade. The extrusions Pattern C is a category-local artifact, not a general harness flaw. |
| 2.2.2 | Construction-method prescription in spec hurts | **Reversed at high complexity.** Specs WITH construction keywords outperform at every complexity level, with the gap *widening* with complexity: cmplx 7 +0.77 score / +14pp approval; cmplx 9 +1.49 / +23pp; cmplx 10 +1.93 / +20pp. Pattern B is again a category-local Extrusions artifact — for harder parts the construction scaffold is load-bearing. |
| 2.2.5 | Spec regenerated on every retry | **No.** Spec is per-prompt (cached in `workbench_example_prompts.spec_raw_response`). Regenerated only when the prompt text changes (which happens in the workbench prompt-editing loop, not normal retries). |
| 9.3 | Agent submits prematurely without rendering | **Largely false.** Only 3 of 2,401 traces submitted without a successful render. Existing gating works. |
| 10.1 | `str_replace` non-unique target burns retries | **Trivial.** 40 failures across 4,802 text_editor calls = 0.8%. Drop from backlog. |

### 6.4.5 New hypotheses surfaced by the data

| # | Finding | Implication |
|---|---|---|
| N1 | Multi-agent decomposition is **dormant infrastructure** — 1 multi_agent trace out of 3,208 ever; trigger (6+ ops) almost never fires; even PCB Cases avg only 2.8 detected ops | The operation-detection signal is undercounting badly. Either re-calibrate threshold (e.g. complexity ≥ 7 → mandatory multi-agent) or rebuild operation detection. **This is a tier-1 priority** — multi-agent could help the complex categories most, but it isn't being invoked. **Status (2026-05-18):** shipped. Spec LLM now emits `requiresDecomposition` + `decompositionReasoning` on every spec call; routing flips through the resolver in `spec-generation.service.ts`. Operation-count threshold retired. Validation via `scripts/validate-multi-agent-trigger.sh` against experiment d8ac9bae using new `:ma` fake-model columns (Claude column unchanged). **Known limitation:** chat side routes correctly but trace reason is not yet persisted (chat has no `runWithTrace` wrapper today — 0/3,280 traces have chat_item_id). Follow-up plan tracked. |
| N2 | Render errors are not classified at persistence time | 75% of render errors are stored as generic "Agent codegen failed to render". `render-errors.ts` has 7 categories but they don't survive into the row. Cheap fix: persist the classification. Unlocks every error-category hypothesis (§2.13.x). |
| N3 | The agent's `lookup_api` / `search_*` rescue path is reactive, not proactive | Heavy use only in aborted runs (15× the rate of completed runs) — agents reach for these when stuck and it's already too late. Harness should *proactively* call search at the first API_MISUSE error, not wait for the agent to choose. |
| N4 | Iteration distribution shows iteration=3 dominates (1,473 examples, 99% approval) | The pipeline produces 3 candidates by default and keeps the best. Iterations 4–10 have lower approval rates as we scrape harder prompts. **Multi-seed expansion (roadmap §9.1 high priority) is not a major leverage point at low complexity** — those prompts already pass at iteration 3. It's high-complexity prompts (where iteration 4–10 land) where multi-seed actually matters. |
| N5 | bd_warehouse category eval anomaly | 51.7% approval, 17.2% render error, 9.4% near-miss — this category behaves more like a complexity-10 category than a complexity-7. Likely a configuration / RAG mismatch with the bd_warehouse library. Worth a per-category deep-dive separate from the harness audit. |

### 6.4.6 What this changes about the backlog

The next section (§7) was drafted *before* validation. Items 1, 2, and partly 9 should be deprioritised or restructured; new items emerge from §6.4.5.

---

## 7. Prioritized Harness Improvement Backlog — Revised Post-Validation

> v1 draft retained for reference; ↻ marks items revised after §6.4 findings; new items prefixed N. Each will become its own plan under `docs/superpowers/plans/` when picked up.

| # | Improvement | Stages touched | Expected lift | Effort | Notes |
|---|---|---|---|---|---|
| **N1** | **Fix the multi-agent trigger** — replace operation-count threshold with category-complexity threshold (complexity ≥ 7 → mandatory) OR rebuild operation detection so it actually counts | 2.8.1, 2.2.6 | **Very High** — entire infrastructure currently dormant; would route hardest categories through the path designed for them | S (config) to M (rebuild detection) | The single highest-leverage finding |
| **N2** | **Persist render-error classification + sub-classify GEOMETRY** | 2.13.1, 2.13.2 | High — unblocks every error-category hypothesis (§2.13.x) and feeds N3 | S | Just save the classification at write time |
| **N3** | **Proactive `search_knowledge` on first API_MISUSE error** | 6.3, 14.2, agent loop | High — reaches for the rescue tool *before* the agent is doomed | S | Hook in the fix-loop on error class detection |
| 3 | **Per-category eval weights + thresholds** | 2.18.1, 2.20.1, 2.20.2 | High — quantified gap of -1.20 (PCB) to +0.40 (Mechanical) → universal default is wrong | S | Already configurable; just needs defaults table |
| 4 | **Geometric assertions via /analyze/ endpoint** | 2.19.1, 2.19.2 | High at complexity 7+ where value-equality assertions create false fails | M | Requires Build123d service endpoint (roadmap §9.5) |
| 6 | **Multimodal fix loop** — screenshots into agent on render failure | 2.13.3, 3.4 | High — closes the biggest information gap | L | Requires multimodal agent provider |
| 9↻ | **Near-miss targeted-fix loop — scoped to PCB Cases + bd_warehouse only** | 2.20.4 | Medium — concentrated where the bucket is large (17% PCB, 9% bd_warehouse). Skip for other categories where near-miss bucket is <3%. | M | Needs structured eval output |
| **N5** | **bd_warehouse deep-dive** — why does a complexity-7 category behave like complexity-10? | category-specific | High for that category | M | Likely RAG/library config issue, not harness |
| 5↻ | **Visual-first fast pass** — auto-approve if visual ≥ 8.5 — **but never for PCB Cases** where visual is unreliable (corr 0.14) | 2.20, 2.19.5 | Medium cost-save on obviously-correct shapes | S | Per-category enable flag |
| 1↻ | **DROPPED: cap spec extrapolation** — data refutes the hypothesis at all but extreme expansion. Replaced with: detect/skip the >50× expansion edge cases (8 prompts). | — | Near zero | — | Original Pattern A/B/C are Extrusions-only artifacts |
| 2↻ | **DROPPED: cache spec across retries** — already cached at the prompt level. | — | Near zero | — | |
| 10 | **Workbench ambiguity pre-filter** | 2.2.4, 5.1 | Medium — currently only 51 of 2,510 prompts flagged | M | UI + spec workflow |
| 8 | **Negative-example RAG** | 2.5.2, 3.6 | Medium — improves first-attempt rate | M | New table + retrieval path |

---

## 8. Open Questions for the Next Pass

1. Is the spec generation the right place to fix Pattern B (construction prescription), or should we add a *post-processing* step that strips construction directives from any spec? The latter is faster to ship and reversible.
2. For the multimodal fix loop (#6 above): do we add it to the existing agent loop or split into a dedicated "fix" agent? Latter is cleaner but adds orchestration complexity.
3. The "no structural memory across attempts" weakness (§3.5) — is a per-prompt lessons-learned store worth the storage and retrieval complexity, or should we instead increase the score floor for accepting a retry?
4. What's the right per-category threshold for "visual-first fast pass" (#5)? Probably ranges from 7.5 (Hinges) to 9.0 (Primitives). Need data.
5. Should §6's validation queries become first-class admin reports rather than ad-hoc SQL? Would make this doc actively maintained.

---

## 9. Changelog

- **2026-05-19 v1.3** — N1 routing redesigned: cached `requires_decomposition` retired as authority (kept as training-data record only). Live `decomposition-decision.service.ts` makes per-generation, model-tier-aware decisions; version-stamped cache in `decomposition_decisions` table. Per-run `experiment_runs.routing_override` enables A/B ablation of decompose-vs-not on the same prompt set. Plan: `docs/superpowers/plans/2026-05-18-multi-agent-routing-redesign.md`.
- **2026-05-18 v1.2** — N1 (multi-agent trigger) shipped via spec-LLM decision (chat + workbench, no category dependency). Trigger reason persisted on trace top-level field. Validation runs side-by-side with original columns on experiment d8ac9bae using `:ma` fake-model variants registered manually. Plan: `docs/superpowers/plans/2026-05-18-fix-multi-agent-trigger.md`. Known gap: chat-side trace persistence requires a separate follow-up plan (no `runWithTrace` on chat path today).
- **2026-05-18 v1.1** — Added §6.4 validation findings (production data, 3,436 examples / 3,208 traces). Confirmed 8 hypotheses, **refuted 5** (notably 2.2.1 and 2.2.2 — the Extrusions Pattern B/C findings do not generalize beyond that category). Surfaced 5 new high-leverage findings, including the headline one: **multi-agent decomposition is dormant infrastructure** (1 run of 3,208). Revised §7 backlog: dropped items 1 and 2; added N1–N3 as new top items; revised 5, 9. ⚠ markers in §2 still indicate pre-validation; treat §6.4 as the authoritative read.
- **2026-05-18 v1.0** — Initial draft.

*End of document.*
