# Implementation Plan: UX Gaps — Conversational Experience

## Overview

Transform Chat3D from a functional prompt-to-CAD pipeline into a polished conversational workspace. Implementation follows the four-phase roadmap plus navigation cleanup and inline preview/history formalization. All code is TypeScript. Backend changes target `packages/backend/src/services/`, frontend changes target `packages/frontend/src/components/chat/` and related files. Property-based tests use `fast-check` (already installed).

## Tasks

- [x] 1. Phase 1 — Streaming and typing indicator (backend)
  - [x] 1.1 Add streaming token delivery to SseService and QueryService
    - Add `publishStreamToken(userId, payload: StreamTokenEvent)` method to `packages/backend/src/services/sse.service.ts`
    - Add `stream-token` and `query-state` event types per design interfaces
    - Modify `QueryService.submitQuery` in `packages/backend/src/services/query.service.ts` to call `LlmService` streaming variant for conversation stage
    - Publish `query-state` transitions: `queued` → `conversation` → `codegen` → `rendering` → `completed`/`failed`
    - _Requirements: 1.1, 1.2, 2.1, 2.2_

  - [x] 1.2 Add streaming conversation generation to LlmService
    - Add `generateConversationTextStream(params, onToken: (token: string) => void)` method to `packages/backend/src/services/llm.service.ts`
    - Implement provider-specific streaming: OpenAI `stream: true`, Anthropic streaming messages, Ollama streaming
    - Each token chunk published via `SseService.publishStreamToken`
    - _Requirements: 1.1_

  - [x] 1.3 Write property test for streaming token concatenation
    - **Property 1: Streaming token concatenation equals complete response**
    - Create `packages/backend/src/__tests__/streaming.property.test.ts`
    - Use `fast-check` to generate random strings, split into random token chunks, verify concatenation equals original
    - **Validates: Requirements 1.1, 1.3**

- [x] 2. Phase 1 — Streaming and typing indicator (frontend)
  - [x] 2.1 Create `useStreamingQuery` hook
    - Create `packages/frontend/src/hooks/useStreamingQuery.ts`
    - Listen to SSE `stream-token` and `query-state` events filtered by `assistantItemId`
    - Manage streaming text accumulation, connection interruption with partial response display
    - Expose `streamingText`, `queryState`, `isStreaming`, `error` state
    - _Requirements: 1.2, 1.4, 1.5_

  - [x] 2.2 Create `TypingIndicator` component
    - Create `packages/frontend/src/components/chat/TypingIndicator.tsx`
    - Animated dots with query-state-aware label ("Thinking...", "Generating code...", "Rendering model...")
    - Visible during `conversation`, `codegen`, `rendering`, `retrying` states
    - Replaced by streaming content when tokens begin arriving
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.3 Integrate streaming into ChatPage and MessageBubble
    - Modify `packages/frontend/src/components/ChatPage.tsx` to use `useStreamingQuery` hook
    - Modify `packages/frontend/src/components/chat/MessageBubble.tsx` to render streaming text with incremental append
    - Display complete response with full markdown rendering when stream finishes
    - Show partial response + inline error on stream interruption
    - Disable PromptComposer send button while streaming is active
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.3_

  - [x] 2.4 Write property test for send button disabled during streaming
    - **Property 2: Send button disabled during streaming**
    - Create `packages/frontend/src/__tests__/chat/streaming-ui.property.test.ts`
    - Use `fast-check` to generate random streaming states, verify send button disabled iff streaming active
    - **Validates: Requirements 1.5**

  - [x] 2.5 Write property test for typing indicator visibility
    - **Property 3: Typing indicator visible during processing states**
    - Create `packages/frontend/src/__tests__/chat/typing-indicator.property.test.ts`
    - Use `fast-check` with `fc.constantFrom("conversation", "codegen", "rendering", "retrying", "completed", "failed", "queued")`
    - Assert indicator visible iff state in {conversation, codegen, rendering, retrying}
    - **Validates: Requirements 2.2**

- [x] 3. Checkpoint — Streaming and typing indicator
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm --workspace @chat3d/backend run test && npm --workspace @chat3d/frontend run test && npm --workspace @chat3d/frontend run typecheck`

- [x] 4. Phase 1 — Inline 3D preview with turntable animation
  - [x] 4.1 Create `InlineModelViewer` component with turntable animation
    - Create `packages/frontend/src/components/chat/InlineModelViewer.tsx`
    - Lightweight Three.js viewer for in-message 3D preview (distinct from full `ModelViewer`)
    - Default turntable animation: slow Z-axis rotation (~10–15s per revolution) using `requestAnimationFrame`
    - Pause animation on mousedown/touchstart, resume after 2s delay on mouseup/touchend
    - Orbit, zoom, pan controls when user interacts
    - Skeleton loading state while model loads; error state with retry button on failure
    - Sized prominently within message layout, not full Chat_Thread width
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 22.1, 22.2, 22.3, 22.4, 22.5_

  - [x] 4.2 Write property test for turntable rotation speed
    - **Property 6: Turntable rotation speed within specified range**
    - Create `packages/frontend/src/__tests__/chat/turntable.property.test.ts`
    - Use `fast-check` to generate random frame deltas, verify angular velocity between 2π/15 and 2π/10 rad/s
    - **Validates: Requirements 22.1**

  - [x] 4.3 Write property test for interaction pauses turntable
    - **Property 5: User interaction pauses turntable animation**
    - Add to `packages/frontend/src/__tests__/chat/turntable.property.test.ts`
    - Use `fast-check` to generate random interaction event types, verify rotation delta becomes zero on interaction
    - **Validates: Requirements 3.3, 22.3**

  - [x] 4.4 Integrate `InlineModelViewer` into `MessageBubble`
    - Modify `packages/frontend/src/components/chat/MessageBubble.tsx` to render `InlineModelViewer` when assistant response includes STL/3MF artifacts
    - WorkbenchPane continues to function independently
    - _Requirements: 3.1, 3.8, 23.2_

  - [x] 4.5 Write property test for inline preview rendered when artifacts present
    - **Property 4: Inline 3D preview rendered when preview-ready artifacts present**
    - Create `packages/frontend/src/__tests__/chat/inline-preview.property.test.ts`
    - Use `fast-check` to generate random assistant responses with/without STL/3MF files
    - Assert InlineModelViewer rendered iff preview-ready artifacts present
    - **Validates: Requirements 3.1**

- [x] 5. Phase 1 — Progressive disclosure, download pills, example prompts
  - [x] 5.1 Create `CollapsibleSection` component
    - Create `packages/frontend/src/components/chat/CollapsibleSection.tsx`
    - Expand/collapse wrapper for code and file details
    - Collapsed by default; accessible labels; keyboard activation (Enter, Space)
    - `aria-expanded` attribute on toggle control
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.2 Write property tests for progressive disclosure
    - **Property 7: Code and file sections collapsed by default**
    - **Property 8: Expand/collapse round-trip restores original state**
    - **Property 9: Collapsible controls have accessible labels and keyboard support**
    - Create `packages/frontend/src/__tests__/chat/progressive-disclosure.property.test.ts`
    - Use `fast-check` to generate random assistant responses, verify collapsed default, round-trip, and accessibility
    - **Validates: Requirements 4.1, 4.4, 4.5, 23.4**

  - [x] 5.3 Create `DownloadPill` component
    - Create `packages/frontend/src/components/chat/DownloadPill.tsx`
    - Compact inline pill button with file format label (STL, STEP, 3MF, B123D) and download icon
    - Loading state during download; initiates browser download on click
    - Omit section entirely when no downloadable files available
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.4 Write property test for download pills
    - **Property 10: Download pills rendered for all file types in assistant responses**
    - Create `packages/frontend/src/__tests__/chat/download-pills.property.test.ts`
    - Use `fast-check` to generate random file lists with various extensions
    - Assert each file rendered as DownloadPill with correct format label
    - **Validates: Requirements 5.1, 5.3, 23.5**

  - [x] 5.5 Create `ExamplePrompts` component
    - Create `packages/frontend/src/components/chat/ExamplePrompts.tsx`
    - At least four clickable example prompts covering diverse CAD use cases (gears, enclosures, brackets, adapters)
    - Brief capability description explaining what Chat3D can generate
    - Clicking populates PromptComposer with example text
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 5.6 Write property test for example prompts
    - **Property 11: Clicking example prompt populates composer**
    - Create `packages/frontend/src/__tests__/chat/example-prompts.property.test.ts`
    - Use `fast-check` to generate random example prompt selections, verify composer populated with exact text
    - **Validates: Requirements 6.2**

  - [x] 5.7 Integrate progressive disclosure, download pills, and example prompts into MessageBubble and ChatPage
    - Modify `MessageBubble` to use `CollapsibleSection` for code/file details (collapsed by default) and `DownloadPill` for downloads (replacing current download bar)
    - Modify `ChatPage` to render `ExamplePrompts` in empty chat state (no messages, no active context)
    - Each assistant item renders its own code section and download pills per-message (immutable history)
    - _Requirements: 4.1, 5.1, 6.1, 23.2, 23.4, 23.5_

- [x] 6. Checkpoint — Phase 1 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm --workspace @chat3d/backend run test && npm --workspace @chat3d/frontend run test && npm --workspace @chat3d/frontend run typecheck`
  - Run `npm run m1:typecheck:workspaces`

- [x] 7. Phase 2 — Build123d API reference enrichment
  - [x] 7.1 Create Build123d API reference data file
    - Create `packages/backend/src/data/build123d-api-reference.ts`
    - Define `Build123dApiEntry[]` and `Build123dExampleSnippet[]` arrays per design interfaces
    - List available classes (Box, Cylinder, Sphere, Cone, Torus, Extrude, Revolve, Loft, Sweep, Fillet, Chamfer, Boolean operations) with constructor signatures
    - Include at least four example code snippets: extrude, revolve, boolean union/difference, loft
    - Export a `getBuild123dReference()` function that reads from file (hot-reloadable)
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 7.2 Enrich codegen system prompt in LlmService
    - Modify `packages/backend/src/services/llm.service.ts` `generateBuild123dCode` method
    - Include Build123d API reference and example snippets in the codegen system prompt
    - Add instruction to use only documented classes and avoid inventing non-existent classes
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 7.3 Write property test for API reference in codegen prompt
    - **Property 12: Build123d API reference included in codegen prompt**
    - Create `packages/backend/src/__tests__/query-codegen.property.test.ts`
    - Use `fast-check` to generate random prompts, verify system prompt contains API reference text
    - **Validates: Requirements 7.1**

  - [x] 7.4 Write property test for hot-reload of API reference
    - **Property 13: Hot-reload of Build123d API reference**
    - Add to `packages/backend/src/__tests__/query-codegen.property.test.ts`
    - Use `fast-check` to generate random API reference content, verify next codegen request uses updated content
    - **Validates: Requirements 7.4**

- [x] 8. Phase 2 — Error recovery loop and conversational errors
  - [x] 8.1 Implement error recovery loop in QueryService
    - Modify `packages/backend/src/services/query.service.ts` `submitQuery` method
    - When rendering fails, feed error message + failing code back to codegen LLM for one corrective retry
    - Publish `query-state: "retrying"` during corrective attempt
    - If retry succeeds, proceed normally with corrected artifacts
    - If retry also fails, return final error as conversational message
    - At most one retry per query
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [x] 8.2 Implement conversational error display in MessageBubble
    - Modify `packages/frontend/src/components/chat/MessageBubble.tsx`
    - Display rendering/codegen errors as conversational messages within the Chat_Thread
    - Include plain-language explanation, specific error detail, and follow-up action suggestion
    - Visually distinct from successful responses (warning/error tone) while remaining in message flow
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 8.3 Write property test for error recovery
    - **Property 14: Error recovery feeds error context to LLM with at most one retry**
    - Create `packages/backend/src/__tests__/error-recovery.property.test.ts`
    - Use `fast-check` to generate random error messages and code strings
    - Verify exactly one retry with error context, no further retries on second failure
    - **Validates: Requirements 8.1, 8.2, 8.5**

  - [x] 8.4 Write property test for conversational error messages
    - **Property 15: Conversational error messages contain error detail and follow-up suggestion**
    - Create `packages/backend/src/__tests__/error-messages.property.test.ts`
    - Use `fast-check` to generate random error details
    - Verify response contains error detail and follow-up action suggestion
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 9. Checkpoint — Phase 2 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm --workspace @chat3d/backend run test && npm --workspace @chat3d/frontend run test && npm --workspace @chat3d/frontend run typecheck`

- [x] 10. Phase 3 — Conversation history and iterative refinement
  - [x] 10.1 Build conversation context from chat history in QueryService
    - Modify `packages/backend/src/services/query.service.ts`
    - Before calling LLM, fetch last 5 exchange pairs (user prompt + assistant response) from `chat_items` for the context
    - Build `ConversationHistoryEntry[]` array with role, text, code, and sequence position labels
    - Pass to both conversation and codegen LLM calls
    - Reference most recent code as baseline for modification in codegen prompt
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.1_

  - [x] 10.2 Write property test for conversation context construction
    - **Property 16: Conversation context correctly constructed from chat history**
    - Create `packages/backend/src/__tests__/conversation-context.property.test.ts`
    - Use `fast-check` to generate random chat item sequences with varying roles and code
    - Verify entries labeled with role and sequence position, most recent code referenced as baseline
    - **Validates: Requirements 10.1, 10.3, 10.4, 11.1**

  - [x] 10.3 Write property test for conversation context cap
    - **Property 17: Conversation context capped at five exchange pairs**
    - Add to `packages/backend/src/__tests__/conversation-context.property.test.ts`
    - Use `fast-check` to generate random chat histories with 1–20 items
    - Verify context contains at most 5 exchange pairs
    - **Validates: Requirements 10.2**

  - [x] 10.4 Ensure immutable chat history on follow-up prompts
    - Verify `QueryService.submitQuery` creates a new `chat_items` row for each assistant response without modifying previous items
    - Modify frontend `ChatPage` to display all assistant responses in chronological order, each with its own InlineModelViewer, CollapsibleSection, and DownloadPills
    - _Requirements: 11.2, 23.1, 23.2, 23.3, 23.6_

  - [x] 10.5 Write property test for immutable chat history
    - **Property 18: Immutable chat history — new generations preserve previous items**
    - Create `packages/backend/src/__tests__/chat-history.property.test.ts`
    - Use `fast-check` to generate random chat contexts with multiple items
    - Verify new generation creates exactly one new item, all previous items unchanged
    - **Validates: Requirements 11.2, 23.1, 23.6**

  - [x] 10.6 Write property test for chronological order
    - **Property 20: Assistant responses displayed in chronological order**
    - Create `packages/frontend/src/__tests__/chat/chat-thread.property.test.ts`
    - Use `fast-check` to generate random timestamp sequences
    - Verify Chat_Thread renders items in ascending chronological order
    - **Validates: Requirements 23.2**

- [x] 11. Phase 3 — Model version history in WorkbenchPane
  - [x] 11.1 Implement model version history list in WorkbenchPane
    - Modify `packages/frontend/src/components/chat/WorkbenchPane.tsx`
    - In the history tab, list each `ModelVersionEntry` with sequence number, timestamp, and truncated prompt summary
    - Selecting a version loads that version's 3D preview and file list
    - Currently displayed version visually highlighted
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 11.2 Write property test for model version history
    - **Property 19: Model version history lists all artifact-bearing assistant items**
    - Create `packages/frontend/src/__tests__/chat/version-history.property.test.ts`
    - Use `fast-check` to generate random assistant item lists with/without 3D artifacts
    - Verify history lists only artifact-bearing items in chronological order with correct metadata
    - **Validates: Requirements 12.1**

- [x] 12. Checkpoint — Phase 3 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm --workspace @chat3d/backend run test && npm --workspace @chat3d/frontend run test && npm --workspace @chat3d/frontend run typecheck`
  - Run `npm run m1:typecheck:workspaces`

- [x] 13. Phase 4 — Capability hints and help section
  - [x] 13.1 Create `CapabilityHints` component
    - Create `packages/frontend/src/components/chat/CapabilityHints.tsx`
    - "What can I build?" help trigger as popover/panel listing supported part types, example dimensions, known limitations
    - Dismissible, does not interfere with prompt input flow
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 13.2 Integrate capability hints into PromptComposer and empty state
    - Add "What can I build?" trigger to `PromptComposer`
    - Include capability description in empty chat state alongside `ExamplePrompts`
    - _Requirements: 6.4, 13.1, 13.2_

- [x] 14. Phase 4 — Camera controls, fullscreen, mobile auto-switch
  - [x] 14.1 Create `CameraControlsToolbar` component
    - Create `packages/frontend/src/components/chat/CameraControlsToolbar.tsx`
    - Overlay buttons: Reset View, Zoom to Fit, Fullscreen toggle
    - Accessible labels (`aria-label`), keyboard activation (Enter, Space)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 15.1_

  - [x] 14.2 Integrate camera controls and fullscreen into ModelViewer
    - Modify `packages/frontend/src/components/ModelViewer.tsx`
    - Render `CameraControlsToolbar` overlaid on preview when model is loaded
    - Implement fullscreen toggle: expand to viewport overlay, exit via button or Escape key
    - Camera controls toolbar remains visible and functional in fullscreen mode
    - _Requirements: 14.1, 15.2, 15.3, 15.4_

  - [x] 14.3 Write property tests for camera controls
    - **Property 21: Camera controls toolbar visible when model is loaded**
    - **Property 22: Camera controls have accessible labels and keyboard support**
    - Create `packages/frontend/src/__tests__/chat/camera-controls.property.test.ts`
    - Use `fast-check` to generate random viewer states and button sets
    - **Validates: Requirements 14.1, 14.4**

  - [x] 14.4 Write property test for fullscreen round-trip
    - **Property 23: Fullscreen toggle round-trip restores original size**
    - Create `packages/frontend/src/__tests__/chat/fullscreen.property.test.ts`
    - Use `fast-check` to generate random initial dimensions
    - Verify enter + exit fullscreen restores original dimensions
    - **Validates: Requirements 15.3**

  - [x] 14.5 Implement mobile auto-switch to preview on generation
    - Modify `packages/frontend/src/components/ChatPage.tsx`
    - When new preview-ready artifact generated and viewport below desktop breakpoint (xl), auto-switch to "workbench" mobile pane
    - Only on new generation completion, not when browsing existing history
    - User can manually switch back to "thread" pane
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 14.6 Write property test for mobile auto-switch
    - **Property 24: Mobile auto-switch to workbench on new generation only**
    - Create `packages/frontend/src/__tests__/chat/mobile-auto-switch.property.test.ts`
    - Use `fast-check` to generate random viewport widths and generation events
    - Verify auto-switch iff viewport below breakpoint AND new generation completes
    - **Validates: Requirements 16.1, 16.2**

- [x] 15. Checkpoint — Phase 4 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm --workspace @chat3d/backend run test && npm --workspace @chat3d/frontend run test && npm --workspace @chat3d/frontend run typecheck`

- [x] 16. Navigation cleanup — Remove sidebar, header dropdown, admin route guards
  - [x] 16.1 Remove Application Shell Sidebar from chat routes
    - Modify `packages/frontend/src/components/ChatPage.tsx` (or App/routing layer) so chat routes (`/chat`, `/chat/new`, `/chat/:contextId`) render without the AppShell sidebar
    - ChatPage occupies full viewport width: ContextSidebar | Chat_Thread | WorkbenchPane
    - Mobile navigation drawer remains accessible via menu trigger in header
    - Non-chat pages (Profile, Admin) may retain standard layout
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [x] 16.2 Add admin-only items to Header Dropdown
    - Modify the header dropdown component (in layout components)
    - Add "Open Profile" menu item navigating to `/profile` (all users)
    - Add "Admin" menu item navigating to `/admin` (admin users only)
    - Add "Query Workbench" menu item navigating to `/query` (admin users only)
    - Position Profile/Admin/Query items above session-action items (Refresh Event Replay, Mark All Read, Logout)
    - Remove Query Workbench and Notifications from Application_Shell_Sidebar for all users
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 19.1, 19.2, 19.3, 20.1_

  - [x] 16.3 Conditionally render notification bell for admin users only
    - Modify header top bar to render notification bell icon + unread count badge only when user role is `"admin"`
    - _Requirements: 20.2, 20.3_

  - [x] 16.4 Create `AdminRouteGuard` and wrap admin-only routes
    - Create `packages/frontend/src/components/AdminRouteGuard.tsx` using existing `RequireRole` component
    - Wrap `/query`, `/notifications`, `/admin` routes with `AdminRouteGuard`
    - Redirect non-admin users to `/chat` using replace navigation (no browser history entry)
    - Admin users access pages normally
    - _Requirements: 19.4, 20.4, 21.1, 21.2, 21.3, 21.4, 21.5_

  - [x] 16.5 Write property tests for navigation
    - **Property 25: No application shell sidebar on chat routes**
    - **Property 26: Admin-only header dropdown items visible iff user is admin**
    - **Property 27: Notification bell visible iff user is admin**
    - **Property 28: Sidebar excludes Query and Notifications for all users**
    - Create `packages/frontend/src/__tests__/chat/navigation.property.test.ts`
    - Use `fast-check` to generate random chat route paths and user roles
    - **Validates: Requirements 17.1, 18.2, 18.3, 19.1, 19.2, 19.3, 20.1, 20.2, 20.3**

  - [x] 16.6 Write property test for admin route guard
    - **Property 29: Admin route guard redirects non-admin users**
    - Create `packages/frontend/src/__tests__/chat/route-guard.property.test.ts`
    - Use `fast-check` to generate random user roles × admin routes
    - Verify redirect to `/chat` with replace navigation for non-admin, normal render for admin
    - **Validates: Requirements 19.4, 20.4, 21.1, 21.2, 21.3, 21.4, 21.5**

- [-] 17. Final checkpoint — Full validation
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm --workspace @chat3d/backend run test && npm --workspace @chat3d/backend run build`
  - Run `npm --workspace @chat3d/frontend run test && npm --workspace @chat3d/frontend run typecheck`
  - Run `npm run m1:typecheck:workspaces`

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` (100 iterations minimum) and validate correctness properties from the design document
- Checkpoints ensure incremental validation after each major phase
- The existing `chat_items` data model already supports immutable history (Req 23) — no schema changes needed
- Streaming uses SSE (existing `SseService` pattern), not WebSocket
- Error recovery loop is backend-only; frontend sees transparent state transitions
