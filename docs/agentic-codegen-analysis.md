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

### Phase 3: Specification Step (Medium Effort, High Impact) — ✅ Partially Implemented

**3a. Structured Specification Generation** — ✅ Implemented (simplified form)
- Add an intermediate step between conversation LLM and code generation
- LLM produces an interpretation + verification checklist + disambiguation questions
- Interpretation is passed to codegen LLM alongside user prompt
- Disambiguation questions pause generation and ask user for clarification when prompt is ambiguous
- **Quality impact**: Reduces ambiguity; each LLM focuses on its strength
- **Estimated effort**: 1-2 weeks
- **Implementation**: `generateSpec()` in `workbench-codegen.service.ts` and `query.service.ts`; `spec_generation_enabled` toggle per pipeline; spec result includes `interpretation`, `verificationChecklist`, `disambiguationQuestions`
- **Note**: Uses natural-language interpretation rather than the structured JSON spec originally envisioned; the simpler approach proved sufficient

**3b. Spec-to-Code with Verification Questions** — ✅ Partially Implemented (~75%)
- After code generation, generate 3-5 binary verification questions from the spec
- Use VLM to answer these questions against rendered screenshots
- More targeted than current open-ended VLM evaluation
- Example: "Does the model have exactly 3 holes?" rather than "Rate this model 1-10"
- **Quality impact**: +5-9% geometric accuracy (CADCodeVerify research)
- **Estimated effort**: 1 week
- **Implementation**: Full pipeline works end-to-end: `generateSpec()` produces `verificationChecklist` (3-6 binary questions) → passed to `evaluateModel()` in both pipelines → VLM system prompt includes checklist → `parseChecklistResults()` extracts structured `ChecklistResult[]` from VLM response
- **Remaining gaps**:
  - Checklist results not persisted to DB (no schema fields on `WorkbenchExample` or `ChatItem`)
  - Checklist pass/fail not used in approval decisions (score-only)
  - Checklist results not exposed to frontend API
  - No analytics or aggregation of checklist pass rates across examples

### Phase 4: Tiered Knowledge Architecture (Medium Effort, Medium Impact) — ✅ Partially Implemented

**4a. Build123d Knowledge Tiers** — ✅ Implemented (Tier 1+2)
- **Tier 1 (Always loaded, ~220 lines)**: Core patterns, common mistakes, output template, fundamental primitives — ✅ implemented via `CORE_SECTIONS` in `system-prompts.ts`
- **Tier 2 (Task-relevant, ~0-280 lines)**: Loaded based on detected operations from prompt keywords + spec interpretation — ✅ implemented via `detectPromptOperations()` + `buildTieredSystemPrompt()` in `system-prompts.ts`
- **Tier 3 (RAG, on-demand)**: Full API reference, advanced examples, edge cases retrieved from external knowledge base — ⏳ deferred (requires knowledge base infrastructure)
- Use the spec interpretation (Phase 3) to determine which Tier 2 sections to load — ✅ implemented
- **Token savings**: 40-70% of system prompt tokens — ✅ achieved on iteration 1
- Admin toggle: `tiered_prompt_enabled` setting per pipeline — ✅ implemented in `generation-settings.service.ts`
- **Estimated effort**: 1-2 weeks (Tier 1+2); Tier 3 deferred

**4b. Example Selection Refinement** — ⏳ Deferred
- Current: 6 examples via semantic similarity
- Improved: Select examples that match the *operations* needed, not just the *description*
- Tag examples with operation types (fillet, loft, boolean, array, etc.)
- If spec says "loft + fillet," retrieve examples that demonstrate both
- **Quality impact**: More relevant examples = fewer errors
- **Estimated effort**: 1 week

### Phase 5: Models as Projects (High Effort, High Impact) — ⏳ Not Started

The key architectural shift: treat each model as a **multi-file Python project**, not a single disposable script. The agent works in a project directory — reading, writing, and editing files — just as Claude Code works on a software project.

**5a. Project Directory Structure**

Currently, all per-context files live flat in `chat/{contextId}/`:

```
chat/{contextId}/
  {itemId}.b123d
  {itemId}.stl
  {itemId}.step
  {itemId}.3mf
  {itemId}-screenshot-front.png
  ...
```

The new structure separates **artifacts** (render outputs) from **code** (the agent's working directory):

```
chat/{contextId}/
  artifacts/                              # Render outputs (generated, not edited)
    {itemId}.stl
    {itemId}.step
    {itemId}.3mf
    {itemId}-screenshot-{angle}.png
  code/                                   # Agent's working directory (the "project")
    main.py                               # Entry point — imports, assembles, assigns root_part
    components/                           # Reusable component modules
      gear.py                             # e.g., parametric gear generator
      bracket.py                          # e.g., mounting bracket
    utils/                                # Shared helpers
      bolt_patterns.py                    # e.g., common hole patterns
      profiles.py                         # e.g., reusable 2D sketches
    params.py                             # Shared dimensions/constants
```

The agent decides the file structure based on complexity:
- Simple model → single `main.py`
- Multi-component model → `main.py` + component files
- Reusable patterns → extracted into `utils/`
- Shared parameters → `params.py`

The Build123d render service receives the entire `code/` directory (not a single file) and executes `main.py` as the entry point. The `artifacts/` directory is populated by the render service output.

**5b. Build123d Container API Extensions**

The Build123d container currently exposes only `POST /render/`. To support agentic workflows, it needs additional APIs that serve as **tools for the agent**:

| Endpoint | Purpose | Agent Tool Equivalent |
|----------|---------|----------------------|
| `POST /render/` | Execute `main.py`, export .step/.stl/.3mf | Existing — the expensive "build & run" step |
| `POST /validate` | AST parse all .py files, check imports resolve, verify `root_part` defined in `main.py` | Claude Code's `tsc --noEmit` equivalent |
| `POST /analyze` | List defined functions/classes per file, map imports between files, detect unused code | Claude Code's "read and understand the project" |
| `POST /lint` | Check for common Build123d mistakes (the 15+ known issues from the system prompt, as executable checks) | Claude Code's linter |
| `POST /execute-partial` | Run a single file in isolation to verify it doesn't error (without full render/export) | Running a single test file |

All new endpoints accept the project directory as a tar/zip payload or via shared volume mount. They return structured JSON results the agent can reason about.

**Implementation note**: Since the Build123d container already has Python + Build123d installed, these APIs are lightweight additions — `POST /validate` is essentially `python -c "import ast; ast.parse(code)"` with Build123d-specific checks on top. The infrastructure already exists; we're just exposing it.

**5c. Complexity-Based Routing**
- Assess model complexity from the specification (Phase 3)
- Simple models (1-3 operations): Single `main.py`, direct generation
- Medium models (4-8 operations): Single `main.py` with edit-based fixing
- Complex models (9+ operations, multiple components): Multi-file project with component decomposition
- **Estimated effort**: 1-2 days (routing logic)

**5d. Incremental Modification**
- When user says "make the handle longer," the agent reads the project files, identifies which file/function defines the handle, and edits that specific code
- Only the modified file needs re-validation; the full project only re-renders
- Unrelated components are preserved exactly as-is (no regeneration risk)
- **Token savings**: Proportional to project size (10-file project → agent reads and edits 1 file)
- **Estimated effort**: Included in Phase 6 agent implementation

### Phase 6: Agent-Based Orchestration (High Effort, Transformative) — ⏳ Not Started

**6a. Orchestrator Agent**

Replace the linear pipeline with an agent loop that works on the project directory.

#### File Tools: Use Anthropic's Built-In Text Editor Tool

**We do not implement custom file tools.** The Anthropic API provides `text_editor_20250728` — a built-in, schema-less tool that Claude 4.x models are specifically trained to use. It costs only 700 additional input tokens per request and handles file viewing, exact-string replacement, file creation, and line insertion. Claude Code itself is built on this same foundation.

The tool is added to the API request with no schema required:

```typescript
const response = await anthropic.messages.create({
  model: "claude-opus-4-6",
  max_tokens: 8192,
  tools: [
    // Built-in file tool — no schema needed, Claude knows how to use it
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool",
    },
    // Custom Build123d tools defined below
    ...build123dTools,
  ],
  messages: [...],
});
```

Claude outputs `tool_use` blocks with these commands:

| Command | Parameters | Description |
|---------|-----------|-------------|
| `view` | `path`, `view_range?` | Read a file (with optional line range) or list a directory |
| `str_replace` | `path`, `old_str`, `new_str` | Replace exact text — must match uniquely (whitespace-sensitive) |
| `create` | `path`, `file_text` | Create a new file with content |
| `insert` | `path`, `insert_line`, `insert_text` | Insert text after a specific line number |

**Our backend implements the execution layer** — it intercepts these tool_use blocks, maps the `path` parameter to the project directory (`chat/{contextId}/code/`), executes the file operation, and returns the result:

```typescript
function handleTextEditorTool(
  contextId: string,
  command: string,
  input: Record<string, unknown>
): string {
  const projectRoot = `chat/${contextId}/code`;
  const resolvedPath = resolveSafePath(projectRoot, input.path as string);

  switch (command) {
    case "view": {
      if (isDirectory(resolvedPath)) {
        return listDirectory(resolvedPath);
      }
      const content = readFile(resolvedPath);
      const lines = content.split("\n");
      // Return with line numbers (cat -n format) — critical for view_range and insert
      return lines.map((line, i) => `${i + 1}: ${line}`).join("\n");
    }

    case "str_replace": {
      const content = readFile(resolvedPath);
      const count = countOccurrences(content, input.old_str as string);
      if (count === 0) return "Error: No match found for replacement.";
      if (count > 1) return `Error: Found ${count} matches. Provide more context.`;
      const newContent = content.replace(input.old_str as string, input.new_str as string);
      writeFile(resolvedPath, newContent);
      return "Successfully replaced text at exactly one location.";
    }

    case "create": {
      writeFile(resolvedPath, input.file_text as string);
      return "File created successfully.";
    }

    case "insert": {
      const content = readFile(resolvedPath);
      const lines = content.split("\n");
      const insertLine = input.insert_line as number;
      lines.splice(insertLine, 0, input.insert_text as string);
      writeFile(resolvedPath, lines.join("\n"));
      return "Text inserted successfully.";
    }
  }
}
```

**Why this is the right approach:**
- **Claude is already trained on it** — the model knows exactly how to use `str_replace`, `view`, `create`, and `insert`. No prompt engineering needed to teach it a custom Edit tool.
- **Battle-tested** — this is the same mechanism that powers Claude Code, which handles millions of file edits daily.
- **Exact string matching with uniqueness check** — the `str_replace` command requires the target text to be unique in the file, preventing ambiguous edits. If multiple matches exist, the agent must provide more surrounding context. This is the surgical precision we need.
- **No reinvention** — we implement ~50 lines of execution logic, not an entire tool system.
- **Path sandboxing** — our execution layer maps all paths to `chat/{contextId}/code/` and validates no directory traversal, so the agent can only access its project directory.

#### Custom Build123d Tools

The domain-specific tools are defined as standard Vercel AI SDK `tool_use` definitions alongside the built-in text editor:

**Build tools** (call Build123d container APIs):

| Tool | Description |
|------|-------------|
| `validate_project` | AST parse + import check + structure validation (`POST /validate`) |
| `analyze_project` | List functions/classes, imports, dependencies (`POST /analyze`) |
| `lint_project` | Check for common Build123d mistakes (`POST /lint`) |
| `render_project` | Full render → .step/.stl/.3mf + screenshots (`POST /render/`) |
| `run_file(path)` | Execute a single file to verify it works (`POST /execute-partial`) |

**Knowledge tools** (retrieve context on demand):

| Tool | Description |
|------|-------------|
| `lookup_api(topic)` | Retrieve relevant Build123d API docs (tiered knowledge, Phase 4) |
| `search_examples(query)` | Semantic search over workbench examples |
| `search_knowledge(query)` | Search external Build123d knowledge base (see Appendix A) |

**Evaluation tools**:

| Tool | Description |
|------|-------------|
| `evaluate_visual(screenshots, prompt)` | VLM evaluation of rendered model |

#### The Agent Loop

1. Receives the user request + conversation history + existing project state
2. Decides what to do: view files, plan changes, create/edit code, validate, render, evaluate
3. Uses the text editor tool for all file operations and custom tools for Build123d-specific actions
4. Iterates until the model passes validation and VLM evaluation, or max turns reached
5. The agent decides the workflow — not a fixed pipeline

**6b. Agent Coding Principles**

The agent's system prompt includes coding principles (equivalent to CLAUDE.md for the agent). These guide how the agent works on Build123d projects:

1. **Read before edit** — Always read existing code before modifying it. Understand the project structure before making changes.
2. **Edit over write** — Prefer targeted edits to full file regeneration. A one-line fix should change one line, not rewrite the file.
3. **Validate after every change** — Call `validate_project` after each edit. Don't accumulate changes and hope they work.
4. **Single responsibility per file** — One component per file for non-trivial parts. `main.py` is the assembly point.
5. **Extract reusable geometry** — If a pattern appears twice, extract it into `utils/`. If a component is self-contained, give it its own file in `components/`.
6. **Parameters at module level** — Named variables at the top of each file, not hardcoded numbers inline. Shared parameters go in `params.py`.
7. **Keep files focused** — If a file exceeds ~80 lines, consider splitting. Each file should be readable in one pass.
8. **`main.py` is always the entry point** — It imports from components/utils, assembles the model, and assigns `root_part`. The render service executes only `main.py`.
9. **Verify with the cheapest tool first** — `validate_project` (free) → `run_file` (fast) → `render_project` (expensive). Don't render until validation passes.
10. **Use knowledge tools proactively** — When unsure about a Build123d API, call `lookup_api` rather than guessing. When implementing a common pattern, call `search_examples` for reference.

**6c. Multi-Agent for Complex Models**
- Orchestrator agent decomposes into sub-tasks
- Sub-agents handle individual component files in parallel (each in isolated context)
- Each sub-agent has access to the same file and build tools, scoped to its component
- Orchestrator writes `main.py` to assemble the components and handles integration
- **Estimated effort**: 4-6 weeks (on top of 6a)

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
