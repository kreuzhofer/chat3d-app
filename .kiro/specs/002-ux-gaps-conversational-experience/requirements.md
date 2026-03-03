# Requirements Document

## Introduction

This specification addresses the five remaining UX gaps identified in the Chat3D product vision (#[[file:docs/roadmap.md]]). The app is functionally complete but the experience doesn't yet feel like a polished conversational CAD tool. These requirements cover: making the conversation feel interactive (streaming, auto-preview, progressive disclosure), improving model generation quality (Build123d API enrichment, error recovery), enabling iterative refinement within a thread, guiding new users with example prompts, and making the 3D preview more prominent and controllable.

Additionally, this specification addresses navigation and layout cleanup to focus the chat experience. The product vision's first design principle — "Conversation is primary" — demands that the chat page use the full viewport for its three-pane workspace (ContextSidebar, thread, workbench) without an application-level sidebar competing for space. Developer-oriented pages (Query Workbench, Notifications) are restricted to admin users, and navigation to Profile and Admin is consolidated into the header username dropdown.

The requirements are organized by the four-phase roadmap defined in the product vision, from highest to lowest priority. Requirements 17–21 cover the navigation/layout cleanup scope. Requirements 22–23 formalize the inline 3D preview turntable animation behavior and the immutable chat history model, ensuring each assistant iteration is a self-contained record with its own interactive 3D preview, code, and downloads rendered directly in the conversation thread.

## Glossary

- **Chat_Thread**: The scrollable list of user and assistant messages within a single chat context.
- **Assistant_Response**: A message produced by the backend two-stage LLM pipeline (conversation text + codegen + rendered artifacts) and displayed in the Chat_Thread.
- **Streaming_Endpoint**: A backend HTTP endpoint that delivers LLM-generated tokens incrementally to the frontend using Server-Sent Events or chunked transfer encoding.
- **Typing_Indicator**: A visual animation displayed in the Chat_Thread while the backend is generating an Assistant_Response.
- **Progressive_Disclosure**: A UI pattern where secondary content (code, file lists, metadata) is collapsed by default and expandable on demand.
- **Download_Pill**: A compact inline button styled as a rounded pill for downloading a single generated file (STL, STEP, 3MF, B123D).
- **Example_Prompt**: A clickable suggestion shown in the empty chat state that fills and optionally submits a predefined user prompt.
- **Build123d_API_Reference**: A curated subset of Build123d classes, functions, and usage patterns included in the codegen system prompt to reduce hallucination.
- **Error_Recovery_Loop**: An automated retry mechanism where a Build123d rendering error is fed back to the LLM for a corrective code generation attempt.
- **Conversation_Context**: The sequence of previous user prompts, assistant texts, and generated code passed to the LLM to enable iterative refinement.
- **Model_Version**: A distinct generation result (code + rendered artifacts) associated with a single assistant item in the Chat_Thread.
- **Inline_3D_Preview**: An interactive Three.js viewer embedded directly within an assistant message in the Chat_Thread, showing the generated 3D model with Turntable_Animation and orbit controls.
- **Turntable_Animation**: A default slow rotation of the 3D model around the Z-axis in the Inline_3D_Preview, pausing on user interaction and resuming after a delay.
- **WorkbenchPane**: The right-side panel in the three-pane layout that displays 3D preview, parameters, files, and history tabs.
- **ModelViewer**: The Three.js-based component that renders STL and 3MF files in the browser.
- **Camera_Controls_Toolbar**: A visible set of buttons overlaid on the ModelViewer for reset view, zoom to fit, and fullscreen toggle.
- **Query_Service**: The backend service (`query.service.ts`) that orchestrates the conversation → codegen → rendering pipeline.
- **PromptComposer**: The frontend component containing the text input, attachment controls, and send button for submitting prompts.
- **Application_Shell_Sidebar**: The left-side navigation panel rendered by the AppShell layout component, containing navigation groups (Workspace, Account, Administration) for switching between authenticated pages.
- **Header_Dropdown**: The DropdownMenu triggered by the username/email in the top bar, providing quick access to Profile, Admin (for admin users), and session actions (Logout, Refresh Event Replay, Mark All Read).
- **Admin_User**: A user whose `role` property equals `"admin"`, granting access to the Admin panel, Query Workbench, and Notifications pages.
- **ContextSidebar**: The left panel within the ChatPage three-pane layout that displays the list of conversation contexts.
- **Admin_Route_Guard**: A routing check that restricts access to admin-only pages and redirects non-admin users to `/chat`.

## Requirements

### Requirement 1: Stream Assistant Responses Token-by-Token

**User Story:** As a user, I want to see the assistant's reply appear word by word, so that the conversation feels responsive and interactive rather than waiting for a complete wall of text.

#### Acceptance Criteria

1. WHEN a user submits a prompt, THE Streaming_Endpoint SHALL deliver conversation-stage LLM tokens incrementally to the frontend as they are generated.
2. WHILE the Streaming_Endpoint is delivering tokens, THE Chat_Thread SHALL render each received token within 100ms of receipt, appending it to the in-progress Assistant_Response.
3. WHEN all tokens have been delivered, THE Chat_Thread SHALL display the complete Assistant_Response with full markdown rendering.
4. IF the Streaming_Endpoint connection is interrupted before completion, THEN THE Chat_Thread SHALL display the partial response received so far and show an inline error indicating the stream was interrupted.
5. WHEN streaming is active, THE PromptComposer SHALL disable the send button to prevent concurrent submissions.

### Requirement 2: Display Typing Indicator During Generation

**User Story:** As a user, I want to see a visual indicator that the assistant is working on my request, so that I know the system is responsive and haven't lost my prompt.

#### Acceptance Criteria

1. WHEN a prompt is submitted and the backend begins processing, THE Chat_Thread SHALL display a Typing_Indicator below the last message.
2. WHILE the backend is in the "conversation" or "codegen" or "rendering" query state, THE Typing_Indicator SHALL remain visible and animate continuously.
3. WHEN the Assistant_Response begins streaming tokens, THE Typing_Indicator SHALL be replaced by the streaming response content.
4. IF the query fails, THEN THE Typing_Indicator SHALL be removed and replaced by a conversational error message.

### Requirement 3: Inline 3D Preview in Assistant Messages

**User Story:** As a user, I want to see an interactive 3D preview of the generated model directly within the assistant's message in the chat thread, so that I can inspect each iteration's result in context without switching to a separate pane.

#### Acceptance Criteria

1. WHEN an Assistant_Response includes preview-ready artifacts (STL or 3MF), THE Chat_Thread SHALL render an Inline_3D_Preview within the assistant message, displaying the generated 3D model using a Three.js viewer.
2. THE Inline_3D_Preview SHALL display a Turntable_Animation by default, slowly rotating the model around the Z-axis.
3. WHEN the user interacts with the Inline_3D_Preview (click, drag, or scroll), THE Turntable_Animation SHALL pause and the viewer SHALL provide full orbit, zoom, and pan controls.
4. WHEN the user stops interacting with the Inline_3D_Preview (mouseup or touchend), THE Turntable_Animation SHALL resume after a 2-second delay.
5. THE Inline_3D_Preview SHALL be sized to be prominent and useful within the message layout while not spanning the full width of the Chat_Thread.
6. WHILE the Inline_3D_Preview is loading the 3D model, THE viewer SHALL display a skeleton loading state.
7. IF the Inline_3D_Preview fails to load the 3D model, THEN THE viewer SHALL display an error message with a manual retry button.
8. THE WorkbenchPane SHALL continue to function as before, displaying the selected model's 3D preview independently of the Inline_3D_Preview.

### Requirement 4: Collapse Code and File Details with Progressive Disclosure

**User Story:** As a user, I want generated code and file metadata to be hidden by default so that the conversation stays clean, while still being able to expand them when needed.

#### Acceptance Criteria

1. THE Assistant_Response SHALL display the conversational text and 3D preview prominently, with code blocks and file detail lists collapsed by default.
2. WHEN a user clicks the expand control on a collapsed code section, THE Assistant_Response SHALL reveal the full generated Build123d code with syntax highlighting.
3. WHEN a user clicks the expand control on a collapsed file details section, THE Assistant_Response SHALL reveal the file list with filenames and types.
4. WHEN a user clicks the collapse control on an expanded section, THE Assistant_Response SHALL hide the content and restore the collapsed state.
5. THE expand/collapse controls SHALL include accessible labels and support keyboard activation.

### Requirement 5: Compact Inline Download Pills

**User Story:** As a user, I want download buttons to be small and inline within the message, so that they don't dominate the conversation layout.

#### Acceptance Criteria

1. THE Assistant_Response SHALL render available download options as compact Download_Pill elements inline within the message, replacing the current download bar layout.
2. WHEN a user clicks a Download_Pill, THE system SHALL initiate a browser download of the corresponding file.
3. THE Download_Pill elements SHALL display the file format label (STL, STEP, 3MF, B123D) and a download icon.
4. WHILE a download is in progress, THE clicked Download_Pill SHALL display a loading state.
5. IF no downloadable files are available, THEN THE Assistant_Response SHALL omit the Download_Pill section entirely.

### Requirement 6: Clickable Example Prompts in Empty State

**User Story:** As a new user, I want to see example prompts I can click to get started, so that I understand what Chat3D can do and don't face a blank screen.

#### Acceptance Criteria

1. WHEN the Chat_Thread has no messages and no active context, THE Chat_Thread SHALL display a set of at least four clickable Example_Prompt elements.
2. WHEN a user clicks an Example_Prompt, THE PromptComposer SHALL be populated with the example text.
3. THE Example_Prompt elements SHALL cover diverse CAD use cases (gears, enclosures, brackets, adapters).
4. THE empty state SHALL include a brief capability description explaining what kinds of parts Chat3D can generate.


### Requirement 7: Enrich Codegen Prompt with Build123d API Reference

**User Story:** As a user, I want the LLM to generate valid Build123d code that uses real API classes and functions, so that my models render successfully instead of failing due to hallucinated APIs.

#### Acceptance Criteria

1. THE Query_Service SHALL include a Build123d_API_Reference in the codegen system prompt, listing available classes (Box, Cylinder, Sphere, Cone, Torus, Extrude, Revolve, Loft, Sweep, Fillet, Chamfer, Boolean operations) and their constructor signatures.
2. THE codegen system prompt SHALL include at least four example code snippets covering common operations: extrude, revolve, boolean union/difference, and loft.
3. THE codegen system prompt SHALL instruct the LLM to use only documented Build123d classes and avoid inventing classes that do not exist in the reference.
4. WHEN the Build123d_API_Reference is updated, THE Query_Service SHALL use the updated reference for all subsequent code generation requests without requiring a service restart.

### Requirement 8: Implement Error Recovery Loop

**User Story:** As a user, I want the system to automatically retry when generated code fails to render, so that I get a working model without having to manually regenerate.

#### Acceptance Criteria

1. WHEN the rendering service returns an error for generated code, THE Query_Service SHALL feed the error message and the failing code back to the codegen LLM for a corrective attempt.
2. THE Error_Recovery_Loop SHALL attempt at most one corrective retry per user query.
3. WHILE the Error_Recovery_Loop is executing a corrective attempt, THE Chat_Thread SHALL display a status message indicating that the system is retrying with error feedback.
4. IF the corrective attempt also fails, THEN THE Query_Service SHALL return the final error to the user as a conversational error message.
5. WHEN the corrective attempt succeeds, THE Query_Service SHALL proceed with the corrected code as if the first attempt had succeeded, storing and rendering the corrected artifacts.

### Requirement 9: Show Render Errors Conversationally

**User Story:** As a user, I want rendering errors to appear as part of the conversation thread rather than as a disconnected red error box, so that I can understand what went wrong and respond naturally.

#### Acceptance Criteria

1. WHEN a rendering or code generation error occurs, THE Assistant_Response SHALL display the error as a conversational message within the Chat_Thread, including a plain-language explanation of what went wrong.
2. THE conversational error message SHALL include the specific error detail returned by the rendering service or LLM.
3. THE conversational error message SHALL suggest a follow-up action (e.g., "Try rephrasing your request" or "Ask me to use a different approach").
4. THE conversational error message SHALL be visually distinct from successful responses (using a warning or error tone) while remaining part of the message flow.

### Requirement 10: Pass Conversation History to LLM for Iterative Refinement

**User Story:** As a user, I want to say "make it taller" or "add a fillet" in a follow-up message and have the LLM understand what I'm referring to, so that I can iterate on my design through conversation.

#### Acceptance Criteria

1. WHEN a user submits a follow-up prompt in an existing chat context, THE Query_Service SHALL include previous user prompts, assistant conversation texts, and generated Build123d code from the same context in the LLM conversation input.
2. THE Conversation_Context SHALL include at most the last five exchange pairs (user prompt + assistant response) to stay within LLM token limits.
3. WHEN the Conversation_Context includes previous generated code, THE codegen prompt SHALL reference the most recent code as the baseline for modification.
4. THE Query_Service SHALL label each historical entry in the Conversation_Context with its role (user or assistant) and sequence position.

### Requirement 11: Support Follow-Up Modification Prompts

**User Story:** As a user, I want to send follow-up messages that modify my existing model rather than starting from scratch, so that I can iteratively refine my design.

#### Acceptance Criteria

1. WHEN a user submits a follow-up prompt in a context that already has generated code, THE codegen LLM SHALL receive the previous code and the modification request, and generate updated code that incorporates the requested changes.
2. WHEN a follow-up modification succeeds, THE Chat_Thread SHALL display the new Assistant_Response with the updated model, preserving the conversation history above it.
3. IF a follow-up modification prompt is ambiguous, THEN THE Assistant_Response SHALL ask a clarifying question before generating code.

### Requirement 12: Show Model Version History in Workbench

**User Story:** As a user, I want to see a history of model versions generated in my conversation, so that I can compare iterations and go back to a previous version.

#### Acceptance Criteria

1. WHEN multiple assistant items with 3D artifacts exist in a chat context, THE WorkbenchPane history tab SHALL list each Model_Version with its sequence number, timestamp, and a truncated summary of the originating prompt.
2. WHEN a user selects a Model_Version from the history list, THE WorkbenchPane SHALL load that version's 3D preview and file list.
3. THE currently displayed Model_Version SHALL be visually highlighted in the history list.

### Requirement 13: Capability Hints and Help Section

**User Story:** As a user, I want to understand what kinds of parts Chat3D can create, so that I set appropriate expectations and craft effective prompts.

#### Acceptance Criteria

1. THE empty chat state SHALL display a capability description listing categories of parts Chat3D can generate (gears, brackets, enclosures, adapters, mechanical components).
2. THE PromptComposer area SHALL include an accessible "What can I build?" help trigger that opens a brief help section.
3. WHEN a user activates the "What can I build?" trigger, THE system SHALL display a panel or popover listing supported part types, example dimensions, and known limitations.
4. THE help content SHALL be dismissible and not interfere with the prompt input flow.

### Requirement 14: Add Visible Camera Controls to 3D Preview

**User Story:** As a user, I want visible camera control buttons on the 3D preview, so that I can easily reset the view and zoom to fit without guessing mouse gestures.

#### Acceptance Criteria

1. WHEN a 3D model is loaded in the ModelViewer, THE Camera_Controls_Toolbar SHALL be visible overlaid on the preview area.
2. THE Camera_Controls_Toolbar SHALL include a "Reset View" button that resets the camera to the default fit-to-object position.
3. THE Camera_Controls_Toolbar SHALL include a "Zoom to Fit" button that adjusts the camera to frame the entire model.
4. THE Camera_Controls_Toolbar buttons SHALL include accessible labels and support keyboard activation.

### Requirement 15: Add Fullscreen Toggle for 3D Preview

**User Story:** As a user, I want to expand the 3D preview to fullscreen, so that I can inspect model details on a larger canvas.

#### Acceptance Criteria

1. THE Camera_Controls_Toolbar SHALL include a fullscreen toggle button.
2. WHEN a user activates the fullscreen toggle, THE ModelViewer SHALL expand to fill the viewport, overlaying other UI elements.
3. WHEN a user deactivates the fullscreen toggle (via button or Escape key), THE ModelViewer SHALL return to its original size within the WorkbenchPane.
4. WHILE in fullscreen mode, THE Camera_Controls_Toolbar SHALL remain visible and functional.

### Requirement 16: Mobile Auto-Switch to Preview on Generation

**User Story:** As a mobile user, I want the app to automatically switch to the preview pane when a new model is generated, so that I see the result immediately without manual tab switching.

#### Acceptance Criteria

1. WHEN a new preview-ready artifact is generated and the viewport width is below the desktop breakpoint (xl), THE Chat_Thread pane SHALL automatically switch to the "workbench" mobile pane.
2. THE auto-switch SHALL occur only when a new model generation completes, not when browsing existing history.
3. THE user SHALL be able to manually switch back to the "thread" pane after auto-switch.

### Requirement 17: Remove Application Shell Sidebar from Chat Page

**User Story:** As a user, I want the chat page to use the full viewport width for the three-pane workspace (ContextSidebar, thread, workbench), so that the conversation and 3D preview have maximum space without a redundant navigation sidebar.

#### Acceptance Criteria

1. WHEN an authenticated user navigates to the chat page (`/chat`, `/chat/new`, `/chat/:contextId`), THE Application_Shell_Sidebar SHALL NOT be rendered in the page layout.
2. THE ChatPage layout SHALL occupy the full width of the viewport, rendering the ContextSidebar on the left, the Chat_Thread in the center, and the WorkbenchPane on the right.
3. WHEN an authenticated user navigates to a non-chat page (Profile, Admin), THE Application_Shell_Sidebar layout MAY be retained or replaced as appropriate for that page.
4. THE mobile navigation drawer SHALL remain accessible on the chat page via a menu trigger in the header for navigating to non-chat pages.

### Requirement 18: Move Profile and Admin Access to Header Dropdown

**User Story:** As a user, I want to access my Profile and (if I am an admin) the Admin panel from the header username dropdown, so that navigation to these pages is always available without a sidebar.

#### Acceptance Criteria

1. THE Header_Dropdown SHALL include an "Open Profile" menu item that navigates to the `/profile` page.
2. WHERE the authenticated user is an Admin_User, THE Header_Dropdown SHALL include an "Admin" menu item that navigates to the `/admin` page.
3. WHERE the authenticated user is not an Admin_User, THE Header_Dropdown SHALL NOT display the "Admin" menu item.
4. THE Header_Dropdown menu items for Profile and Admin SHALL be positioned above session-action items (Refresh Event Replay, Mark All Read, Logout).

### Requirement 19: Restrict Query Workbench to Admin Users

**User Story:** As a product owner, I want the Query Workbench to be accessible only to admin users, so that this developer debug tool is not exposed to regular users.

#### Acceptance Criteria

1. THE Application_Shell_Sidebar SHALL NOT include the Query Workbench navigation item for any user.
2. WHERE the authenticated user is an Admin_User, THE Header_Dropdown SHALL include a "Query Workbench" menu item that navigates to the `/query` page.
3. WHERE the authenticated user is not an Admin_User, THE Header_Dropdown SHALL NOT display the "Query Workbench" menu item.
4. WHEN a non-admin user navigates to the `/query` route, THE Admin_Route_Guard SHALL redirect the user to `/chat`.

### Requirement 20: Restrict Notifications to Admin Users

**User Story:** As a product owner, I want the Notifications page and bell icon to be visible only to admin users, so that regular users are not exposed to system-level notifications.

#### Acceptance Criteria

1. THE Application_Shell_Sidebar SHALL NOT include the Notifications navigation item for any user.
2. WHERE the authenticated user is an Admin_User, THE header top bar SHALL display the notification bell icon with the unread count badge.
3. WHERE the authenticated user is not an Admin_User, THE header top bar SHALL NOT render the notification bell icon or unread count badge.
4. WHEN a non-admin user navigates to the `/notifications` route, THE Admin_Route_Guard SHALL redirect the user to `/chat`.

### Requirement 21: Enforce Admin-Only Route Access

**User Story:** As a product owner, I want non-admin users to be redirected to the chat page when they attempt to access admin-only routes, so that access control is enforced at the routing level.

#### Acceptance Criteria

1. WHEN a non-admin user navigates to `/query`, THE Admin_Route_Guard SHALL redirect the user to `/chat`.
2. WHEN a non-admin user navigates to `/notifications`, THE Admin_Route_Guard SHALL redirect the user to `/chat`.
3. WHEN a non-admin user navigates to `/admin`, THE Admin_Route_Guard SHALL redirect the user to `/chat`.
4. WHEN an Admin_User navigates to `/query`, `/notifications`, or `/admin`, THE Admin_Route_Guard SHALL allow access and render the requested page.
5. THE Admin_Route_Guard redirects SHALL use replace navigation to prevent the restricted route from appearing in browser history.

### Requirement 22: Inline 3D Preview Turntable Animation

**User Story:** As a user, I want the inline 3D preview to slowly rotate the model by default, so that I can see the shape from multiple angles without manually dragging, while retaining full manual control when I interact with it.

#### Acceptance Criteria

1. THE Inline_3D_Preview SHALL display a Turntable_Animation by default, rotating the model around the Z-axis at a slow, smooth speed of approximately one full rotation every 10 to 15 seconds.
2. THE Turntable_Animation SHALL use requestAnimationFrame for smooth, frame-rate-independent rendering.
3. WHEN the user begins interacting with the Inline_3D_Preview (mousedown or touchstart), THE Turntable_Animation SHALL pause immediately.
4. WHEN the user stops interacting with the Inline_3D_Preview (mouseup or touchend), THE Turntable_Animation SHALL resume after a 2-second delay.
5. WHILE the Turntable_Animation is active, THE model rotation SHALL be smooth and continuous without visible stuttering or frame drops.

### Requirement 23: Immutable Chat History with Per-Message Artifacts

**User Story:** As a user, I want every assistant response in my conversation to be preserved as an immutable record with its own 3D preview, code, and downloads, so that I can scroll through my full iteration history and revisit any previous version.

#### Acceptance Criteria

1. WHEN a user submits a follow-up prompt or regenerates, THE Query_Service SHALL create a new assistant item in the chat context, preserving all previous assistant items without modification.
2. THE Chat_Thread SHALL display all assistant responses in chronological order, each rendered as a complete message with its own Inline_3D_Preview, code section, and Download_Pill elements.
3. WHEN multiple assistant items with 3D artifacts exist in a chat context, THE user SHALL be able to scroll through the full history of iterations within the Chat_Thread.
4. Each assistant item's generated Build123d code SHALL be viewable per-message, collapsed by default per Requirement 4 Progressive_Disclosure rules.
5. Each assistant item's downloadable files (STL, STEP, 3MF) SHALL be available per-message as Download_Pill elements per Requirement 5.
6. THE Chat_Thread SHALL NOT overwrite, merge, or remove previous assistant items when new iterations are generated.
