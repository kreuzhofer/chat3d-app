# Chat3D — Product Vision & Roadmap

> **Status:** Living document. Replaces `design_upgrade_plan.md`.

---

## Product Vision

Chat3D is a **prompt-to-CAD workspace**: users describe 3D parts in natural language and receive production-ready geometry (STL, STEP, 3MF) through an interactive conversation. The app should feel like talking to a CAD engineer — you describe what you need, see the result immediately, give feedback, and iterate until the part is right.

The conversational UX is complete. The next frontier is **code generation quality** — fine-tuning an open-weight LLM on a curated Build123d dataset so the underlying model reliably produces correct geometry without hallucinations. The [Build123d LLM Workbench](build123d-llm-workbench.md) is the sub-project driving this effort.

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

## Current State

### What's Done

The app is functionally complete through milestones M1–M15, design upgrades DQ1–DQ6, and UX conversational experience (spec 002):

- Full chat-to-model pipeline (two-stage LLM: conversation + codegen)
- Streaming assistant responses via SSE with typing indicators
- Inline 3D preview with turntable animation in chat thread
- Progressive disclosure — code/files collapsed by default, download pills inline
- Build123d API reference enrichment in codegen prompt with example snippets
- Error recovery loop — rendering failures auto-retried with LLM correction
- Conversational error display — errors shown as messages with follow-up suggestions
- Iterative refinement — conversation history (5 exchange pairs) passed to LLM
- Model version history in workbench with sequence numbers and prompt summaries
- Example prompts and "What can I build?" capability hints in empty state
- Camera controls toolbar (reset, zoom to fit, fullscreen) on ModelViewer
- Mobile auto-switch to workbench on new model generation
- Chat-first navigation — no sidebar on chat routes, admin items in header dropdown
- Admin route guards with redirect for non-admin users
- Three-pane workspace layout (contexts, thread, 3D workbench)
- Multi-format export (STL, STEP, 3MF, Build123d source)
- In-browser 3D preview (Three.js with ThreeMFLoader)
- Multi-provider LLM support (OpenAI, Anthropic, xAI, Ollama)
- JWT auth, user management, admin panel
- Waitlist mode with email verification and invitation controls
- SSE real-time updates and notification center
- Design token system, dark mode, lucide-react icons
- Responsive layout with mobile pane switching
- Docker Compose deployment (PostgreSQL, Redis, Build123d, backend, frontend)
- Build123d LLM Workbench design complete — complexity curriculum (11 categories, 1,100 prompts), automated generation/evaluation pipeline, STL rendering service, and VLM scoring architecture specified ([design doc](build123d-llm-workbench.md))
- Backup management system — workbench exports tracked in DB as persistent backups, admin page for listing/downloading/deleting backups

### Design Upgrade Status (DQ1–DQ6)

| Phase | Description | Status |
|-------|-------------|--------|
| DQ1 | Design tokens, icons, animation primitives, skeleton/spinner/code-block components | **Complete** |
| DQ2 | Dialog/drawer/toast transitions, badge tokens, avatar, select, button upgrades | **Complete** |
| DQ3 | Chat page icons, rating icons, ModelViewer responsive + ResizeObserver, custom Select, ChatPage component extraction | **Complete** |
| DQ4 | Public pages icons, login/register branding, password toggle/strength, waitlist visual stepper | **Complete** |
| DQ5 | Admin KPI indicators, avatar in user list, AdminPanel component extraction | **Complete** |
| DQ6 | Dark mode, theme toggle | **Complete** |

### Resolved Design Debt (spec 001-design-debt-resolution)

All three open design debts have been resolved:

- [x] **ChatPage component extraction** — ChatPage.tsx decomposed into ContextSidebar, MessageBubble, PromptComposer, WorkbenchPane under `components/chat/`, with shared utilities in `chat/utils.ts`. ChatPage now composes these sub-components and is under 200 lines.
- [x] **AdminPanel component extraction** — AdminPanel.tsx decomposed into DashboardTab, UsersTab, WaitlistTab, SettingsTab under `components/admin/`, with shared utilities in `admin/utils.ts`. AdminPanel now composes these tab sub-components and is under 150 lines.
- [x] **Waitlist visual stepper** — WaitlistStepper component renders a three-step progress indicator (Join → Confirm Email → Approved) with status-driven step states, Design_Token colors, lucide-react icons, ARIA accessibility attributes, and responsive layout. Integrated into WaitlistPanel above the existing flow content.

---

## UX Gaps — Conversational Experience (spec 002) — ✅ Complete

All five UX gaps plus navigation cleanup have been resolved via spec 002-ux-gaps-conversational-experience. The app now feels like a polished conversational workspace. 29 property-based tests validate the implementation (20 backend, 34 frontend test files total).

### 1. The Conversation Feels Interactive — ✅ Complete

- [x] Stream assistant responses token-by-token via SSE (provider-native streaming, not Vercel AI SDK)
- [x] Typing indicator with query-state-aware labels ("Thinking...", "Generating code...", "Rendering model...")
- [x] Inline 3D preview with turntable animation in message thread (`InlineModelViewer`)
- [x] Progressive disclosure — code/file details collapsed by default (`CollapsibleSection`)
- [x] Compact inline download pills replacing the download bar (`DownloadPill`)
- [x] Clickable example prompts in empty chat state (`ExamplePrompts`)

### 2. The LLM Knows Build123d — ✅ Complete

- [x] Codegen system prompt enriched with Build123d API reference (classes, constructors, patterns)
- [x] Example code snippets for extrude, revolve, boolean, loft operations
- [x] Hot-reloadable API reference data file (`build123d-api-reference.ts`)

### 3. Iterative Refinement Works — ✅ Complete

- [x] Conversation history (last 5 exchange pairs) passed to LLM for context
- [x] Follow-up prompts modify existing models — "make the teeth wider" works naturally
- [x] Most recent code referenced as baseline for modification in codegen prompt
- [x] Model version history in WorkbenchPane with sequence numbers and prompt summaries
- [x] Immutable chat history — each response is a separate item, previous items never modified

### 4. Empty State Guides the User — ✅ Complete

- [x] Four clickable example prompts covering gears, enclosures, brackets, adapters
- [x] "What can I build?" capability hints popover accessible from prompt area
- [x] Brief capability description in empty chat state

### 5. 3D Preview Is Prominent — ✅ Complete

- [x] Camera controls toolbar (Reset View, Zoom to Fit, Fullscreen) overlaid on ModelViewer
- [x] Fullscreen toggle — expand to viewport overlay, exit via button or Escape
- [x] Mobile auto-switch to workbench pane when new model generates (below desktop breakpoint)

### 6. Error Recovery — ✅ Complete

- [x] Error recovery loop: rendering failures fed back to codegen LLM for one corrective retry
- [x] Conversational error display — errors shown as messages in the thread with plain-language explanation and follow-up suggestion

### 7. Navigation Cleanup — ✅ Complete

- [x] Chat routes render without AppShell sidebar — ChatPage occupies full viewport width
- [x] Admin-only items (Admin, Query Workbench) in header dropdown, visible only for admin users
- [x] Notification bell conditionally rendered for admin users only
- [x] Query Workbench and Notifications removed from sidebar for all users
- [x] `AdminRouteGuard` wraps `/query`, `/notifications`, `/admin` — non-admin users redirected to `/chat`

### 8. Component Architecture (Technical Debt) — ✅ Resolved

Resolved via spec 001-design-debt-resolution. ChatPage is now composed of ContextSidebar, MessageBubble, PromptComposer, WorkbenchPane. AdminPanel is composed of DashboardTab, UsersTab, WaitlistTab, SettingsTab. Each sub-component is independently testable with property-based tests.

---

## Roadmap

### Phase 1: Make the Conversation Feel Real — ✅ Complete
> Priority: **High** — this is the core product experience

- ~~Stream assistant responses (provider-native SSE streaming)~~ ✅
- ~~Inline 3D preview with turntable animation~~ ✅
- ~~Progressive disclosure for code/files (collapsed by default)~~ ✅
- ~~Compact inline download pills~~ ✅
- ~~Typing indicator during generation~~ ✅
- ~~Clickable example prompts in empty state~~ ✅

### Phase 2: Improve Model Generation Quality — ✅ Complete
> Priority: **High** — broken generations kill trust

- ~~Enrich codegen prompt with Build123d API reference~~ ✅
- ~~Add example code patterns to prompt~~ ✅
- ~~Error recovery loop (feed errors back to LLM)~~ ✅
- ~~Conversational error display~~ ✅

### Phase 3: Enable Iterative Refinement — ✅ Complete
> Priority: **High** — this is what makes it a conversation, not a form

- ~~Pass conversation history to LLM (including previous code and results)~~ ✅
- ~~Support follow-up modification prompts~~ ✅
- ~~Model version history in workbench~~ ✅

### Phase 4: Polish and Architecture — ✅ Complete
> Priority: **Medium** — improves maintainability and completeness

- ~~Extract ChatPage into sub-components~~ ✅
- ~~Extract AdminPanel into sub-components~~ ✅
- ~~Waitlist visual stepper~~ ✅
- ~~ModelViewer fullscreen toggle and camera controls~~ ✅
- ~~Mobile auto-switch to preview on generation~~ ✅
- ~~Capability hints and "What can I build?" help~~ ✅

### Navigation Cleanup — ✅ Complete
> Priority: **Medium** — streamlines the chat-first experience

- ~~Remove AppShell sidebar from chat routes~~ ✅
- ~~Consolidate navigation into header dropdown~~ ✅
- ~~Admin-only route guards~~ ✅
- ~~Notification bell restricted to admin users~~ ✅

### Phase 5: Build123d LLM Workbench — Design Complete, Implementation Pending
> Priority: **High** — directly improves core model generation quality

The chat experience is only as good as the LLM's ability to produce correct Build123d code. Today, no available LLM generates reliable Build123d code out of the box — models hallucinate class names, wrong argument order, and invalid geometry. The Build123d LLM Workbench is an admin-only sub-project to generate, validate, and curate a high-quality training dataset for fine-tuning an open-weight LLM specifically for Build123d code generation.

**Design document:** [`docs/build123d-llm-workbench.md`](build123d-llm-workbench.md)

**Key components:**

- **Complexity curriculum** — 11 categories (Primitives → PCB Cases), 100 natural-language prompts each (1,100 total). Prompt files live in `workbench/categories/`.
- **Automated pipeline** — Generate code → Render via Build123d → Screenshot via STL rendering service → VLM evaluate → auto-approve (score ≥ 7) or auto-fix with VLM feedback (up to 5 retries).
- **STL rendering service** — New Docker service (`services/stl-rendering-service/`) using Puppeteer + Three.js to render STL/3MF to PNG screenshots for VLM evaluation.
- **VLM evaluation** — Anthropic Claude or OpenAI GPT-4o scores rendered screenshots against the original prompt on shape accuracy, proportions, and feature completeness.
- **Training dataset export** — LLaMA-Factory JSONL format. Scale targets: v1 ~1,000 examples → Final ~10,000 via re-running prompts with varied temperature/seeds.

**Implementation phases:**

| Phase | Description | Status |
|-------|-------------|--------|
| WB-1 | Database schema, category/prompt CRUD, seeding from curriculum files | Planned |
| WB-2 | STL rendering service, screenshot pipeline | Planned |
| WB-3 | Code generation + VLM evaluation loop | Planned |
| WB-4 | Admin UI — browse categories, review examples, trigger generation | Planned |
| WB-5 | Dataset export, batch generation orchestration | Planned |

**Future extensions:** Parts knowledge library (hardware datasheets for accurate dimensions) and 3D-printing design guidelines (FDM constraints, wall thickness, overhang rules).

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
