# Chat3D — Product Vision & Roadmap

> **Status:** Living document. Last updated 2026-04-05.

---

## Product Vision

Chat3D is a **prompt-to-CAD workspace**: users describe 3D parts in natural language and receive production-ready geometry (STL, STEP, 3MF) through an interactive conversation. The app should feel like talking to a CAD engineer — you describe what you need, see the result immediately, give feedback, and iterate until the part is right.

The conversational UX is complete. The current focus is **code generation quality** — an agentic pipeline with tool use, multi-angle VLM evaluation, a curated Build123d knowledge base, and a workbench for generating fine-tuning data. The next milestone is training an open-weight LLM on this curated dataset. See [`codegen-pipeline-and-workbench.md`](codegen-pipeline-and-workbench.md) for the full architecture.

### Core Experience

The user opens a chat, types "Design a spur gear with 20 teeth and a 5mm bore", and within seconds sees:

1. An assistant reply explaining the approach
2. Generated Build123d Python code (viewable but not required to understand)
3. A 3D model rendered in the browser that can be rotated and inspected
4. Download buttons for STL, STEP, and 3MF files

If the result isn't right, the user says "make the teeth wider" or "add a chamfer to the bore" and the model regenerates. The conversation is the interface — not menus, not parameter forms, not a scripting console.

### Design Principles

1. **Conversation is primary.** The chat thread is the main workspace. Everything else (3D preview, file downloads, code view) supports the conversation — not the other way around.
2. **Show, don't tell.** Every response with geometry should show it visually. The 3D preview should be prominent, not an afterthought tucked in a corner.
3. **Progressive disclosure.** Show the result first (3D model + downloads). Code, parameters, and metadata are available but not in-your-face. Power users can expand them; casual users never need to see them.
4. **Fast feedback loops.** The time from "send" to "see the model" should feel short. Use streaming, optimistic UI, and skeleton states to maintain perceived speed.
5. **Self-hosted and private.** All data stays on the user's infrastructure. The only external calls are to the LLM provider the user configures.

---

## What's Done

### Conversational UX (Phases 1–4) — ✅ Complete

The foundation: streaming chat, inline 3D preview, iterative refinement, and polished design.

- Full chat-to-model pipeline (two-stage LLM: conversation + codegen)
- Streaming assistant responses via SSE with typing indicators
- Inline 3D preview with turntable animation in chat thread
- Progressive disclosure — code/files collapsed by default, download pills inline
- Iterative refinement — conversation history passed to LLM, follow-up modifications work naturally
- Model version history with sequence numbers and prompt summaries
- Error recovery loop — rendering failures auto-retried with LLM correction
- Conversational error display with follow-up suggestions
- Camera controls toolbar (reset, zoom to fit, fullscreen) on ModelViewer
- Example prompts and capability hints in empty state
- Mobile auto-switch to workbench on new model generation
- Multi-format export (STL, STEP, 3MF, Build123d source)
- In-browser 3D preview (Three.js with ThreeMFLoader)
- Design token system, dark-only theme (Space Mono font), lucide-react icons
- Design upgrades DQ1–DQ6 all complete (tokens, icons, animations, dark mode)
- Component architecture — ChatPage and AdminPanel decomposed into sub-components

### Agentic Code Generation Pipeline — ✅ Complete

Replaced the simple prompt-response codegen with a full agent loop. See [`codegen-pipeline-and-workbench.md`](codegen-pipeline-and-workbench.md) for details.

- **Agent codegen** — Vercel AI SDK `generateText()` with tool-use loop (validate, render, search examples/knowledge, text editor, submit)
- **Custom text_editor tool** — Provider-agnostic replacement for Anthropic's built-in tool, works with any LLM provider
- **Multi-agent decomposition** — Complex prompts (6+ operations) split into 2–6 sub-agents with isolated filesystems, then assembled
- **Spec generation** — Pre-codegen LLM analysis: interpretation, verification checklist, code assertions, disambiguation questions
- **Tiered system prompt** — 25 composable sections with operation-aware loading (Tier 1 core always, Tier 2 task-relevant, Tier 3 on-demand via tools)
- **Pre-render validation** — Build123d `/validate/` endpoint with 10 AST-based lint rules
- **Error classification** — 7 categories with domain-specific fix guidance (infrastructure, API misuse, geometry, kernel, syntax, type, unknown)
- **Infrastructure retry** — Exponential backoff for Build123d service timeouts (distinct from code errors)
- **Agent-only mode** — Non-agent iteration loops removed; agent pipeline is the only codegen path
- **Execution tracing** — Live DAG visualization of agent steps with incremental persistence
- **Configurable pipeline settings** — Max steps, timeouts, temperature, code eval weight, multi-agent toggle — all via admin UI

### Evaluation System — ✅ Complete

Multi-modal evaluation: visual (VLM) + code review + deterministic assertions.

- **VLM evaluation** — 9-angle screenshots (front, back, left, right, top, bottom, isometric, ortho_45, ortho_45_bottom) scored 1–10
- **Verification checklist** — Spec-generated binary yes/no questions evaluated by VLM
- **VLM-guided zoom** — VLM can request high-res re-renders of specific regions (max 5 per eval)
- **Code evaluation** — Assertion checker (regex-based, deterministic) + code review LLM scoring
- **Composite scoring** — Configurable visual/code weight blend with assertion penalty and disagreement handling
- **Auto-approval** — Score ≥ threshold AND ≥ 80% checklist pass → approved for training dataset
- **VLM eval in chat** — User-facing generations also evaluated (not just workbench)

### Build123d Knowledge Base — ✅ Complete

~630 entries from multiple sources, powering RAG context for code generation. See [`knowledge-sources.md`](knowledge-sources.md).

- **Crawl pipeline** — GitHub files, test functions, ReadTheDocs pages, manual entries, reference uploads, reference URLs
- **~630 entries** — Build123d examples (65), tests (230), docs Python files (48), ReadTheDocs (209), bd_warehouse (13), community tutorials (27), reference specs (~38)
- **Validation pipeline** — Build123d marker check + Python syntax check via `/validate/` endpoint
- **Embeddings** — OpenAI `text-embedding-3-large` at 1536 dims, pgvector HNSW index
- **Hybrid search** — Semantic (cosine similarity) + lexical (PostgreSQL full-text search) merged via Reciprocal Rank Fusion
- **Few-shot retrieval** — Operation-aware re-ranking (70% semantic + 30% operation overlap), up to 6 examples per generation
- **Reference knowledge** — Non-code content (connector dimensions, fastener specs, dev board datasheets, 3D printing guidelines) stored as Markdown
- **Keyword-based pre-retrieval** — ~20 tag groups auto-inject matching reference entries into codegen prompt (USB-C, HDMI, RPi, Arduino, etc.)
- **Knowledge admin UI** — Source management, crawl triggers, validation, entry CRUD, search, Markdown rendering
- **Knowledge export/import** — Backup system integration

### Third-Party Library Integrations — ✅ Complete

- **bd_warehouse** — Parametric mechanical components (fasteners, bearings, gears) with system prompt guidance
- **gridfinity_build123d** — Parametric Gridfinity storage bins

### LLM Workbench (Training Data Generation) — ✅ Complete

Fully implemented admin-only sub-project for generating fine-tuning data. All WB phases done.

- **Complexity curriculum** — 12 categories (Primitives → PCB Cases + Hinges), 100 prompts each
- **Category/prompt CRUD** — Admin management, seeding from catalog
- **Automated pipeline** — Spec → agent codegen → screenshot → VLM + code eval → auto-approve/flag
- **Batch generation** — Job queue with progress tracking, "Generate Missing" button per category
- **Workbench embeddings** — All approved examples embedded for few-shot retrieval
- **Operation detection** — `detected_operations` TEXT[] on prompts with GIN index
- **Training dataset export** — LLaMA-Factory JSONL format
- **Prompt improvement** — LLM-assisted prompt optimization (126 prompts improved)
- **Re-evaluation** — Re-run VLM eval on existing examples with new settings
- **Re-rendering** — Re-render existing examples with updated pipeline
- **Spec backfill** — Batch backfill specs for existing examples
- **Data quality report** — Identify issues across the dataset
- **RAG gap analysis** — Intelligent decomposition to find missing technique coverage

### User Content Curation Pipeline — ✅ Complete

Promotes high-quality user chat results into workbench examples. See [`user-content-curation.md`](user-content-curation.md). All 4 phases done.

- **Signal tracking** — `download_count` on chat items, rating signals
- **Admin review queue** — Candidates with ≥ 1 like or ≥ 1 download
- **LLM prompt distillation** — Multi-turn conversations summarized into single prompts
- **Tag suggestion** — LLM suggests tags, matching existing tags when possible
- **Approval workflow** — Promote to workbench with file copy, embedding generation, tag attachment
- **Similarity check** — Embed distilled prompt, compare against workbench to prevent duplicates
- **Remix roundtrip** — Lineage tracking, approve-as-improvement workflow for gallery models

### Experiment Framework — ✅ Complete

Admin tools for systematic model comparison and pipeline tuning.

- **Model comparison experiments** — Define variable matrix (models, few-shot counts), run against approved prompts
- **Multi-category selection** — Run experiments across selected workbench categories
- **Few-shot count as variable** — Test impact of 0/2/4/6 examples
- **Experiment execution** — Streaming LLM calls, RAG exclusion, timeout handling
- **Comparison views** — Side-by-side results, outlier detection, delta columns, failure reasons
- **VLM experiments** — Compare VLM evaluation models/settings with re-evaluation support
- **Run management** — Edit finished experiments, retry failed runs
- **URL-based navigation** — Deep-linkable experiment detail views

### Frontend & UX — ✅ Complete

Major UX evolution since initial phases.

- **ChatGPT-style sidebar** — Unified navigation with chat list, admin sub-menu in scrollable area
- **Admin separate pages** — Tabs converted to distinct routes with sidebar sub-menu
- **Public model gallery** — Carousel with deep-links, category previews, featured models
- **Gallery starter prompts** — Gallery-sourced example prompts + onboarding tracking
- **Learn More page** — In-depth pipeline explanation
- **Remix from gallery** — Users can remix gallery models into their own chats
- **Staged reveal animations** — Chat and gallery page transitions
- **Pull-to-refresh** — PWA standalone mode support
- **Lazy 3D viewers** — Deferred loading for performance
- **i18n** — English and German language support
- **Responsive improvements** — Mobile chat overflow fixes, auto-resize textarea, iOS auto-zoom prevention

### User Management & Auth — ✅ Complete

- **Email confirmation** — Required for all registrations when enabled
- **Password reset flow** — Token-based email reset
- **HTML email templates** — Handlebars + i18n (waitlist confirmation, password reset, invitation)
- **Legal pages** — Terms, privacy, imprint + cookie consent banner
- **Admin user deletion** — Permanent deletion for deactivated accounts
- **Account deletion worker** — Background sweep for expired deactivation windows
- **Pre-filled registration** — Email from waitlist approval and invitation links

### Operations & Observability — ✅ Complete

- **LLM usage tracking** — Per-call cost attribution with provider/model/purpose breakdown
- **Cost explorer** — Charts with expanded color palette, per-context cost tracking
- **Pipeline analytics** — Detail views vs. submissions timeseries, angle breakdown, avg cost charts
- **Output TPS tracking** — Tokens per second with streaming estimation
- **System backup/restore** — Full backup shell scripts + admin UI, ZIP export with model files + chunked import
- **Provider model fetching** — Auto-discover models from provider APIs, provider type configuration
- **Generation settings admin** — Key-value overrides for pipeline parameters with defaults

### Infrastructure — ✅ Complete

- **Multi-provider LLM support** — OpenAI, Anthropic, xAI, Ollama, Amazon Bedrock
- **Prompt caching** — Vercel AI SDK v6 `cache_control` with 4,096 token minimum handling
- **JWT auth** with bcrypt, admin roles, route guards
- **Waitlist mode** with email verification and invitation controls
- **SSE real-time updates** and notification center
- **Docker Compose deployment** — PostgreSQL, Build123d, screenshot service, backend, frontend
- **Code projects** — Per-context project tracking (`code_projects` + `code_project_versions` tables), version history
- **File storage restructure** — `chat/{contextId}/code/` + `artifacts/` layout, data migration runner

---

## Roadmap — What's Next

### Near-Term: Fine-Tuning & Dataset Expansion
> Priority: **High** — the core quality improvement path

| Item | Description | Effort |
|------|-------------|--------|
| **Multiple seeds for dataset expansion** | Re-run each prompt with varied temperature/seeds (1K → 10K examples) | Medium |
| **Fine-tune Qwen3-Coder-Next** | LoRA fine-tune on curated dataset using Unsloth on DGX Spark | Large |
| **Tool use training data mix** | Mix ~230K public function-calling examples into domain data ([research](tool-use-training-datasets.md)) | Medium |
| **Shadow testing** | Run fine-tuned model in parallel, compare against commercial API on benchmark set | Medium |
| **Quality benchmark** | Define ~50 representative prompts across difficulty levels for evaluation | Small |

### Near-Term: Library Integrations
> Priority: **High** — quick wins that improve generation quality

| Item | Description | Effort |
|------|-------------|--------|
| **py_gearworks** | Advanced gear library (spur, helical, meshing, backlash) — pip install + prompt section | Small |
| ~~**Fusion360 Gallery Dataset**~~ | ~~Index 7,683 Build123d scripts~~ — **dropped**: non-commercial license, sketch-and-extrude only, raw OCP bindings not idiomatic | — |
| **bd_beams_and_bars** | Structural profiles (UPN, IPN, flat bars) | Small |
| **Additional knowledge sources** | gridfinity specs, FreeCAD FastenersWB CSVs, BOLTS YAML, community repos | Medium |

### Medium-Term: Product Features
> Priority: **Medium** — significant features for user experience

| Item | Description | Effort | Design Doc |
|------|-------------|--------|------------|
| **Mobile app** | Capacitor WebView shell + FCM push notifications for iOS/Android | Large | [`mobile-app-implementation.md`](mobile-app-implementation.md) |
| **STEP file reverse engineering** | Upload STEP → VLM + parsing → Build123d code (editable starting point) | Large | [`step-file-reverse-engineering-ideas.md`](step-file-reverse-engineering-ideas.md) |
| **Pricing & monetization** | Starter (EUR 20) / Pro (EUR 49) tiers, generation caps, trial limits | Large | [`pricing-and-llm-quality-considerations.md`](pricing-and-llm-quality-considerations.md) |
| **Local inference (DGX Spark)** | Deploy fine-tuned model on-prem, traffic splitting by tier/complexity | Large | [`pricing-and-llm-quality-considerations.md`](pricing-and-llm-quality-considerations.md) |
| **Reference image grounding** | Fetch real-world images (Bing/Google) for VLM evaluation grounding | Medium | — |
| **FreeCAD addon** | Chat panel inside FreeCAD, STEP auto-import | Medium | [`freecad-integration-ideas.md`](freecad-integration-ideas.md) |

### Long-Term: Platform Evolution
> Priority: **Low** — significant architecture changes, explore when foundation is solid

| Item | Description | Effort | Design Doc |
|------|-------------|--------|------------|
| **Parametric history / timeline** | Fusion360-like operation tree: timeline scrubbing, selective undo, edit-in-place, branching | Very Large | [`parametric-history-vision.md`](parametric-history-vision.md) |
| **Topology-preserving viewer** | STEP in browser (occt-import-js or server-side tessellation) for face/edge selection | Large | [`parametric-history-vision.md`](parametric-history-vision.md) |
| **Interactive UI operations** | Click-to-fillet, click-to-chamfer — requires topology-preserving viewer | Very Large | [`parametric-history-vision.md`](parametric-history-vision.md) |
| **CadQuery codegen target** | Alternative engine, works in FreeCAD CadQuery workbench | Medium | [`freecad-integration-ideas.md`](freecad-integration-ideas.md) |
| **Native FreeCAD scripting** | Full parametric models with feature trees | Large | [`freecad-integration-ideas.md`](freecad-integration-ideas.md) |

### Deferred / Low Priority

| Item | Description |
|------|-------------|
| Color in examples | ~5% of prompts; 3MF color export + VLM color eval |
| JSONL export preview | Preview training data export before downloading |
| Batch endpoint rate limiting | Throttle `/generate/batch` requests |
| PDF → Markdown converter | Requires `pdf-parse` dependency for knowledge base |
| Two-stage retrieval with LLM planning | Keyword pre-retrieval is sufficient for now |
| Build123d /analyze endpoint | Code structure analysis (AST info, dependency graph) |
| Build123d /execute-partial | Partial execution for debugging intermediate geometry |

---

## Related Design Documents

| Document | Description |
|----------|-------------|
| [`codegen-pipeline-and-workbench.md`](codegen-pipeline-and-workbench.md) | Architecture deep-dive: agent pipeline, eval system, knowledge, workbench |
| [`knowledge-sources.md`](knowledge-sources.md) | External knowledge base sources, crawl strategies, reference pipeline |
| [`parametric-history-vision.md`](parametric-history-vision.md) | Future vision: Fusion360-like feature timeline from Build123d operations |
| [`mobile-app-implementation.md`](mobile-app-implementation.md) | Capacitor mobile app + FCM push notifications |
| ~~`user-content-curation.md`~~ | Removed — all 4 phases complete, summarized in this roadmap |
| [`freecad-integration-ideas.md`](freecad-integration-ideas.md) | FreeCAD integration paths (STEP exchange, addon, codegen target) |
| [`step-file-reverse-engineering-ideas.md`](step-file-reverse-engineering-ideas.md) | STEP → Build123d code reconstruction approaches |
| [`3rd-party-build123d-libraries.md`](3rd-party-build123d-libraries.md) | Build123d ecosystem survey and integration candidates |
| [`pricing-and-llm-quality-considerations.md`](pricing-and-llm-quality-considerations.md) | Pricing tiers, DGX Spark economics, traffic splitting strategies |
| [`tool-use-training-datasets.md`](tool-use-training-datasets.md) | Public datasets for fine-tuning tool use capabilities |
| [`operations-runbook.md`](operations-runbook.md) | Deployment, health checks, recovery procedures |

---

## Retained Guidelines

### UI Component Rules

**Layout primitives:** AppShell, PageHeader, SectionCard, EmptyState, InlineAlert
**Interaction primitives:** CommandBarTrigger, DropdownMenu, Dialog, Drawer, ToastProvider + useToast, Tabs

**Form standards:**
- Use FormField for labels + helper/error messaging
- Show validation close to the field
- Mark required inputs with `*`
- Use DestructiveActionNotice before irreversible actions
- Destructive submit requires explicit confirmation dialog

**Anti-patterns:**
- No ad hoc spacing values when tokenized spacing works
- No duplicate alert styles — use InlineAlert
- No destructive controls next to primary submit without visual separation
- No hidden action outcomes — show toast + inline confirmation
- No dense tables on mobile — use card/list view

### Accessibility Baseline

- Dialog/drawer overlays support Escape close and focus trapping
- Focus restoration when overlays close
- Explicit header/main/footer landmarks
- Route/group navigation labels for screen readers
- Reduced-motion CSS fallback disables non-essential animation
- Tokenized palette and typography scale applied across all pages

### Residual Technical Risks

- Automated contrast ratio checks not yet in CI
- Authenticated visual snapshots are manual
- 3D viewer bundle size above warning threshold (consider further code splitting)
