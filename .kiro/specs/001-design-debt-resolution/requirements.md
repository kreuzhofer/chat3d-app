# Requirements Document

## Introduction

This spec addresses three open design debts from the Chat3D product vision (Phase 4: Polish and Architecture). ChatPage.tsx (1,374 lines) and AdminPanel.tsx (~1,000 lines) are monolithic single-file components that are difficult to maintain, test, and extend. The public waitlist page lacks a visual stepper to guide users through the join → confirm → approved flow. Resolving these debts improves code maintainability, testability, and user experience.

## Glossary

- **ChatPage**: The main chat workspace component (`packages/frontend/src/components/ChatPage.tsx`) containing the conversation thread, context sidebar, prompt input, and 3D workbench pane.
- **AdminPanel**: The admin dashboard component (`packages/frontend/src/components/AdminPanel.tsx`) containing dashboard metrics, user management, waitlist management, and settings tabs.
- **ContextSidebar**: A sub-component of ChatPage responsible for displaying and managing chat contexts (conversation list, grouping by recency, create/delete actions).
- **MessageBubble**: A sub-component of ChatPage responsible for rendering a single chat message (user or assistant), including text content, attachments, code blocks, file downloads, and model previews.
- **PromptComposer**: A sub-component of ChatPage responsible for the message input area, including the textarea, file attachment controls, and send button.
- **WorkbenchPane**: A sub-component of ChatPage responsible for the 3D model preview area, including the Three.js viewer, file list, and download controls.
- **DashboardTab**: A sub-component of AdminPanel responsible for displaying KPI metrics and system overview.
- **UsersTab**: A sub-component of AdminPanel responsible for user listing, role management, and user status controls.
- **WaitlistTab**: A sub-component of AdminPanel responsible for waitlist entry listing, approval, and rejection controls.
- **SettingsTab**: A sub-component of AdminPanel responsible for system configuration (LLM provider, waitlist toggle, etc.).
- **WaitlistStepper**: A visual step indicator component showing the user's progress through the waitlist flow (Join → Confirm Email → Approved).
- **WaitlistPanel**: The existing waitlist component (`packages/frontend/src/components/WaitlistPanel.tsx`) that manages the join/confirm/status flow.
- **WaitlistPage**: The public-facing waitlist page (`packages/frontend/src/pages/public/WaitlistPage.tsx`) that renders the WaitlistPanel.
- **Design_Token**: A CSS custom property defined in the theme system (e.g., `--primary`, `--muted-foreground`) used for consistent styling.

## Requirements

### Requirement 1: ChatPage Component Extraction

**User Story:** As a developer, I want ChatPage.tsx decomposed into focused sub-components, so that each piece is independently maintainable and testable.

#### Acceptance Criteria

1. THE Extraction SHALL produce four new component files: ContextSidebar.tsx, MessageBubble.tsx, PromptComposer.tsx, and WorkbenchPane.tsx in a dedicated directory under `packages/frontend/src/components/chat/`.
2. THE ChatPage SHALL import and compose ContextSidebar, MessageBubble, PromptComposer, and WorkbenchPane instead of inlining their markup.
3. AFTER extraction, THE ChatPage file SHALL contain fewer than 200 lines of code (excluding imports and type definitions).
4. THE ContextSidebar SHALL accept typed props for the context list, active context ID, and callback handlers (create, delete, select).
5. THE MessageBubble SHALL accept typed props for a single message object and render user messages, assistant messages, attachments, code blocks, file downloads, and model preview triggers.
6. THE PromptComposer SHALL accept typed props for the send handler, attachment handler, and disabled state.
7. THE WorkbenchPane SHALL accept typed props for the current model files, preview state, and download handlers.
8. EACH extracted sub-component SHALL be a named export using a PascalCase filename consistent with the project naming convention.
9. AFTER extraction, THE existing ChatPage test suite (`packages/frontend/src/__tests__/chat.page.test.tsx`) SHALL pass without modification to test assertions.
10. IF a utility function in ChatPage.tsx is used by more than one extracted sub-component, THEN THE Extraction SHALL move that function to a shared utilities file under `packages/frontend/src/components/chat/`.

### Requirement 2: AdminPanel Component Extraction

**User Story:** As a developer, I want AdminPanel.tsx decomposed into focused tab sub-components, so that each tab is independently maintainable and testable.

#### Acceptance Criteria

1. THE Extraction SHALL produce four new component files: DashboardTab.tsx, UsersTab.tsx, WaitlistTab.tsx, and SettingsTab.tsx in a dedicated directory under `packages/frontend/src/components/admin/`.
2. THE AdminPanel SHALL import and compose DashboardTab, UsersTab, WaitlistTab, and SettingsTab instead of inlining their markup.
3. AFTER extraction, THE AdminPanel file SHALL contain fewer than 150 lines of code (excluding imports and type definitions).
4. THE DashboardTab SHALL accept typed props for KPI data and render dashboard metrics.
5. THE UsersTab SHALL accept typed props for the user list, role update handler, and status update handler.
6. THE WaitlistTab SHALL accept typed props for the waitlist entries, approve handler, and reject handler.
7. THE SettingsTab SHALL accept typed props for the current settings and save handler.
8. EACH extracted sub-component SHALL be a named export using a PascalCase filename consistent with the project naming convention.
9. IF a utility function in AdminPanel.tsx is used by more than one extracted sub-component, THEN THE Extraction SHALL move that function to a shared utilities file under `packages/frontend/src/components/admin/`.
10. WHEN a confirmation dialog is needed within a tab, THE sub-component SHALL manage its own confirmation state using the existing ConfirmState interface pattern.

### Requirement 3: Waitlist Visual Stepper

**User Story:** As a waitlist applicant, I want to see a visual step indicator showing my progress through the waitlist flow, so that I understand where I am in the process and what comes next.

#### Acceptance Criteria

1. THE WaitlistStepper SHALL render three labeled steps: "Join", "Confirm Email", and "Approved".
2. THE WaitlistStepper SHALL visually distinguish between completed steps, the current active step, and upcoming steps using Design_Token colors.
3. THE WaitlistStepper SHALL accept a typed prop indicating the current step derived from the waitlist status (not_joined, pending_confirmation, pending_approval, approved, rejected).
4. WHEN the waitlist status is "not_joined", THE WaitlistStepper SHALL show "Join" as the active step and all other steps as upcoming.
5. WHEN the waitlist status is "pending_confirmation", THE WaitlistStepper SHALL show "Join" as completed, "Confirm Email" as the active step, and "Approved" as upcoming.
6. WHEN the waitlist status is "pending_approval", THE WaitlistStepper SHALL show "Join" and "Confirm Email" as completed, and "Approved" as the active step.
7. WHEN the waitlist status is "approved", THE WaitlistStepper SHALL show all three steps as completed.
8. WHEN the waitlist status is "rejected", THE WaitlistStepper SHALL show "Join" and "Confirm Email" as completed, and "Approved" as a rejected/failed step with a distinct visual treatment.
9. THE WaitlistStepper SHALL be rendered inside the WaitlistPanel component above the current flow content.
10. THE WaitlistStepper SHALL use lucide-react icons for step indicators consistent with the existing icon system.
11. THE WaitlistStepper SHALL be accessible, providing appropriate ARIA attributes (role, aria-current, aria-label) so screen readers can convey step progress.
12. THE WaitlistStepper SHALL use responsive layout that renders legibly on both desktop and mobile viewports.
