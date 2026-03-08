# Agentic Code Generation Analysis: Learning from Claude Code

## Executive Summary

Chat3D currently uses a **one-shot-with-retry** approach to Build123d code generation: a single LLM call produces complete code, which is rendered and visually evaluated, with fix iterations feeding errors back for regeneration. While this works, it mirrors early AI coding tools rather than modern agentic approaches.

Claude Code — Anthropic's open-source CLI — demonstrates a fundamentally different philosophy: **treat code as a living project, not a disposable artifact**. Instead of generating complete files from scratch, it reads existing code, makes targeted edits, verifies results, and iterates. This analysis examines what Chat3D can learn from that approach to reduce token waste, improve quality, and handle complex models more reliably.

---

## Part 1: How Chat3D Works Today

### Current Pipeline

```
User Prompt
    │
    ▼
┌─────────────────────────────┐
│ Stage 1: Conversation LLM   │  Decides: [CODEGEN_NEEDED] or [CHAT_ONLY]
│ (with multimodal support)    │  Outputs: natural language plan
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Stage 2: Code Generation    │  One-shot LLM → full Build123d Python script
│ (with few-shot examples)    │  Uses: CODEGEN_SYSTEM_PROMPT (450+ lines of API ref)
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Render via Build123d        │  POST to external service → .step/.stl/.3mf
│ (infra retry: 5x, 2s exp)  │  Classifies errors: infrastructure vs code
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Screenshot (8 angles)       │  front/back/left/right/top/bottom/iso/iso_back
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ VLM Evaluation              │  Score (1-10) + issues + suggestions
│ (vision model)              │  Tracks best iteration by score
└─────────────┬───────────────┘
              │
              ▼
         ┌────┴────┐
         │ Fix?    │── score >= threshold → DONE (use best iteration)
         └────┬────┘── iteration >= max   → DONE (use best iteration)
              │
              ▼
┌─────────────────────────────┐
│ Fix Loop (buildFixPrompt)   │  Includes: previous code + render errors +
│ Full code regeneration      │  VLM issues + VLM suggestions + error history
└─────────────┴───────────────┘
              │
              ▼
         (back to Render)
```

### Key Characteristics

| Aspect | Current Approach |
|--------|-----------------|
| **Code generation** | One-shot: entire script generated from scratch each iteration |
| **Context** | Conversation history (last 5 pairs) + few-shot examples (6 via RAG) |
| **Fix strategy** | Full regeneration with error context appended to prompt |
| **System prompt** | 450+ lines of Build123d API reference, always included |
| **Modification flow** | `buildModificationPrompt`: sends previous working code + new request |
| **Token cost per fix** | Full system prompt + full code + error context each iteration |
| **File treatment** | Code is a byproduct to store, not a project artifact to edit |
| **Planning** | Conversation LLM decides intent; no structured planning for the model itself |

### What Works Well

1. **VLM evaluation loop** — Visual validation with scoring is ahead of many systems. The research confirms this approach yields 7-9% accuracy improvement.
2. **Best-iteration tracking** — Keeping the highest-scored iteration rather than the latest prevents regression.
3. **Error classification** — Separating infrastructure errors from code errors avoids wasting LLM calls on network issues.
4. **Few-shot retrieval** — Semantic search for relevant examples grounds the LLM in working patterns.
5. **Fire-and-forget async** — Good UX; user isn't blocked waiting.

### What Could Be Better

1. **Full regeneration on every fix** — Each iteration regenerates the entire script (~200-500 tokens of code), even if the fix is a single line. This wastes tokens and risks introducing new bugs in previously working code.
2. **No structured planning step** — The LLM jumps straight from user intent to full code. No intermediate decomposition for complex models.
3. **Flat context management** — The entire 450-line API reference is included every time. No tiered knowledge loading.
4. **No edit-based refinement** — The fix loop regenerates from scratch rather than targeting specific issues.
5. **No sub-task decomposition** — Complex multi-part models are attempted in a single generation, increasing failure probability.
6. **Code not treated as persistent artifact** — Previous code is context for the next generation, not a living document to refine incrementally.

---

## Part 2: How Claude Code Works

### Core Architecture

Claude Code uses a **single-threaded master agent loop** (internally "nO"):

```
while (response has tool calls):
    1. Normalize/compact context if needed
    2. Stream model response
    3. Detect tool calls
    4. Execute tools, collect results
    5. Re-enter loop with updated history
```

Three conceptual phases blend together: **gather context → take action → verify results**. A single bug fix might cycle through all three phases multiple times.

### Key Design Principles

| Principle | How It Works |
|-----------|-------------|
| **Edit over Write** | Strong preference for targeted `Edit` (exact string replacement) over `Write` (full file). A one-line fix sends ~2 lines, not 500. |
| **Read before Edit** | The tool system *enforces* reading a file before editing it. You must understand code before changing it. |
| **Verify after change** | After every edit, run tests/build to confirm. If it fails, read the error, fix, re-verify. |
| **Progressive narrowing** | Start with Glob (file patterns) → Grep (content search) → Read (specific files). Don't load everything upfront. |
| **Context is precious** | 200K token window. Automatic compaction at 92-95% utilization. Sub-agents get separate context windows. |
| **Plan before complex work** | Plan mode: read-only exploration → structured plan → user approval → execution. |
| **Sub-agents for isolation** | Delegate research/exploration to sub-agents with separate context. Only summaries come back. |

### Tool System (14+ built-in tools)

| Category | Tools | Key Insight |
|----------|-------|-------------|
| **File ops** | Read, Write, Edit, MultiEdit | Edit is the workhorse — precise, reviewable, token-efficient |
| **Search** | Glob, Grep, LS | Progressive narrowing to find relevant code |
| **Execution** | Bash | Run tests, builds, any shell command |
| **Web** | WebSearch, WebFetch | Research capabilities |
| **Orchestration** | Agent (sub-agents), TodoRead/TodoWrite | Task decomposition and delegation |

### Sub-Agent Architecture

| Agent Type | Model | Purpose |
|------------|-------|---------|
| **Explore** | Haiku (fast/cheap) | File discovery, code search |
| **Plan** | Inherited | Research during plan mode |
| **General-purpose** | Inherited | Complex multi-step tasks |

Sub-agents **cannot spawn sub-agents** (preventing recursive explosion) and run in **isolated context windows** — their exploration doesn't bloat the main conversation. Up to 7 can run in parallel.

### Context Management Strategy

1. **Tiered loading**: CLAUDE.md always loaded; other files loaded on demand
2. **Automatic compaction**: At 92-95% context, older tool outputs are cleared, conversation is summarized
3. **Sub-agent isolation**: Research happens in separate context windows; only summaries return
4. **Prompt caching**: Static prefixes (system prompts, API docs) cached at 75% cost reduction
5. **System reminders**: Key instructions repeated after tool uses to prevent drift in long sessions

---

## Part 3: Gap Analysis

### Fundamental Paradigm Differences

| Dimension | Chat3D (Current) | Claude Code Paradigm |
|-----------|-------------------|---------------------|
| **Code lifecycle** | Generate → discard → regenerate | Read → understand → edit → verify |
| **Fix approach** | Full regeneration with error hints | Targeted edit to the specific issue |
| **Context strategy** | Everything upfront, every time | Progressive narrowing, load on demand |
| **Planning** | Implicit (conversation LLM decides) | Explicit plan step for complex tasks |
| **Decomposition** | Single generation for entire model | Sub-tasks with separate context per component |
| **Verification** | External (VLM after render) | Internal (run immediately after each edit) |
| **Knowledge management** | Flat (450-line system prompt always) | Tiered (hot memory / specialist agents / RAG) |
| **Token efficiency** | ~Full cost per iteration | Incremental cost per edit |

### Specific Gaps and Opportunities

#### Gap 1: Full Regeneration vs. Targeted Editing

**Current**: Every fix iteration sends the full system prompt (450+ lines) + full previous code + error context to generate a completely new script. If the issue is a missing `Mode.SUBTRACT` parameter, the LLM regenerates 200+ lines of code to fix one argument.

**Claude Code approach**: Read the code, identify the specific issue, make a targeted edit (`old_string` → `new_string`), then verify.

**Opportunity**: After the first successful generation, subsequent iterations should use an **edit-based approach** where the LLM identifies what to change and produces structured diffs/edits rather than regenerating the full file.

**Estimated token savings**: 31-60% per fix iteration (research: patch generation reduces tokens by 31%; avoiding full API ref on fixes adds further savings).

#### Gap 2: No Intermediate Specification

**Current**: User says "make a gear" → LLM directly outputs Build123d Python code.

**Claude Code approach**: Understand the request → plan the approach → implement.

**Research**: The forma-ai-service project (also Build123d-based) uses a Designer Agent that produces a structured technical specification before the Coder Agent writes code. This separation allows each LLM to focus on its strength.

**Opportunity**: Add a **specification step** that produces a structured, verifiable intermediate representation:
```
User: "Create a planetary gear set with sun gear, 3 planet gears, and ring gear"

Specification:
- Components: sun_gear (d=20mm, 20 teeth), planet_gear (d=15mm, 15 teeth) × 3, ring_gear (d=50mm, 50 teeth)
- Arrangement: planets at 120° intervals, 17.5mm from center
- Constraints: teeth must mesh (module = 1mm), ring gear internal teeth
- Assembly: all gears on same plane, z=0
```

This specification can be validated before code generation, reducing wasted render cycles.

#### Gap 3: Flat Context Loading

**Current**: The 450+ line CODEGEN_SYSTEM_PROMPT (full Build123d API reference) is included in every single LLM call — initial generation, every fix iteration, and modifications.

**Claude Code approach**: Three-tier knowledge architecture:
- **Tier 1 (Hot)**: Always loaded — core conventions, critical patterns (~660 lines)
- **Tier 2 (Warm)**: Loaded per task — specialist knowledge via sub-agents
- **Tier 3 (Cold)**: Retrieved on demand via RAG

**Research**: A codified context study showed 67.8% token reduction by structuring domain knowledge in compact, code-like formats vs. prose.

**Opportunity**: Restructure Build123d knowledge into tiers:
- **Always loaded** (~100 lines): Core Build123d patterns, common mistakes, output template
- **Task-relevant** (~50-150 lines): Only the API sections needed (e.g., if user asks for a "vase," load Loft/Revolve docs, not GridLocations/Boolean ops)
- **RAG-retrieved**: Full API reference, examples, advanced techniques — pulled only when relevant

#### Gap 4: No Sub-Task Decomposition

**Current**: "Create a chess piece set" is attempted as a single code generation — the LLM must produce all pieces in one script.

**Claude Code approach**: Break complex tasks into independent sub-tasks that can be worked on separately, potentially in parallel with isolated context windows.

**Opportunity**: For complex multi-part models, decompose into:
1. Plan the components and their relationships
2. Generate each component independently (can be parallelized)
3. Compose into final assembly
4. Verify the assembly

This mirrors the **CodeChain** pattern from research: "identify and cluster representative sub-modules, then refine each independently."

#### Gap 5: No Self-Verification Before Render

**Current**: Generated code goes directly to the Build123d render service. Syntax errors, missing imports, and obvious logical issues consume a full render round-trip.

**Claude Code approach**: After editing code, immediately run it to verify. Catch errors at the cheapest possible point.

**Opportunity**: Add a **pre-render validation** step:
- AST parse the Python code (catch syntax errors instantly, no render needed)
- Static analysis: check that referenced Build123d classes/methods exist
- Template validation: ensure `root_part` is defined, exports are valid
- Only send to the expensive render service if pre-validation passes

#### Gap 6: Fix Context Doesn't Escalate Strategically

**Current**: `buildFixPrompt` includes the raw error + VLM issues. Error history tracking provides escalated guidance, but the approach is still "here's everything, regenerate."

**Claude Code approach**: Read the error → understand the root cause → make a targeted fix → verify.

**Research**: The **Self-Healing Code** pattern builds a knowledge graph of the code's structure (data flows, control flows, invariants). LogicStar's approach enables deeper reasoning about bugs.

**Opportunity**: Structure fix prompts as **diagnostic chains**:
1. "The render failed with: `NameError: 'fillet_edges' is not defined on line 47`. The previous code assigned edges on line 43. What specifically needs to change?"
2. Rather than regenerating, ask for a **structured edit response**: `{"line": 47, "old": "fillet_edges", "new": "selected_edges", "reason": "variable was renamed on line 43"}`

---

## Part 4: Research-Backed Recommendations

### From Academic Literature

| Source | Key Finding | Relevance to Chat3D |
|--------|------------|---------------------|
| **CADCodeVerify** (arxiv 2410.05340) | VLM-generated binary validation questions improve geometric accuracy by 7.3% | Already partially implemented via VLM eval; could be enhanced with structured questions |
| **Codified Context** (arxiv 2602.20478) | Three-tier knowledge reduces tokens by 67.8% while maintaining quality | Direct application: restructure Build123d API reference |
| **AgentDiet** (arxiv 2509.23586) | Pruning unnecessary context from agent histories reduces tokens 40-60% | Apply to fix loop: strip intermediate failures, keep only latest code + relevant errors |
| **LLMLOOP** (TU Wien) | Adaptive temperature (start 0, +0.1 per retry) improves fix success | Easy to implement in existing fix loop |
| **MapCoder** | Retrieval → Planning → Coding → Debugging pipeline outperforms single-stage | Validates the specification step recommendation |
| **PairCoder** | Navigator (strategic) + Driver (tactical) two-tier architecture | Validates planning/specification separation from code generation |
| **Multi-agent study** (arxiv 2505.02133) | Analyst-Coder + Debugger beats complex multi-agent setups | Keep it simple: don't over-engineer the agent architecture |
| **Code Surgery** (fabianhertwig.com) | Diff-based edits reduce tokens 31% with <5% quality loss | Apply to fix iterations |
| **CodeFast** (arxiv 2407.20042) | Early termination improves speed 34-452% | Detect when LLM is generating unnecessary preamble/explanations |

### From Claude Code's Open-Source Design

| Pattern | Application to Chat3D |
|---------|----------------------|
| **Edit over Write** | Fix iterations should produce targeted edits, not full regeneration |
| **Read before Edit** | Parse and understand existing code before attempting fixes |
| **Sub-agent isolation** | Complex models: decompose into sub-tasks with separate context windows |
| **Plan mode** | Add explicit planning/specification step before code generation |
| **Progressive narrowing** | Load only relevant API docs, not the full 450-line reference every time |
| **Verify immediately** | Pre-render validation (AST parse, static checks) before expensive render |
| **Context compaction** | Strip earlier failed iterations from fix prompt context |
| **System reminders** | Reinforce critical Build123d constraints at each iteration |

---

## Part 5: Proposed Multi-Phase Improvement Plan

### Phase 1: Quick Wins (Low Effort, High Impact) — ✅ Implemented

**1a. Pre-Render Validation** — ✅ Implemented
- Add Python AST parsing before sending to Build123d service
- Check for `root_part` definition, valid imports, basic structure
- Skip render round-trip for obvious syntax/structural errors
- **Token savings**: Eliminates wasted render + VLM + fix cycles for trivially broken code
- **Estimated effort**: 1-2 days
- **Implementation**: `POST /api/admin/validate-code` endpoint; AST validation runs in codegen pipeline before render

**1b. Adaptive Temperature in Fix Loop** — ✅ Implemented
- Start fix iterations at temperature 0 (deterministic)
- Increment by 0.1 per failed fix attempt
- Introduces variability to escape local minima where the LLM keeps making the same mistake
- **Estimated effort**: Hours
- **Implementation**: `codegen_base_temperature` and `codegen_temperature_step` generation settings

**1c. Context Pruning in Fix Prompts** — ✅ Implemented
- Strip intermediate failed code from fix context
- Keep only: latest code + latest error + cumulative issue summary
- Don't carry forward VLM issues that were already addressed
- **Token savings**: 20-40% per fix iteration
- **Estimated effort**: 1 day
- **Implementation**: Fix prompts in `workbench-codegen.service.ts` and `query.service.ts` carry only latest code + error

### Phase 2: Structured Edit-Based Fixing (Medium Effort, High Impact) — ✅ Implemented

**2a. Edit-Based Fix Response Format** — ✅ Implemented
- After initial generation succeeds (code renders), switch fix iterations to an edit-based approach
- Instead of: "Here's the code, error, and issues — regenerate everything"
- Ask for: "Here's the code and error. What specific changes fix it? Respond with the exact lines to change."
- Parse structured edit responses and apply them to existing code
- Fall back to full regeneration if edit parsing fails
- **Token savings**: 31-60% per fix iteration
- **Estimated effort**: 3-5 days
- **Implementation**: `shouldUseEditMode()`, `parseEditResponse()`, `applyEdits()` in `utils/code-edits.ts`; wired into both pipelines

**2b. Reduced System Prompt for Fix Iterations** — ✅ Implemented
- Initial generation: full 450-line Build123d API reference
- Fix iterations: condensed reference (~100 lines) covering only the patterns relevant to the error category
- Error-specific API guidance (e.g., fillet error → include edge selection docs)
- **Token savings**: 50-70% of system prompt tokens on fix iterations
- **Estimated effort**: 2-3 days
- **Implementation**: `buildReducedSystemPrompt()` in `system-prompts.ts` with `detectCodeFeatures()` matching; `CORE_SECTIONS` + `CONDITIONAL_SECTIONS` architecture

### Phase 3: Specification Step (Medium Effort, High Impact) — ✅ Implemented

**3a. Structured Specification Generation** — ✅ Implemented (simplified form)
- Add an intermediate step between conversation LLM and code generation
- LLM produces an interpretation + verification checklist + disambiguation questions
- Interpretation is passed to codegen LLM alongside user prompt
- Disambiguation questions pause generation and ask user for clarification when prompt is ambiguous
- **Quality impact**: Reduces ambiguity; each LLM focuses on its strength
- **Estimated effort**: 1-2 weeks
- **Implementation**: `generateSpec()` in `workbench-codegen.service.ts` and `query.service.ts`; `spec_generation_enabled` toggle per pipeline; spec result includes `interpretation`, `verificationChecklist`, `disambiguationQuestions`
- **Note**: Uses natural-language interpretation rather than the structured JSON spec originally envisioned; the simpler approach proved sufficient

**3b. Spec-to-Code with Verification Questions** — ✅ Implemented
- After code generation, generate 3-5 binary verification questions from the spec
- Use VLM to answer these questions against rendered screenshots
- More targeted than current open-ended VLM evaluation
- Example: "Does the model have exactly 3 holes?" rather than "Rate this model 1-10"
- **Quality impact**: +5-9% geometric accuracy (CADCodeVerify research)
- **Estimated effort**: 1 week
- **Implementation**: Full pipeline works end-to-end: `generateSpec()` produces `verificationChecklist` (3-6 binary questions) → passed to `evaluateModel()` in both pipelines → VLM system prompt includes checklist → `parseChecklistResults()` extracts structured `ChecklistResult[]` from VLM response
- **Checklist persistence**: `eval_checklist_results` JSONB column on `WorkbenchExample`; stored as `ChecklistResult[]` (question, pass, detail) and exposed via the admin API `getExample()` endpoint
- **Approval integration**: `shouldAutoApprove()` requires both score ≥ threshold AND ≥ 80% checklist pass rate (when checklist present); prevents auto-approving models that score well but fail specific verification questions

### Phase 4: Tiered Knowledge Architecture (Medium Effort, Medium Impact) — ✅ Implemented

**4a. Build123d Knowledge Tiers** — ✅ Implemented (All 3 Tiers)
- **Tier 1 (Always loaded, ~220 lines)**: Core patterns, common mistakes, output template, fundamental primitives — ✅ implemented via `CORE_SECTIONS` in `system-prompts.ts`
- **Tier 2 (Task-relevant, ~0-280 lines)**: Loaded based on detected operations from prompt keywords + spec interpretation — ✅ implemented via `detectPromptOperations()` + `buildTieredSystemPrompt()` in `system-prompts.ts`
- **Tier 3 (RAG, on-demand)**: External knowledge base with 516 entries (docs, GitHub examples, tests), validated and embedded — ✅ implemented via `knowledge.service.ts`, `knowledge-crawl.service.ts`, `knowledge-source.service.ts`. Agent tool `search_knowledge(query)` performs semantic search over the validated corpus.
- Use the spec interpretation (Phase 3) to determine which Tier 2 sections to load — ✅ implemented
- **Token savings**: 40-70% of system prompt tokens — ✅ achieved on iteration 1
- Admin toggle: `tiered_prompt_enabled` setting per pipeline — ✅ implemented in `generation-settings.service.ts`
- Knowledge base admin UI: `KnowledgeTab.tsx` with source management, crawl triggers, validation/embedding pipeline, entry browser

**4b. Example Selection Refinement** — ✅ Implemented
- `detected_operations` TEXT[] column on `workbench_example_prompts` with GIN index
- Operations auto-detected on prompt creation via `detectPromptOperations()`; 1,101 existing prompts backfilled
- `findSimilarExamples()` accepts optional `boostOperations` parameter
- Re-ranking: fetches 3x candidates, scores with 70% semantic similarity + 30% operation overlap, returns top N
- Wired into both chat (`query.service.ts`) and workbench (`workbench-codegen.service.ts`) pipelines
- Admin backfill endpoint: `POST /api/admin/workbench/operations/backfill`
- **Quality impact**: More relevant examples = fewer errors; examples matching the same operations (loft, fillet, etc.) are prioritized

### Phase 5: Models as Projects (Foundation) — ✅ Partially Complete

Lays the structural foundation for treating models as projects (Phase 6 agent loop). Delivers standalone value via lint enforcement, complexity-based fix capping, and project code tracking.

**5a. Project Directory Structure** — ✅ Implemented

File storage restructured from flat layout to `code/` + `artifacts/` subdirectories for both chat and workbench domains:

```
chat/{contextId}/
  artifacts/                              # Render outputs
    {itemId}.stl
    {itemId}.step
    {itemId}.3mf
    {itemId}-screenshot-{angle}.png
  code/                                   # Source code
    {itemId}.b123d
  {contextId}-{uuid}.{ext}               # User uploads (unchanged)
```

- One-time data migration (`v2_file_restructure`) moves existing files and rewrites DB path references (JSONB in `chat_items.messages`, columns in `workbench_examples`)
- Data migration runner (`run-data-migrations.ts`) executes between `prisma migrate deploy` and app start; tracked in `data_migrations` table for idempotency
- All services updated: file serving, workbench data transfer (export/import), curation promotion (chat → workbench)
- Multi-file projects (`components/`, `utils/`, `params.py`) deferred to Phase 6

**5b. Build123d Lint Rules** — ✅ Implemented

10 AST-based lint rules merged into the existing `/validate/` endpoint (zero pipeline orchestration changes — both chat and workbench pipelines get lint for free):

| Rule ID | What it catches | Severity |
|---------|----------------|----------|
| `no_box_centered` | `Box()` with `centered` kwarg | error |
| `no_shell_class` | Call to `Shell()` | error |
| `locations_bare_int` | `Locations()` with bare int args | error |
| `no_export_calls` | `export_step()`, `Mesher()` | warning |
| `no_build123d_import` | `from build123d import *` | warning |
| `no_forbidden_imports` | `import sys`, `matplotlib`, etc. | error |
| `no_show_calls` | `show()`, `show_object()` | error |
| `no_interactive` | `input()`, `print()` | warning |
| `missing_make_face` | `BuildLine` in `BuildSketch` without `make_face()` | warning |
| `fillet_before_boolean` | `fillet()`/`chamfer()` before boolean ops | warning |

Lint errors (severity=`"error"`) cause `valid=false`. Warnings are returned for informational use and logged. Workbench pipeline now also calls `/validate/` before render (was missing).

- `POST /analyze`, `POST /execute-partial` deferred to Phase 6 ⏳
- Multi-file `/render/` deferred to Phase 6 ⏳

**5c. Complexity-Based Routing** — ✅ Implemented (simplified)

- Complexity derived from `detectPromptOperations()` count: 0-2 → `"simple"`, 3-5 → `"medium"`, 6+ → `"complex"`
- Simple prompts cap `maxFixIterations` to admin-tunable `simple_max_fix_cap` (default: 3)
- No additional LLM call needed — deterministic computation from existing spec data

**5d. Project Code Tracking** — ✅ Implemented

- `code_projects` table: one per chat context, stores `current_code` and `last_rendered_item_id`
- `code_project_versions` table: version history with code snapshots per successful render
- Modification detection now uses `getProjectCode(contextId)` (reliable, survives message deletion) with fallback to `findMostRecentCode()` for backward compat
- After successful render: `updateProjectCode()` persists working code atomically

**5e. Incremental Modification** — ⏳ Deferred to Phase 6
- When user says "make the handle longer," the agent reads the project files, identifies which file/function defines the handle, and edits that specific code
- Only the modified file needs re-validation; the full project only re-renders
- Unrelated components are preserved exactly as-is (no regeneration risk)

### Phase 6: Agent-Based Orchestration (High Effort, Transformative) — ✅ Implemented

Replaced the linear pipeline with an agent loop using Vercel AI SDK `generateText()` with `stopWhen` conditions and Anthropic's `text_editor_20250728` built-in tool for file operations.

**6a. Core Components**

- **Agent codegen service** (`agent-codegen.service.ts`): Agent loop using `generateText()` with `stopWhen` conditions. The agent decides the workflow — view files, plan changes, create/edit code, validate, render — iterating until the model passes validation or max turns reached.
- **Agent filesystem** (`agent-filesystem.service.ts`): In-memory virtual filesystem (`Map<string, string>`) with `view`, `create`, `str_replace`, and `insert` operations, path validation, and line number formatting. Executes Anthropic `text_editor_20250728` tool_use blocks against the VFS.
- **Custom agent tools**: `validate_code`, `render_project`, `search_examples`, `lookup_api`, `submit_result` — all callable by the agent during the tool-use loop alongside the built-in text editor.
- **Build123d multi-file endpoints**: `/render-project/` and `/validate-project/` in `main.py` for multi-file project rendering and validation.
- **Multi-file project support**: `code_projects.current_files` JSONB column, `updateProjectFiles()` and `getProjectFiles()` service functions.

**6b. Feature Flags & Configuration**

Agent mode is behind generation settings (default: off):
- `chat.agent_mode_enabled` — enables agent mode for chat codegen
- `workbench.agent_mode_enabled` — enables agent mode for workbench codegen
- Requires `agent_codegen` LLM purpose configured in the admin UI
- **Provider requirement**: Requires direct Anthropic provider (not Bedrock) for `text_editor_20250728` tool support

**6c. Multi-Agent for Complex Models** — ✅ Implemented
- `decomposePrompt()` uses LLM to split complex prompts into 2-6 independent components
- Sub-agents run sequentially via `runAgentCodegen()` with `disableRender: true` (validate-only, no wasted renders)
- Each sub-agent gets isolated `AgentFilesystem` + component-specific system prompt
- Assembly agent receives all component files via `initialFiles`, writes `main.py` to import/assemble, validates, renders
- Automatic fallback to single-agent if decomposition fails or produces no components
- Triggered when `complexity === "complex"` and agent mode enabled (non-modification scenarios)
- Progress updates flow through to frontend: decomposing → component [N/M] → assembling
- Usage tracking accumulates across all sub-agents + assembly agent

---

## Part 6: Expected Impact Summary

| Phase | Token Savings | Quality Improvement | Effort |
|-------|--------------|--------------------|----|
| 1: Quick Wins | 20-40% on fix iterations | Fewer wasted render cycles | Days |
| 2: Edit-Based Fixing | 31-60% on fix iterations | Fewer regressions in fixes | 1 week |
| 3: Specification Step | Neutral (adds 1 call, saves on fixes) | +10-20% success rate | 2-3 weeks |
| 4: Tiered Knowledge | 40-70% on system prompt | Fewer API hallucinations | 2-3 weeks |
| 5: Models as Projects | 50-90% on modifications | Multi-file decomposition, incremental edits | 4-6 weeks |
| 6: Agent Orchestration | Variable (smarter tool use) | Adaptive problem-solving, project-aware | 6-10 weeks |

### Cumulative Effect

Phases 1-4 are **additive and independent** — they can be implemented in any order and each provides standalone value. Together, they could reduce per-query token consumption by **40-60%** while improving first-attempt success rate by **15-25%**.

Phases 5-6 are **transformative** — they change the paradigm from "generate and fix" to "plan, build, and refine." They're most valuable for complex models where the current one-shot approach frequently fails.

---

## Part 7: Key Architectural Insight

The deepest lesson from Claude Code is not about any specific technique — it's about **treating generated code as a living artifact** rather than a disposable output.

Today, Chat3D generates Build123d code like a one-off conversation response: produce it, render it, maybe fix it, store it. Each fix is a fresh generation that happens to include the previous code as context.

Claude Code treats code as a **project**: it reads existing files, understands their structure, makes precise changes, verifies those changes work, and iterates. The code persists. The edits are incremental. The context is managed carefully.

The shift from **"generate code"** to **"work on code"** is the fundamental change that would most improve Chat3D's pipeline. Every specific recommendation in this analysis flows from that core insight:

- **Edit-based fixing** = work on existing code instead of regenerating
- **Specification step** = understand what you're building before writing code
- **Pre-render validation** = verify immediately after changing code
- **Tiered knowledge** = load what you need, when you need it
- **Sub-task decomposition** = break complex work into manageable pieces
- **Agent orchestration** = let the LLM decide what to do next based on results

---

## Appendix A: External Build123d Knowledge Sources

### Problem

Build123d is a niche library. LLMs hallucinate incorrect class names, wrong argument order, and invalid geometry operations because their training data contains limited Build123d content. The workbench (see `build123d-llm-workbench.md`) addresses this for fine-tuning with curated examples, but the **runtime agent** also needs access to community knowledge — patterns, idioms, and working code from documentation, GitHub repos, and community posts.

This is distinct from the workbench's example library. The workbench contains validated prompt→code pairs for training. The external knowledge base contains **reference material** the agent consults when it encounters an unfamiliar API pattern or needs to implement a technique it hasn't seen in the few-shot examples.

### Sources and Quality Assessment

| Source | Volume | Quality | Staleness Risk | Crawl Difficulty |
|--------|--------|---------|----------------|-----------------|
| **build123d docs** (readthedocs) | ~200 pages, comprehensive API ref + tutorials | High — maintained by the author | Low — tracks releases | Low — structured HTML |
| **build123d repo** (examples/, tests/) | ~100+ working examples | Very high — tested in CI | Low — same repo as the library | Low — just read .py files |
| **CadQuery discourse forum** | Thousands of threads, many with Build123d code | Variable — some outdated, some excellent | Medium — old posts may reference deprecated API | Medium — needs thread extraction |
| **Blog posts / tutorials** | Scattered, maybe dozens | Variable | High — may reference old API versions | High — varied formats |
| **GitHub repos** using build123d | 50-100 repos | Variable | Medium | Medium — need to find and filter |

### Recommended Approach: Pre-Crawled Validated Corpus

Build123d's ecosystem is small enough (~few thousand quality snippets total) to be **fully indexed** rather than relying on live search. The approach:

1. **One-time crawl** of known high-quality sources → extract code snippets with surrounding context (description, title, source URL)
2. **Validation pipeline**: Run each snippet through the Build123d container's `POST /validate` endpoint to confirm it parses and uses valid APIs. Tag with the Build123d version it was validated against. Flag or discard broken snippets.
3. **Embed and index**: Store validated snippets with vector embeddings (same infrastructure as workbench examples — pgvector with `text-embedding-3-large`)
4. **Agent tool**: `search_knowledge(query)` performs semantic search over the validated corpus. Returns working, tested code the agent can reference and adapt.
5. **Periodic refresh**: Re-crawl on Build123d version updates. Re-validate all snippets against the new version. Flag newly broken ones.

### Knowledge Entry Format

```typescript
interface Build123dKnowledgeEntry {
  id: string;                    // UUID
  sourceUrl: string;             // Where it came from
  sourceType: "docs" | "github_example" | "github_test" | "forum" | "blog";
  title: string;                 // "Creating a helical spring"
  description: string;           // Context around the code
  code: string;                  // The actual Python snippet
  concepts: string[];            // ["helix", "sweep", "spring", "BuildLine"]
  build123dVersion: string;      // Version it was validated against
  validatedAt: Date;             // Last successful validation
  qualityScore: number;          // 1-10, from automated checks + manual curation
  embedding: number[];           // Vector embedding for semantic search
}
```

### Database Schema

```sql
CREATE TABLE build123d_knowledge (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url          TEXT NOT NULL,
  source_type         VARCHAR(20) NOT NULL
                      CHECK (source_type IN ('docs', 'github_example', 'github_test', 'forum', 'blog')),
  title               VARCHAR(500) NOT NULL,
  description         TEXT,
  code                TEXT NOT NULL,
  concepts            TEXT[] NOT NULL DEFAULT '{}',
  build123d_version   VARCHAR(20),
  validated_at        TIMESTAMPTZ,
  quality_score       INTEGER CHECK (quality_score BETWEEN 1 AND 10),
  embedding           vector(1536),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_b123d_knowledge_embedding ON build123d_knowledge
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_b123d_knowledge_concepts ON build123d_knowledge
  USING gin (concepts);
CREATE INDEX idx_b123d_knowledge_source_type ON build123d_knowledge(source_type);
```

### Crawl Strategy Per Source

**build123d docs (highest priority)**:
- Fetch all pages from readthedocs
- Extract code blocks (```` ```python ... ``` ````) with their surrounding heading + paragraph context
- Each code block becomes one knowledge entry
- Concepts extracted from the heading hierarchy (e.g., "Tutorials > Loft Operations" → `["loft", "tutorial"]`)

**build123d repo examples/ and tests/**:
- Clone the repo, read all `.py` files in `examples/` and `tests/`
- Each file becomes one knowledge entry (or split at function boundaries for test files)
- Title from filename; description from docstrings or comments
- Concepts extracted from Build123d API calls used in the code

**CadQuery discourse forum (lower priority)**:
- Search for posts tagged or mentioning "build123d"
- Extract code blocks from replies marked as solutions or with high vote counts
- Filter: only posts from the last 2 years, only posts with code that contains `build123d` imports
- Higher curation effort required — forum code often has typos or is incomplete

### Relationship to Workbench Examples

The knowledge base and workbench examples serve different purposes and are accessed differently:

| Aspect | Workbench Examples | Knowledge Base |
|--------|-------------------|----------------|
| **Purpose** | Training data for fine-tuning | Runtime reference for the agent |
| **Content** | Complete prompt→code pairs | Code snippets with context |
| **Quality gate** | VLM evaluation score ≥ 7 | Validates against Build123d (parses + runs) |
| **Access** | Few-shot examples in codegen prompt | Agent tool: `search_knowledge(query)` |
| **Volume** | 1,000-10,000 curated examples | ~1,000-3,000 indexed snippets |
| **Origin** | Generated by our LLM pipeline | External community content |

Both are searchable via the same embedding infrastructure. The agent's `search_examples` tool queries workbench examples; `search_knowledge` queries the external corpus. They can be combined in a single search when the agent needs the broadest possible reference set.

### Implementation Scope

This is **future work** — not in the initial agentic implementation phases. The initial agent can rely on:
- The existing few-shot examples from the workbench
- The Build123d API reference in the system prompt (tiered, Phase 4)

The knowledge base becomes valuable when:
- The agent encounters patterns not covered by the workbench examples
- The system prompt is trimmed to Tier 1 (core patterns only) and the agent needs on-demand API docs
- Users request complex models that require advanced Build123d techniques

A reasonable first step would be crawling just the **build123d docs + repo examples** (~300 entries), validating them, and making them available via `search_knowledge`. This covers the highest-quality content with minimal curation effort.

---

## Sources

### Anthropic API — Text Editor Tool
- [Text Editor Tool Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) — Built-in `text_editor_20250728` tool: commands, reference implementation, error handling, integration examples
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — Official tool input/output type definitions

### Claude Code Architecture
- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [Claude Code open-source repository](https://github.com/anthropics/claude-code)
- [Claude Code: Behind-the-scenes of the master agent loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/)
- [Agent design lessons from Claude Code](https://jannesklaas.github.io/ai/2025/07/20/claude-code-agent-design.html)
- [Under the Hood of Claude Code](https://medium.com/@yuxiaojian/under-the-hood-of-claude-code-its-not-magic-it-s-engineering-e1336c5669d4)
- [Claude Code Agent Architecture: Single-Threaded Master Loop](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding)
- [What Is Claude Code's Plan Mode?](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/)
- [Claude Code's Tool System Explained](https://callsphere.tech/blog/claude-code-tool-system-explained)
- [Claude Code Built-in Tools Reference](https://www.vtrivedy.com/posts/claudecode-tools-reference)
- [Tools and system prompt of Claude Code (Gist)](https://gist.github.com/wong2/e0f34aac66caf890a332f7b6f9e2ba8f)
- [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams)
- [Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)

### Academic Research
- [CADCodeVerify: Generating CAD Code with Vision-Language Models](https://arxiv.org/html/2410.05340v1)
- [AI Agentic Programming: A Survey](https://arxiv.org/html/2508.11126v1)
- [A Survey on Code Generation with LLM-based Agents](https://arxiv.org/html/2508.00083v1)
- [Enhancing LLM Code Generation: Multi-Agent Collaboration and Runtime Debugging](https://arxiv.org/html/2505.02133v1)
- [Codified Context: Infrastructure for AI Agents in a Complex Codebase](https://arxiv.org/html/2602.20478v1)
- [AgentDiet: Improving Efficiency through Trajectory Reduction](https://arxiv.org/pdf/2509.23586)
- [Token-Efficient Framework for Codified Multi-Agent Systems](https://arxiv.org/pdf/2507.03254)
- [LLMLOOP: Improving LLM-Generated Code](https://valerio-terragni.github.io/assets/pdf/ravi-icsme-2025.pdf)
- [CodeFast: When to Stop? Efficient Code Generation](https://arxiv.org/pdf/2407.20042)
- [Context Engineering for Multi-Agent LLM Code Assistants](https://arxiv.org/html/2508.08322v1)
- [From Idea to CAD: Language Model-Driven Multi-Agent System](https://arxiv.org/html/2503.04417v1)
- [Generative AI for CAD Automation](https://arxiv.org/html/2508.00843v1)

### Industry & Related Projects
- [forma-ai-service: 3D CAD generation with multi-agent Build123d pipeline](https://github.com/andreyka/forma-ai-service)
- [Self-Healing Software: Closing the Agentic Coding Loop](https://logicstar.ai/blog/closing-the-agentic-coding-loop-with-self-healing-software)
- [AI Agents with Visual Feedback in CAD](https://medium.com/@gianlucabailo/ai-agents-experiment-with-visual-feedback-in-cad-an-early-exploration-8a3fe8009b84)
- [Code Surgery: How AI Assistants Make Precise Edits](https://fabianhertwig.com/blog/coding-assistants-file-edits/)
- [Token Efficiency Guide](https://edwardbx.com/articles/token-efficiency)
- [LLM Token Optimization](https://redis.io/blog/llm-token-optimization-speed-up-apps/)
- [Agentic Coding Recommendations (Armin Ronacher)](https://lucumr.pocoo.org/2025/6/12/agentic-coding/)
