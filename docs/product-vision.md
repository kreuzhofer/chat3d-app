# Chat3D — Product Vision & Roadmap

> **Status:** Living document. Replaces `design_upgrade_plan.md`.

---

## Product Vision

Chat3D is a **prompt-to-CAD workspace**: users describe 3D parts in natural language and receive production-ready geometry (STL, STEP, 3MF) through an interactive conversation. The app should feel like talking to a CAD engineer — you describe what you need, see the result immediately, give feedback, and iterate until the part is right.

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

The app is functionally complete through milestones M1–M15 and design upgrades DQ1–DQ6:

- Full chat-to-model pipeline (two-stage LLM: conversation + codegen)
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

### Design Upgrade Status (DQ1–DQ6)

| Phase | Description | Status |
|-------|-------------|--------|
| DQ1 | Design tokens, icons, animation primitives, skeleton/spinner/code-block components | **Complete** |
| DQ2 | Dialog/drawer/toast transitions, badge tokens, avatar, select, button upgrades | **Complete** |
| DQ3 | Chat page icons, rating icons, ModelViewer responsive + ResizeObserver, custom Select | **Partially complete** — icons and viewer done; component extraction not done |
| DQ4 | Public pages icons, login/register branding, password toggle/strength | **Mostly complete** — waitlist stepper not done |
| DQ5 | Admin KPI indicators, avatar in user list | **Partially complete** — indicators done; component extraction not done |
| DQ6 | Dark mode, theme toggle | **Complete** |

### Open Design Debt

These items were planned in DQ3–DQ5 but not yet implemented:

- [ ] **ChatPage component extraction** — ChatPage.tsx is 1,374 lines. Extract ContextSidebar, MessageBubble, PromptComposer, WorkbenchPane into separate files.
- [ ] **AdminPanel component extraction** — AdminPanel.tsx is ~1,000 lines. Extract DashboardTab, UsersTab, WaitlistTab, SettingsTab.
- [ ] **Waitlist visual stepper** — The public waitlist page has no step visualization.

---

## UX Gaps — What's Missing for a Real Product

The app works end-to-end, but the UX doesn't yet feel like a polished conversational tool. The following sections describe what needs to change, roughly in priority order.

### 1. The Conversation Doesn't Feel Interactive

**Problem:** After submitting a prompt, the user sees a raw dump of information: assistant text, generated code, file lists, download buttons, all crammed into one message. There's no sense of a back-and-forth conversation. It feels like filling out a form and getting a report back.

**What good looks like:**
- Messages appear with streaming text (token by token), not as a complete wall of text
- The assistant reply is conversational — a brief explanation followed by the model
- The 3D preview appears inline in the conversation thread (or auto-opens in the workbench) rather than requiring the user to click "Load 3D Preview"
- Download buttons are compact and contextual, not a separate "download bar"
- The overall rhythm should feel like chatting, not like submitting jobs

**Concrete improvements:**
- [ ] Stream assistant responses token-by-token using Vercel AI SDK streaming
- [ ] Auto-load the 3D preview when a model is generated (remove the manual "Load 3D Preview" gate)
- [ ] Collapse code/file details behind an expandable section (progressive disclosure)
- [ ] Make download buttons compact inline pills rather than a separate bar
- [ ] Add typing indicators while the assistant is generating

### 2. The LLM Doesn't Know Build123d

**Problem:** The codegen system prompt is minimal ("Generate valid Python build123d code"). The LLM frequently hallucinates classes that don't exist in Build123d (e.g., `SpurGear`), causing render failures. Users see an error with no easy recovery path.

**What good looks like:**
- The codegen prompt includes a Build123d API reference (available classes, common patterns)
- When code fails to render, the error is shown conversationally and the LLM can self-correct
- The user can say "that didn't work, try a different approach" and the conversation continues

**Concrete improvements:**
- [ ] Enrich the codegen system prompt with Build123d API reference (available classes, functions, patterns)
- [ ] Add example code snippets to the prompt for common operations (extrude, revolve, boolean, loft)
- [ ] Implement error recovery: when Build123d returns an error, feed it back to the LLM for a corrective attempt
- [ ] Show render errors conversationally in the thread (not just as a red box)

### 3. No Iteration Within a Thread

**Problem:** The current "Regenerate" button re-runs the same prompt. There's no way to say "make it taller" or "add a fillet to the edges" and have the LLM modify the existing model. Each generation is independent — the LLM has no memory of what it just produced.

**What good looks like:**
- Sending a follow-up message continues the conversation and refines the model
- The LLM sees previous code and results, so "make the teeth wider" works naturally
- The conversation history (including generated code) is passed to the LLM for context

**Concrete improvements:**
- [ ] Include previous assistant messages and generated code in the LLM conversation context
- [ ] Support follow-up prompts that modify existing models (iterative refinement)
- [ ] Show model version history in the workbench (compare v1 vs v2 side by side)

### 4. Empty State Doesn't Guide the User

**Problem:** When a user first opens the app, they see "New conversation" with "Start modeling — Write your first prompt." The empty prompt textarea says "Describe the part, dimensions, and constraints..." — but there are no examples, no templates, no guidance for what kinds of things work.

**What good looks like:**
- The empty state shows 3-4 clickable example prompts ("Design a spur gear with 20 teeth", "Create a simple enclosure for a Raspberry Pi", etc.)
- Clicking an example fills the prompt and submits it
- A brief "What can Chat3D do?" section explains capabilities and limitations

**Concrete improvements:**
- [ ] Add clickable example prompts to the empty chat state
- [ ] Show capability hints ("I can create gears, brackets, enclosures, adapters...")
- [ ] Add a "What can I build?" help section accessible from the prompt area

### 5. 3D Preview Should Be More Prominent

**Problem:** The 3D workbench is the right-most pane and starts with "Awaiting Output" / "No preview file yet". Even after generation, users must click "Load 3D Preview". The preview is the most compelling part of the app but it's treated as secondary.

**What good looks like:**
- The 3D preview loads automatically when a model is generated
- On larger screens, the preview is always visible alongside the conversation
- The preview has basic controls visible (rotate hint, zoom, reset view)
- On mobile, generating a model auto-switches to the preview pane

**Concrete improvements:**
- [ ] Auto-load 3D preview when model files become available
- [ ] Add visible camera controls (reset view, zoom to fit)
- [ ] On mobile, auto-switch to preview pane when a new model is generated
- [ ] Add a fullscreen toggle for the 3D preview

### 6. Component Architecture (Technical Debt)

**Problem:** ChatPage.tsx (1,374 lines) and AdminPanel.tsx (~1,000 lines) are monolithic single-file components. This makes them hard to maintain, test, and extend.

**What good looks like:**
- ChatPage composed of ContextSidebar, ThreadPane, PromptComposer, WorkbenchPane
- AdminPanel composed of DashboardTab, UsersTab, WaitlistTab, SettingsTab
- Each sub-component is independently testable

**Concrete improvements:**
- [ ] Extract ChatPage into sub-components (ContextSidebar, MessageBubble, PromptComposer, WorkbenchPane)
- [ ] Extract AdminPanel into sub-components (DashboardTab, UsersTab, WaitlistTab, SettingsTab)

---

## Roadmap

### Phase 1: Make the Conversation Feel Real
> Priority: **High** — this is the core product experience

- Stream assistant responses (Vercel AI SDK streaming support)
- Auto-load 3D preview on generation
- Progressive disclosure for code/files (collapsed by default)
- Compact inline download pills
- Typing indicator during generation
- Clickable example prompts in empty state

### Phase 2: Improve Model Generation Quality
> Priority: **High** — broken generations kill trust

- Enrich codegen prompt with Build123d API reference
- Add example code patterns to prompt
- Error recovery loop (feed errors back to LLM)
- Conversational error display

### Phase 3: Enable Iterative Refinement
> Priority: **High** — this is what makes it a conversation, not a form

- Pass conversation history to LLM (including previous code and results)
- Support follow-up modification prompts
- Model version history in workbench

### Phase 4: Polish and Architecture
> Priority: **Medium** — improves maintainability and completeness

- Extract ChatPage into sub-components
- Extract AdminPanel into sub-components
- Waitlist visual stepper
- ModelViewer fullscreen toggle and camera controls
- Mobile auto-switch to preview on generation

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
