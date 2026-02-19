# Chat3D UI/UX Follow-up Plan (Design-Only Track)

## Purpose

This plan is focused only on design, usability, and interaction quality for the active app in `packages/frontend`.

It does not introduce new backend business features by default.
It modernizes the experience using Tailwind + shadcn/ui best practices and a coherent product UX system.

## Design Goals

- Reach visual and interaction quality at least on par with the legacy Amplify app.
- Build a clear information architecture for user and admin workflows.
- Improve chat ergonomics (focus, speed, clarity, confidence).
- Upgrade admin tooling from basic CRUD tables to task-oriented operations.
- Ship accessible, responsive, and consistent UI patterns.

## Confirmed Decisions (Q&A Round 1)

- Navigation pattern: ChatGPT-style shell with persistent left sidebar.
- Left sidebar contents: main navigation + chat list.
- Chat layout: 3-pane (`contexts` + `thread` + `3D preview/parameters/actions`).
- Chat entry behavior: `/chat` opens a new conversation by default.
- Admin landing: dashboard first (KPIs + quick actions).
- Admin priority workflows (initial): user management and waitlist operations.
- Notifications UX (initial): separate chronological log page.
- Profile/account UX (initial): single page until complexity justifies split.
- Visual direction: modern SaaS style.
- Responsiveness strategy: mobile-first and fully adaptive.
- Command palette: deferred for now (not in first UX milestones).

## Confirmed Decisions (Q&A Round 2)

- We need a first-class non-authenticated experience, not only auth forms.
- Required public routes include Home, Registration, Login, Legal, and Pricing.

## Confirmed Decisions (Q&A Round 3)

- Legal content is consolidated into one page.
  - One `Legal` page includes imprint, terms, privacy, and cookie sections.
  - Content source is static markdown files in-repo.
- Pricing is free-only for now (pricing page still exists as a product/commercial placeholder).
- Home primary CTA is dynamic:
  - If waitlist is disabled -> `/register`
  - If waitlist is enabled -> `/waitlist`
- Home page should also surface waitlist-state-specific explanatory text.
- Post-login default route remains `/chat`.
- Auth method remains email/password only (no SSO in this phase).
- No pricing plan selection in registration flow for now.
- Public top nav: `Product`, `Pricing`, `Login`.
- Public footer: `Imprint`, `Legal`.

## Confirmed Decisions (Q&A Round 4)

- Keep a single landing page at `/` for now; no dedicated `/product` page in this phase.
- `Product` top-nav item points to anchored sections on `/` (for example `/#product`, `/#how-it-works`, `/#trust`).
- `Docs` link is removed for now.
- Legal content is composed from multiple markdown files for the legal surface, while imprint stays standalone.
- Public waitlist/registration mode is sourced from an API endpoint.
- `/register` remains technically accessible; registration still requires valid registration token/code when policy requires it.
- Pricing page uses `Free` + `Coming soon` cards.

## Confirmed Decisions (Q&A Round 5)

- Authenticated users visiting `/` are redirected to `/chat`.
- Home section sequence: Hero -> How it works -> 3-pane preview -> Trust -> Pricing CTA.
- Primary CTA label: `Start Building`.
- Primary CTA text/target is context-aware by waitlist mode:
  - Waitlist disabled: registration-oriented CTA
  - Waitlist enabled: waitlist-oriented CTA (`Join Waitlist`)
- Pricing `Coming soon` cards should collect interest emails (priority).
- Legal content structure:
  - `Imprint` is a separate page (regulatory requirement, Germany).
  - Terms/Privacy/Cookies are composed into the legal surface.
- Login page actions are context-aware (register vs waitlist guidance).
- Mobile top-level navigation uses a hamburger menu only.
- Mobile UX priority is minimal clutter and maximum screen estate for chat.
- Desktop 3-pane chat maps to a 3-view mobile experience (thread/preview/actions) with switching mechanics to be finalized (tabs/buttons vs swipe).

## Confirmed Decisions (Q&A Round 6)

- Mobile chat pane switch uses explicit segmented buttons as the primary interaction.
- Swipe-based pane switching is deferred as an optional enhancement after baseline usability is validated.

## Confirmed Decisions (Q&A Round 7)

- Do not introduce separate pricing interest-capture forms.
- All pre-registration email capture reuses the existing waitlist flow only.

## Confirmed Decisions (Q&A Round 8 - Locked Defaults)

- Mobile chat pane switch bar position: top sticky segmented control.
- Sidebar chat list grouping: recency buckets (`Today`, `Last 7 days`, `Older`).
- `/chat` default behavior: UI-only draft state; persist/create context on first message send.
- Desktop right pane structure: tabbed panel (`Preview`, `Parameters`, `Files`, `History`).
- Parameter adjustments mode: both structured controls and advanced prompt edits.
- Regenerate scope: both supported; default action targets the latest assistant response.
- Admin dashboard initial KPI set:
  - pending waitlist count
  - average waitlist approval time
  - new registrations (7d)
  - active users (7d)
  - deactivated users count
  - query/render success rate (24h/7d)
- Admin dashboard initial quick actions:
  - Review Waitlist
  - Approve Next
  - Open Deactivated Users
  - Toggle Waitlist (with confirmation)
- Waitlist moderation v1: single-item flow first, bulk actions deferred.
- Theme policy now: light-only; dark mode deferred until UX stabilization.

## Non-Goals

- No major backend contract expansion unless UI requires a minimal API field.
- No re-introduction of Amplify/Semantic UI runtime dependencies.
- No style-only churn without measurable UX outcome.

## UI Architecture Principles

- Single app shell: consistent header/sidebar, clear primary navigation, route breadcrumbs.
- Task-first screens: each page optimizes for top 1-3 user jobs.
- Progressive disclosure: advanced controls hidden until needed.
- Systemized components: shared primitives and patterns before page rewrites.
- Accessibility baseline: keyboard-first, focus visibility, ARIA labels, color contrast targets.
- Performance-aware UX: lazy-heavy modules (viewer), predictable loading/skeleton states.

## Proposed Page Map

### Public

- `/` Home (product value, hero, social proof, CTA)
- `/pricing` Pricing and plan comparison
- `/login` Login
- `/register` Registration
- `/waitlist` Waitlist join/status
- `/waitlist/confirm` Email confirmation result
- `/imprint` Imprint page (standalone)
- `/legal` Legal page (terms + privacy + cookies)

## Public Flow Concept

- Home -> Pricing -> Register/Login
- Home -> Register (primary CTA) and Login (secondary CTA)
- Home/Footer -> Imprint + Legal
- Pricing -> Register (selected plan context) or Waitlist (if registration is gated)
- Register success -> Authenticated app (`/chat` new conversation default)
- If waitlist policy blocks open registration, register attempts route user to `/waitlist` with clear reason and CTA.
- Login failure states remain on `/login` with inline recovery prompts

## Public Page Requirements

### Home (`/`)

- Modern SaaS hero with product narrative and visual of 3-pane workspace.
- Core value sections include prompt-to-model workflow, collaboration/admin governance confidence, and reliability (self-hosted stack + deterministic flows).
- Section order: Hero -> How it works -> 3-pane workspace preview -> Trust -> Pricing CTA.
- Primary CTA: dynamic -> `/register` or `/waitlist` based on waitlist setting
- Secondary CTA: `View Pricing`
- `Product` nav points to anchored sections on the same page.

### Pricing (`/pricing`)

- `Free` + `Coming soon` pricing cards, with layout prepared for future paid tiers.
- `Coming soon` cards route interested users to `/waitlist` (no separate email form).
- CTA behavior: if open registration send to `/register`; if waitlist is active send to `/waitlist`.
- Legal micro-copy near CTA linking to Terms/Legal.

### Login (`/login`)

- Focused auth screen with minimal distractions.
- Inline error and status messaging.
- Context-aware guidance/actions (register vs waitlist).

### Registration (`/register`)

- Progressive form with optional registration token support.
- Explicit state when waitlist/policy blocks registration.
- Link back to pricing and legal docs.
- No plan selection step in this phase.

### Legal (`/legal`)

- Shared legal layout + typography baseline.
- Legal page includes sections for terms, privacy, and cookies.
- Source content is composed from multiple static markdown files in-repo.
- Global footer links visible from all public pages and auth screens.

### Imprint (`/imprint`)

- Standalone imprint page for regulatory compliance.
- Source content from dedicated static markdown file.

### Authenticated User

- `/chat` New conversation default (context list + active thread)
- `/chat/new` New conversation flow
- `/chat/:contextId` Conversation detail
- `/profile` Account and preferences
- `/notifications` Notification center/inbox

### Admin

- `/admin` Admin dashboard (KPIs + alerts + quick actions)
- `/admin/users` User management (search/filter/detail drawer)
- `/admin/waitlist` Waitlist moderation queue
- `/admin/settings` Policy controls (waitlist/invites/quotas)
- `/admin/audit` Audit/event history (optional if currently available)

## Navigation Model

- Desktop: ChatGPT-style left sidebar with grouped sections and chat list.
- Mobile: top-level navigation is hamburger-only; avoid persistent nav chrome to preserve workspace area.
- Contextual secondary nav inside Admin (`Dashboard`, `Users`, `Waitlist`, `Settings`).
- Cross-links:
  - Waitlist entry -> user detail
  - User detail -> invitations/activity
  - Chat notification -> deep-link to message context

## Milestone Ledger (Design-Only)

| Milestone | Scope | Status |
|---|---|---|
| UX0 Public Experience + Auth Surface | Home, pricing, login/register split, legal pages, public nav/footer, conversion flow | Completed (2026-02-19) |
| UX1 Product IA + Design System Foundation | App shell, tokens, typography, spacing, component standards, page templates | Completed (2026-02-19) |
| UX2 Core Navigation + Shell Rewrite | Unified nav, responsive shell, breadcrumb/context controls, skeleton/loading states | Completed (2026-02-19) |
| UX3 Chat Experience Redesign | Composer ergonomics, timeline readability, model/file action UX, feedback affordances | Planned |
| UX4 Admin Experience Redesign | Dashboard, task queues, user detail workflows, settings UX, error prevention | Planned |
| UX5 Account/Notifications/Waitlist Polish | Profile journeys, notification triage, waitlist clarity and conversion UX | Planned |
| UX6 Accessibility + UX Quality Gate | a11y checks, usability pass, visual regression snapshots, interaction polish | Planned |

## Detailed Milestones

### UX0: Public Experience + Auth Surface

- [x] UX0.1 Build a dedicated public layout (`PublicShell`) with top nav + footer legal links.
- [x] UX0.2 Implement Home page with clear value proposition and conversion CTAs.
- [x] UX0.3 Implement Pricing page with plan comparison and CTA routing logic.
- [x] UX0.4 Split Login and Registration into standalone pages.
- [x] UX0.5 Implement legal surfaces using static markdown content:
  - standalone `/imprint`
  - `/legal` composed from terms/privacy/cookies markdown files.
- [x] UX0.6 Define auth-route transitions and dynamic CTA behavior for waitlist-on/waitlist-off states.
- [x] UX0.7 Implement a public waitlist-mode API read in the public shell to drive CTA routing and explanatory copy.
- [x] UX0.8 Ensure pricing and coming-soon CTAs reuse waitlist flow for all email capture.
- Exit criteria:
- [x] UX0.E1 Public users can navigate Home -> Pricing -> Register/Login/Waitlist without dead ends.
- [x] UX0.E2 Legal links are available in public footer and auth pages.
- [x] UX0.E3 Public surface has consistent responsive behavior on mobile and desktop.

### UX0 Validation Evidence (2026-02-19)

- Public shell is implemented with desktop nav + mobile hamburger and global footer links (`Imprint`, `Legal`).
- Public routes are live and separated from authenticated runtime:
  - `/`, `/pricing`, `/login`, `/register`, `/waitlist`, `/waitlist/confirm`, `/legal`, `/imprint`.
- Backend now exposes `GET /api/public/config`; frontend consumes it to drive waitlist-aware CTA routing and copy.
- Home and pricing CTAs are context-aware:
  - waitlist off -> registration flow
  - waitlist on -> waitlist flow
- `Coming soon` pricing interest capture routes to waitlist (no parallel email capture mechanism).
- Legal content is composed from static markdown files under `packages/frontend/public/legal`.

### UX1: Product IA + Design System Foundation

- [x] UX1.1 Define typography scale, spacing scale, elevation, color roles, semantic tokens.
- [x] UX1.2 Add app layout primitives: `AppShell`, `PageHeader`, `SectionCard`, `EmptyState`, `InlineAlert`.
- [x] UX1.3 Add interaction primitives: command bar trigger, dropdown menus, dialogs, drawers, toasts.
- [x] UX1.4 Define form standards: validation messages, helper text, destructive action confirmations.
- [x] UX1.5 Document component usage rules and anti-patterns.
- Exit criteria:
- [x] UX1.E1 Shared visual language is used by at least two core pages.
- [x] UX1.E2 No page-level ad hoc spacing/color overrides in migrated screens.

### UX1 Validation Evidence (2026-02-19)

- Theme tokens expanded in `packages/frontend/src/styles/theme.css`:
  typography scale, spacing scale, semantic color roles, elevation layers, focus ring contract.
- Layout primitives shipped in `packages/frontend/src/components/layout`:
  `AppShell`, `PageHeader`, `SectionCard`, `EmptyState`, `InlineAlert`, `StateViews`, `CommandBarTrigger`.
- Interaction primitives shipped in `packages/frontend/src/components/ui`:
  `dropdown-menu`, `dialog`, `drawer`, `toast`, and `tabs`.
- Form standards shipped in `packages/frontend/src/components/ui/form.tsx` and applied to auth pages:
  field helper/error patterns + destructive action notice contract.
- Component usage rules and anti-patterns documented in `docs/ui_component_guidelines.md`.
- Shared visual language usage validated on:
  - `QueryWorkbench` (header/card/empty/form patterns)
  - `NotificationCenter` (header/card/empty/badge patterns)

### UX2: Core Navigation + Shell Rewrite

- [x] UX2.1 Replace top utility card with persistent app shell.
- [x] UX2.2 Introduce grouped navigation and role-based visibility in one nav system.
- [x] UX2.3 Add mobile-first adaptive nav strategy and breakpoint behavior.
- [x] UX2.4 Add breadcrumbs + contextual actions in page headers.
- [x] UX2.5 Standardize loading/empty/error states across all primary routes.
- Exit criteria:
- [x] UX2.E1 Route transitions preserve context and are visually consistent.
- [x] UX2.E2 User can navigate all main jobs with <=2 interactions from shell.

### UX2 Validation Evidence (2026-02-19)

- Authenticated runtime now uses a persistent shell (`AppShell`) instead of top utility cards.
- Grouped role-aware navigation is centralized in app-level config:
  `Workspace`, `Account`, and conditional `Administration`.
- Mobile-first adaptive navigation is implemented with a drawer menu for small screens.
- Top bar now provides breadcrumb context (`App / <Route>`) and route-aware contextual actions.
- Loading/empty/error standardization shipped through shared state views and applied at route shell level.

### UX3: Chat Experience Redesign

- [ ] UX3.1 Redesign chat layout as 3-pane workspace (context sidebar, thread, 3D preview/parameters/actions).
- [ ] UX3.1a Implement top sticky segmented buttons for mobile pane switching; keep swipe as optional future enhancement.
- [ ] UX3.2 Upgrade composer UX (multiline input, keyboard shortcuts, send states, model toggles).
- [ ] UX3.3 Redesign assistant message cards for readable hierarchy and action clarity.
- [ ] UX3.4 Improve file/model blocks (preview, download group, failure recovery messaging).
- [ ] UX3.5 Defer command palette; design extension points so it can be added later without nav rewrite.
- [ ] UX3.6 Add micro-interactions (streaming/pending states, subtle motion, completion transitions).
- [ ] UX3.7 Group sidebar chat contexts by recency buckets (`Today`, `Last 7 days`, `Older`).
- [ ] UX3.8 Implement non-persistent draft conversation on `/chat`; create context at first send.
- [ ] UX3.9 Build right-pane tabs (`Preview`, `Parameters`, `Files`, `History`) with low-clutter defaults.
- Exit criteria:
- [ ] UX3.E1 Chat tasks are faster than baseline (subjective usability session + timing).
- [ ] UX3.E2 Visual parity with legacy is met or exceeded in stakeholder review.

### UX4: Admin Experience Redesign

- [ ] UX4.1 Build admin dashboard with operational KPIs and queue snapshots.
- [ ] UX4.2 Replace table-only users view with filterable list + detail drawer.
- [ ] UX4.3 Build waitlist moderation queue with bulk actions and reason prompts.
- [ ] UX4.4 Redesign settings page with grouped policy cards and impact summaries.
- [ ] UX4.5 Add confirmation/undo patterns for high-risk admin actions.
- [ ] UX4.6 Prioritize user-management and waitlist workflows in dashboard IA and quick actions.
- [ ] UX4.7 Ship single-item moderation first; stage bulk moderation for follow-up milestone.
- Exit criteria:
- [ ] UX4.E1 Admin can complete core moderation flow without page hopping confusion.
- [ ] UX4.E2 High-risk actions are explicit and auditable from UX perspective.

### UX5: Account, Notifications, Waitlist Polish

- [ ] UX5.1 Turn profile into journey-based sections (security, identity, data, deactivation).
- [ ] UX5.2 Redesign notification center into actionable inbox with filters and deep links.
- [ ] UX5.3 Improve waitlist funnel messaging and status clarity.
- [ ] UX5.4 Ensure invitation flow is visible, comprehensible, and quota-aware.
- Exit criteria:
- [ ] UX5.E1 Non-admin users can understand account state and next actions immediately.
- [ ] UX5.E2 Notification-to-action flow works with clear deep-linking.

### UX6: Accessibility + UX Quality Gate

- [ ] UX6.1 Keyboard navigation audit (tab order, escape handling, focus trapping in dialogs/drawers).
- [ ] UX6.2 Contrast/typography audit for all key screens.
- [ ] UX6.3 Screen-reader labels and landmarks review.
- [ ] UX6.4 Motion/perf pass (avoid jank, preserve perceived responsiveness).
- [ ] UX6.5 Capture regression snapshots and UX acceptance checklist.
- Exit criteria:
- [ ] UX6.E1 Accessibility baseline is met across chat, admin, profile, waitlist.
- [ ] UX6.E2 UX sign-off checklist is complete for all rewritten routes.

## Delivery Artifacts per Milestone

- Updated route-level wireframe notes in docs.
- Before/after screenshots for desktop and mobile.
- Interaction notes for keyboard and edge states.
- Test evidence (existing frontend tests + added interaction tests where applicable).
