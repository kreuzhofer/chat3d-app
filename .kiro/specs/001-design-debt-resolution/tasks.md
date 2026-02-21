# Implementation Plan: Design Debt Resolution

## Overview

Decompose ChatPage.tsx and AdminPanel.tsx into focused sub-components, and add a WaitlistStepper visual indicator. All changes are frontend-only TypeScript/React refactors. Tasks are ordered so each step builds on the previous, with property tests placed close to their implementation targets.

## Tasks

- [x] 1. ChatPage extraction — shared utilities and sub-components
  - [x] 1.1 Create `packages/frontend/src/components/chat/utils.ts` with shared utility functions
    - Extract `toErrorMessage`, `fileExtension`, `uniqueFilesByPath`, and `formatEstimatedCostUsd` from ChatPage.tsx
    - Export each as a named function with TypeScript types
    - _Requirements: 1.10_

  - [x] 1.2 Create `packages/frontend/src/components/chat/ContextSidebar.tsx`
    - Define `ContextSidebarProps` interface per design (groupedContexts, activeContextId, callbacks)
    - Extract the sidebar JSX block from ChatPage.tsx into this component
    - Named export, PascalCase filename
    - _Requirements: 1.1, 1.4, 1.8_

  - [x] 1.3 Create `packages/frontend/src/components/chat/MessageBubble.tsx`
    - Define `MessageBubbleProps` interface per design (item, isSelected, callbacks)
    - Extract the message rendering JSX from ChatPage.tsx including role avatar, markdown, attachments, code blocks, file downloads, rating, regenerate
    - Import shared utils from `chat/utils.ts`
    - Named export, PascalCase filename
    - _Requirements: 1.1, 1.5, 1.8, 1.10_

  - [x] 1.4 Write property test for MessageBubble — Property 1: renders role and text content
    - **Property 1: MessageBubble renders role and text content**
    - Create `packages/frontend/src/__tests__/chat/MessageBubble.test.tsx`
    - Use `fast-check` to generate random `ChatTimelineItem` objects with varying roles, segment counts (1–5), text strings, and segment kinds
    - Assert rendered output contains role indicator and all non-empty segment text
    - **Validates: Requirements 1.5**

  - [x] 1.5 Create `packages/frontend/src/components/chat/PromptComposer.tsx`
    - Define `PromptComposerProps` interface per design (prompt, onPromptChange, queuedAttachments, callbacks)
    - Extract the prompt input area JSX from ChatPage.tsx including textarea, attachment pills, send button
    - Named export, PascalCase filename
    - _Requirements: 1.1, 1.6, 1.8_

  - [x] 1.6 Write property test for PromptComposer — Property 2: disabled state consistency
    - **Property 2: PromptComposer disabled state consistency**
    - Create `packages/frontend/src/__tests__/chat/PromptComposer.test.tsx`
    - Use `fast-check` to generate random `busyAction` (null or string) and `prompt` (including whitespace-only)
    - Assert Send button is disabled iff `busyAction` is non-null OR trimmed prompt is empty
    - **Validates: Requirements 1.6**

  - [x] 1.7 Create `packages/frontend/src/components/chat/WorkbenchPane.tsx`
    - Define `WorkbenchPaneProps` interface per design (selectedAssistantItem, model params, callbacks)
    - Extract the right-side workbench JSX from ChatPage.tsx including tab bar, 3D viewer, parameter controls, file list, history
    - Import shared utils from `chat/utils.ts`
    - Named export, PascalCase filename
    - _Requirements: 1.1, 1.7, 1.8, 1.10_

  - [x] 1.8 Refactor `packages/frontend/src/components/ChatPage.tsx` to compose extracted sub-components
    - Replace inlined sidebar JSX with `<ContextSidebar>` import and composition
    - Replace inlined message JSX with `<MessageBubble>` mapped over `visibleTimelineItems`
    - Replace inlined prompt JSX with `<PromptComposer>`
    - Replace inlined workbench JSX with `<WorkbenchPane>`
    - Remove extracted utility functions (now in `chat/utils.ts`)
    - Retain all state hooks, async actions, and mobile pane tab bar in ChatPage
    - Resulting ChatPage.tsx must be under 200 lines (excluding imports and type definitions)
    - _Requirements: 1.2, 1.3, 1.9_

- [x] 2. Checkpoint — ChatPage extraction
  - Ensure existing test suite `packages/frontend/src/__tests__/chat.page.test.tsx` passes without modification to test assertions
  - Run `npm --workspace @chat3d/frontend run test` and `npm --workspace @chat3d/frontend run typecheck`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. AdminPanel extraction — shared utilities and tab sub-components
  - [x] 3.1 Create `packages/frontend/src/components/admin/utils.ts` with shared utility functions
    - Extract `toErrorMessage`, `sortUsersByCreatedDate`, `sortWaitlistByCreatedDate`, `toRoleTone`, `toStatusTone`, `toWaitlistTone`, `formatPct` from AdminPanel.tsx
    - Export the `ConfirmState` interface
    - _Requirements: 2.9_

  - [x] 3.2 Create `packages/frontend/src/components/admin/DashboardTab.tsx`
    - Define `DashboardKpis` and `DashboardTabProps` interfaces per design
    - Extract the dashboard metrics JSX from AdminPanel.tsx
    - Named export, PascalCase filename
    - _Requirements: 2.1, 2.4, 2.8_

  - [x] 3.3 Create `packages/frontend/src/components/admin/UsersTab.tsx`
    - Define `UsersTabProps` interface per design (users, search, statusFilter, callbacks)
    - Extract the user management JSX from AdminPanel.tsx
    - Named export, PascalCase filename
    - _Requirements: 2.1, 2.5, 2.8_

  - [x] 3.4 Write property test for UsersTab — Property 5: renders all user emails
    - **Property 5: UsersTab renders all user emails**
    - Create `packages/frontend/src/__tests__/admin/UsersTab.test.tsx`
    - Use `fast-check` to generate random lists of `AdminUser` objects with varying emails, roles, statuses
    - Assert rendered output contains every user's email when statusFilter is "all"
    - **Validates: Requirements 2.5**

  - [x] 3.5 Create `packages/frontend/src/components/admin/WaitlistTab.tsx`
    - Define `WaitlistTabProps` interface per design (waitlistEntries, pendingEntries, callbacks)
    - Extract the waitlist moderation JSX from AdminPanel.tsx
    - Named export, PascalCase filename
    - _Requirements: 2.1, 2.6, 2.8, 2.10_

  - [x] 3.6 Create `packages/frontend/src/components/admin/SettingsTab.tsx`
    - Define `SettingsDraft` and `SettingsTabProps` interfaces per design
    - Extract the settings JSX from AdminPanel.tsx
    - Named export, PascalCase filename
    - _Requirements: 2.1, 2.7, 2.8, 2.10_

  - [x] 3.7 Refactor `packages/frontend/src/components/AdminPanel.tsx` to compose extracted tab sub-components
    - Replace inlined tab JSX with `<DashboardTab>`, `<UsersTab>`, `<WaitlistTab>`, `<SettingsTab>` imports and composition
    - Remove extracted utility functions (now in `admin/utils.ts`)
    - Retain all state hooks, async actions, tab switching, and confirmation dialog in AdminPanel
    - Resulting AdminPanel.tsx must be under 150 lines (excluding imports and type definitions)
    - _Requirements: 2.2, 2.3_

- [x] 4. Checkpoint — AdminPanel extraction
  - Run `npm --workspace @chat3d/frontend run test` and `npm --workspace @chat3d/frontend run typecheck`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. WaitlistStepper implementation
  - [x] 5.1 Create `packages/frontend/src/components/WaitlistStepper.tsx`
    - Define `WaitlistStepperStatus` type and `WaitlistStepperProps` interface per design
    - Implement pure step-state mapping function: status → [step1State, step2State, step3State]
    - Render three labeled steps ("Join", "Confirm Email", "Approved") with lucide-react icons
    - Apply Design_Token colors: completed (success), active (primary), upcoming (muted), rejected (destructive)
    - Add ARIA attributes: container `role="group"` + `aria-label="Waitlist progress"`, active step `aria-current="step"`, each step `aria-label` with name and state
    - Use responsive layout (legible on desktop and mobile)
    - Named export, PascalCase filename
    - _Requirements: 3.1, 3.2, 3.3, 3.10, 3.11, 3.12_

  - [x] 5.2 Write property test for WaitlistStepper — Property 3: step state mapping
    - **Property 3: WaitlistStepper step state mapping**
    - Create `packages/frontend/src/__tests__/WaitlistStepper.test.tsx`
    - Use `fast-check` with `fc.constantFrom("not_joined", "pending_confirmation", "pending_approval", "approved", "rejected")`
    - Assert step states match the expected mapping table from the design for each status
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8**

  - [x] 5.3 Write property test for WaitlistStepper — Property 4: structure and accessibility
    - **Property 4: WaitlistStepper structure and accessibility**
    - Add to `packages/frontend/src/__tests__/WaitlistStepper.test.tsx`
    - Use same `fc.constantFrom(...)` generator as Property 3
    - Assert exactly three steps labeled "Join", "Confirm Email", "Approved"
    - Assert container has `role="group"` and `aria-label="Waitlist progress"`
    - Assert active step has `aria-current="step"`
    - **Validates: Requirements 3.1, 3.11**

  - [x] 5.4 Integrate WaitlistStepper into `packages/frontend/src/components/WaitlistPanel.tsx`
    - Map `WaitlistStatusResponse["status"]` to `WaitlistStepperStatus` per design mapping table
    - Render `<WaitlistStepper>` above the existing flow content, replacing the static 3-card grid
    - Handle "no status loaded" → `"not_joined"`, `"pending_email_confirmation"` → `"pending_confirmation"`, `"pending_admin_approval"` → `"pending_approval"`
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 6. Final checkpoint — full validation
  - Run `npm --workspace @chat3d/frontend run test` and `npm --workspace @chat3d/frontend run typecheck`
  - Run `npm run m1:typecheck:workspaces`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` and validate universal correctness properties from the design document
- Checkpoints ensure incremental validation after each major extraction
- All changes are frontend-only — no backend modifications required
