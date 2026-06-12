# Docs Harmonization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the docs tree reflect the real state of the harness — fix the 12 verified code/docs discrepancies, label historical material, and anchor everything to the three documents written 2026-06-12 (`oss-model-evaluation.md`, `local-model-strategy.md`, `codegen-harness-audit.md` §10).

**Architecture:** Audit-driven. Every fix below cites a discrepancy (D1–D12) verified against code on 2026-06-12. Three doc classes: CURRENT (rewrite to match code), HISTORICAL (label, never rewrite), NEW (already created). No code changes in this plan.

**Tech stack:** Markdown only.

---

## Inventory & verdicts (2026-06-12 audit)

| Doc | Verdict | Action |
|---|---|---|
| `codegen-pipeline-and-workbench.md` (2026-04-05) | STALE in §3.3/§3.4/§3.5/§3.6 | Tasks 1–4 |
| `codegen-harness-audit.md` | CURRENT (v1.4 with §10) | done 2026-06-12 |
| `oss-model-evaluation.md` | NEW | done 2026-06-12 |
| `local-model-strategy.md` | NEW | done 2026-06-12 |
| `roadmap.md` (2026-04-11) | STALE — predates local-model pivot | Task 5 |
| `dataset-release-and-finetune-plan.md` | STALE — finetune runs of May 10/13 not recorded | Task 6 |
| `pricing-and-llm-quality-considerations.md` | PARTIALLY SUPERSEDED by strategy doc | Task 7 |
| `CLAUDE.md` | STALE — workbench/admin API routes missing | Task 8 |
| `dataset-expansion-plan.md`, `tool-use-training-datasets.md`, `operations-runbook.md`, `knowledge-sources.md`, `3rd-party-build123d-libraries.md`, `workbench-pipeline-analysis-extrusions.md` | CURRENT or self-contained | none |
| `freecad-integration-ideas.md`, `step-file-reverse-engineering-ideas.md`, `mobile-app-implementation.md`, `parametric-history-vision.md` | HISTORICAL ideas | Task 9 |
| `docs/superpowers/specs/2026-06-0{7,8}-nemotron-*.md` | HISTORICAL records (superseded by `oss-model-evaluation.md`) | Task 9 |

## Verified discrepancies (code vs docs)

| # | Issue | Code location | Doc location |
|---|---|---|---|
| D1 | Live decomposition decider (5-layer routing precedence) not described | `routing.service.ts` / `workbench-codegen.service.ts:498-530` | pipeline doc §3.4 |
| D2 | Tools `evaluate_model`, `evaluate_code`, `evaluate_checklist` missing from tool list | `agent-tools.service.ts` | pipeline doc §3.3 |
| D3 | `eval_source` enum + `compositeWeightSource` undocumented | `eval-orchestrator.service.ts:56-79` | pipeline doc §3.7 |
| D4 | Phase 2 per-component renders: docs/plan describe in-flight state; now shipped | `agent-multi.service.ts` | Phase 2 plan/spec |
| D5 | Spec enrichment conditions (single-agent only, research-gated) unstated | `spec-enrichment.service.ts` | pipeline doc §3.5 |
| D6 | 24+ settings exist; docs mention ~3 | `generation-settings.service.ts` SETTINGS_REGISTRY | pipeline doc |
| D7 | Adaptive code/visual weight system entirely undocumented | `code-eval-composite.service.ts` | pipeline doc §3.7 |
| D8 | Research package flow (technique decomp, per-component filtering, sub-agent preloading) oversimplified | `research-agent.service.ts`, `agent-multi.service.ts:150-202` | pipeline doc §3.5 |
| D9 | Incremental trace persistence (early row → updates → finalize) undescribed | `trace-persistence.service.ts` | pipeline doc §3.6 |
| D10 | "Phase 0/1/2" terminology used without definition | — | harness audit (fixed by §10 context note); pipeline doc needs glossary line |
| D11 | Phase 1 occlusion-routing dispatcher described as current; Phase 2 reverted it | `checklist-eval.service.ts:99-119` | Phase 0+1 design doc |
| D12 | Assertions described as exact dimensional checks; they're fuzzy regex matchers with soft-fail semantics | `code-eval-assertions.service.ts` | pipeline doc §3.2 |

---

### Task 1: Pipeline doc — agent loop & tools section (D2, D12)

**Files:** Modify: `docs/codegen-pipeline-and-workbench.md` §3.3

- [ ] Add the three missing tools to the tool table with one-line descriptions and availability conditions: `evaluate_model` (VLM eval of current render; gates submit quality), `evaluate_code` (code review + assertion check), `evaluate_checklist` (per-item visual+code verification; sub-agent/assembler flows)
- [ ] Note which tools are disabled per role: sub-agents (`enableSearch=false`), `render_project` guard for sub-agents (Phase 2: sub-agents use `validate_and_render` with auto-wrap)
- [ ] In the assertions paragraph (§3.2), replace "dimensional checks" wording: assertions are fuzzy regex matchers generated at spec time; failure semantics = hard stop for the eval chain (skip VLM), soft on the example record
- [ ] Commit: `docs: pipeline doc — complete tool inventory, correct assertion semantics (D2, D12)`

### Task 2: Pipeline doc — routing section rewrite (D1, D10)

**Files:** Modify: `docs/codegen-pipeline-and-workbench.md` §3.4

- [ ] Replace the operation-count framing with the implemented 5-layer precedence: (1) per-run override → (2) MULTI_PART_PATTERN regex → (3) `timeout_observed` sticky override → (4) live decomposition decider (`routing.service.ts`, model-tier-aware, version-stamped cache in `decomposition_decisions`) → (5) single-agent default
- [ ] Add one-line glossary: Phase 0/1 = hygiene + occlusion routing (2026-06-06), Phase 2 = per-component renders (2026-06-07)
- [ ] Commit: `docs: pipeline doc — document live decomposition decider and phase glossary (D1, D10)`

### Task 3: Pipeline doc — research, enrichment, traces (D5, D8, D9)

**Files:** Modify: `docs/codegen-pipeline-and-workbench.md` §3.5, §3.6

- [ ] §3.5: document research package shape (techniques[], examples[], knowledge[], gapWarnings[]), per-component filtering for multi-agent, sub-agent search-disabled + preloaded-knowledge pattern
- [ ] §3.5: state enrichment preconditions (spec exists AND research returned knowledge AND `workbench.spec_enrichment_enabled`); note it does not run per-sub-agent
- [ ] §3.6: describe incremental trace persistence: early trace row + placeholder example at pipeline start, per-phase updates, finalize-on-end-or-error; survives backend restarts
- [ ] Commit: `docs: pipeline doc — research/enrichment/trace persistence detail (D5, D8, D9)`

### Task 4: Pipeline doc — eval & settings reference (D3, D6, D7)

**Files:** Modify: `docs/codegen-pipeline-and-workbench.md` (new §3.9 + appendix)

- [ ] New §3.9 "Composite scoring": weight blend formula, weight source precedence (eval_plan → adaptive → global), adaptive weighting mechanism (visibility-driven shift, `global.adaptive_weight_range`), assertion penalty, disagreement clarification pass
- [ ] Document `eval_source` enum (`agent_submitted` | `composite` | `code_only` | `assertion_fail`) with the trust ranking and the F-OSS-3 inflation warning (cross-link audit §10.2)
- [ ] Appendix: settings reference table — all SETTINGS_REGISTRY keys with default/min/max/purpose (generate from `generation-settings.service.ts`; mark doc as "regenerate when registry changes")
- [ ] Commit: `docs: pipeline doc — composite scoring, eval_source, full settings reference (D3, D6, D7)`

### Task 5: Roadmap refresh

**Files:** Modify: `docs/roadmap.md`

- [ ] Add a "2026-06 status" section: Phase 2 per-component renders shipped (v6.2, +0.93 multi-agent); OSS model A/B series complete (link `oss-model-evaluation.md`); local-model strategy adopted (link `local-model-strategy.md`, milestones M0–M5)
- [ ] Mark superseded roadmap items that assumed frontier-only codegen economics
- [ ] Commit: `docs: roadmap — 2026-06 status, local-model pivot`

### Task 6: Dataset/finetune plan update

**Files:** Modify: `docs/dataset-release-and-finetune-plan.md`

- [ ] Record completed runs: `chat3d-build123d-01` (2026-05-10, Qwen3.6-27B, combined real traces) and `chat3d-build123d-02-synthetic-16k` (2026-05-13, synthetic, 16k seq, merged + benchmarked at 14.2 tps c=1 BF16)
- [ ] Record the open measurement: neither finetune has a harness-cohort quality score (strategy M1)
- [ ] Add the SFT data filtering rule from strategy §4 (agent_submitted ≥ 7.5 only; never code_only; filter by step efficiency)
- [ ] Commit: `docs: dataset plan — record May finetune runs and SFT filter rules`

### Task 7: Pricing doc cross-link

**Files:** Modify: `docs/pricing-and-llm-quality-considerations.md`

- [ ] Add header note: model-selection conclusions superseded by `local-model-strategy.md` (2026-06-12); cost-analysis methodology remains valid
- [ ] Commit: `docs: pricing doc — supersession note`

### Task 8: CLAUDE.md route list

**Files:** Modify: `CLAUDE.md`

- [ ] Add the missing API route families to the routes section: `/api/admin/workbench/*` (categories, prompts, examples, generate jobs, export, transfer, import, embeddings status), `/api/admin/llm-purposes`, generation-settings routes already present — verify against `workbench.routes.ts` and `admin.routes.ts` at edit time
- [ ] Commit: `docs: CLAUDE.md — complete admin API route inventory`

### Task 9: Historical labeling

**Files:** Modify: 4 idea docs + 8 nemotron spec files (header lines only)

- [ ] Prepend to `freecad-integration-ideas.md`, `step-file-reverse-engineering-ideas.md`, `mobile-app-implementation.md`, `parametric-history-vision.md`: `> **Status: HISTORICAL** — idea document, not on the active roadmap (see roadmap.md).`
- [ ] Prepend to each `2026-06-0{7,8}-nemotron-*.md` spec: `> **Status: HISTORICAL RECORD** — raw run log; consolidated + corrected numbers live in docs/oss-model-evaluation.md.`
- [ ] Do NOT rewrite any content in these files
- [ ] Commit: `docs: label historical idea docs and raw A/B run records`

### Task 10: Phase 2 docs closure (D4, D11)

**Files:** Modify: `docs/superpowers/specs/2026-06-07-phase2-per-component-renders-design.md`, `docs/superpowers/specs/2026-06-06-phase0-hygiene-phase1-occlusion-design.md` (header notes)

- [ ] Phase 2 design doc: add header `> Shipped 2026-06-07 (v6.2, commit 8f97838). Advisory gate replaced the hard composite gate during rollout — see 2026-06-07-phase2-v6.2-test-results.md.`
- [ ] Phase 0+1 design doc: add header note that the Phase 1 occlusion-routing dispatcher was reverted by Phase 2 Task 3 (visibility now flows from spec-time annotatedCriteria)
- [ ] Commit: `docs: close out Phase 2 / Phase 0+1 design docs with shipped-state notes (D4, D11)`

---

## Self-review checklist

- Every D1–D12 is covered by exactly one task (D1→T2, D2→T1, D3→T4, D4→T10, D5→T3, D6→T4, D7→T4, D8→T3, D9→T3, D10→T2, D11→T10, D12→T1) ✓
- No task rewrites historical content ✓
- All claims to verify at edit time against code, not against this plan (code moves) ✓
