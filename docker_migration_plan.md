# Chat3D Migration Plan: AWS Amplify -> Dockerized Express + React

## Context

Chat3D is an AI-powered 3D CAD modeling app that lets users create 3D models via natural language chat. It currently runs on AWS Amplify (AppSync GraphQL, Lambda, DynamoDB, S3, Cognito). We are rebuilding it as a self-hosted Docker stack with an Express API + PostgreSQL backend and React frontend.

Core migration constraints and additions:
- Replace AWS-managed backend primitives with self-hosted equivalents.
- Use Server-Sent Events (SSE) for dynamic updates, messaging, and notifications (no polling).
- Add user roles (`admin`, `user`) and an admin panel.
- Add waitlisting with double-email flow and single-use registration tokens.
- Add invitation system with admin-controlled policy and quotas.
- Add profile/account lifecycle actions with email-confirmed workflows.
- Keep Build123d rendering, remove Patreon, remove Mixpanel, remove OpenSCAD.
- Move LLM invocation to Vercel AI SDK.

---

## Target Architecture

```mermaid
graph LR
    Frontend["Frontend\nReact+Vite\n(nginx :80)"] --> Backend["Backend\nExpress+TS\n(:3001)"]
    Frontend --> SSE["SSE Stream\n/api/events/stream"]
    Backend --> PostgreSQL["PostgreSQL\n(DB)"]
    Backend --> Redis["Redis\n(pub/sub + queues)"]
    Backend --> Storage["Local Storage\n(files)"]
    Backend --> Build123d["Build123d Service\n(internal docker :80, linux/amd64)"]
    Backend --> LLM["LLM Providers\n(Vercel AI SDK)"]
    Backend --> Email["SMTP/Email Provider\n(transactional emails)"]
```

All services orchestrated via `docker-compose.yml`.

---

## Project Structure

```
chat3d/
|- docker-compose.yml
|- .env.example
|- packages/
|  |- shared/
|  |  |- src/types.ts
|  |  |- src/events.ts
|  |  |- package.json
|  |  \- tsconfig.json
|  |- backend/
|  |  |- Dockerfile
|  |  |- package.json
|  |  |- tsconfig.json
|  |  \- src/
|  |     |- index.ts
|  |     |- config.ts
|  |     |- db/
|  |     |  |- connection.ts
|  |     |  \- migrations/
|  |     |     |- 001_initial_schema.ts
|  |     |     |- 002_auth_admin_waitlist_invites.ts
|  |     |     \- 003_notifications_account_lifecycle.ts
|  |     |- middleware/
|  |     |  |- auth.ts
|  |     |  |- requireRole.ts
|  |     |  \- errorHandler.ts
|  |     |- routes/
|  |     |  |- auth.routes.ts
|  |     |  |- admin.routes.ts
|  |     |  |- profile.routes.ts
|  |     |  |- waitlist.routes.ts
|  |     |  |- invitations.routes.ts
|  |     |  |- events.routes.ts
|  |     |  |- chat.routes.ts
|  |     |  |- query.routes.ts
|  |     |  |- files.routes.ts
|  |     |  \- llm.routes.ts
|  |     |- services/
|  |     |  |- auth.service.ts
|  |     |  |- admin.service.ts
|  |     |  |- waitlist.service.ts
|  |     |  |- invitation.service.ts
|  |     |  |- accountLifecycle.service.ts
|  |     |  |- notification.service.ts
|  |     |  |- sse.service.ts
|  |     |  |- email.service.ts
|  |     |  |- chat.service.ts
|  |     |  |- query.service.ts
|  |     |  |- llm.service.ts
|  |     |  |- rendering.service.ts
|  |     |  \- file.service.ts
|  |     |- workers/
|  |     |  |- email.worker.ts
|  |     |  \- accountDeletion.worker.ts
|  |     \- utils/
|  |        \- retry.ts
|  \- frontend/
|     |- Dockerfile
|     |- nginx.conf
|     |- package.json
|     |- tsconfig.json
|     |- vite.config.ts
|     |- index.html
|     \- src/
|        |- main.tsx
|        |- App.tsx
|        |- index.css
|        |- api/
|        |  |- client.ts
|        |  |- auth.api.ts
|        |  |- admin.api.ts
|        |  |- profile.api.ts
|        |  |- waitlist.api.ts
|        |  |- invitations.api.ts
|        |  |- chat.api.ts
|        |  \- query.api.ts
|        |- contexts/
|        |  |- AuthContext.tsx
|        |  \- NotificationsContext.tsx
|        |- hooks/
|        |  |- useAuth.tsx
|        |  \- useSSE.ts
|        |- Components/
|        |  |- LoginForm.tsx
|        |  |- RegisterForm.tsx
|        |  |- AdminPanel.tsx
|        |  |- InviteManager.tsx
|        |  |- NotificationCenter.tsx
|        |  |- ChatMessage.tsx
|        |  |- ChatMessageAI.tsx
|        |  |- ChatMessageUser.tsx
|        |  |- ModelViewer.tsx
|        |  \- ChatContextComponent.tsx
|        \- Pages/
|           |- Chat.tsx
|           |- Layout.tsx
|           |- Profile.tsx
|           |- Admin.tsx
|           |- WaitlistJoin.tsx
|           \- CompleteRegistration.tsx
|- services/
|  \- build123d/
|     |- Dockerfile
|     |- requirements.txt
|     \- app/
|        \- main.py
```

---

## Database Schema (PostgreSQL)

### Core users and auth

```sql
CREATE TYPE user_role AS ENUM ('admin', 'user');
CREATE TYPE user_status AS ENUM ('active', 'deactivated', 'pending_registration');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    role user_role NOT NULL DEFAULT 'user',
    status user_status NOT NULL DEFAULT 'active',
    deactivated_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
```

### Feature flags and policy

```sql
CREATE TABLE app_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    waitlist_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    invitations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    invitation_waitlist_required BOOLEAN NOT NULL DEFAULT FALSE,
    invitation_quota_per_user INTEGER NOT NULL DEFAULT 3 CHECK (invitation_quota_per_user >= 0),
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Waitlist and registration tokens

```sql
CREATE TYPE waitlist_status AS ENUM ('pending_email_confirmation', 'pending_admin_approval', 'approved', 'rejected');

CREATE TABLE waitlist_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
    email_confirmed_at TIMESTAMPTZ,
    status waitlist_status NOT NULL DEFAULT 'pending_email_confirmation',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE registration_token_source AS ENUM ('waitlist', 'admin_invite', 'user_invite');

CREATE TABLE registration_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    source registration_token_source NOT NULL,
    invited_by_user_id UUID REFERENCES users(id),
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_registration_tokens_email ON registration_tokens(email);
```

### Invitations

```sql
CREATE TYPE invitation_status AS ENUM ('pending', 'waitlisted', 'registration_sent', 'accepted', 'expired', 'revoked');

CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_email VARCHAR(255) NOT NULL,
    status invitation_status NOT NULL DEFAULT 'pending',
    registration_token_id UUID REFERENCES registration_tokens(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (inviter_user_id, invitee_email)
);
CREATE INDEX idx_invitations_inviter ON invitations(inviter_user_id);
CREATE INDEX idx_invitations_email ON invitations(invitee_email);
```

### Account action confirmations (email-confirmed workflows)

```sql
CREATE TYPE account_action_type AS ENUM ('password_reset', 'email_change', 'data_export', 'account_delete', 'account_reactivate');
CREATE TYPE account_action_status AS ENUM ('pending', 'completed', 'expired', 'cancelled');

CREATE TABLE account_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type account_action_type NOT NULL,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status account_action_status NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_account_actions_user ON account_actions(user_id);
```

### Notifications and SSE replay

```sql
CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
```

### Existing chat domain

Keep and migrate existing chat tables (`chat_contexts`, `chat_items`) with ownership and indexes.

---

## Backend API Design

### Auth (`/api/auth`)
| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register with email/password, validates registration token policy |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/auth/logout` | Token invalidation/rotation handling |
| GET | `/api/auth/me` | Current authenticated user |

Registration rules:
- If waitlisting is enabled, direct registration is blocked unless request contains a valid unconsumed `registration_token`.
- Registration token is single-use (`max_uses=1` default), tied to email, verified against DB.

### Waitlist (`/api/waitlist`)
| Method | Route | Purpose |
|---|---|---|
| POST | `/api/waitlist/join` | Submit email + marketing consent |
| GET | `/api/waitlist/confirm-email` | Confirm email and consent via token |
| GET | `/api/waitlist/status` | Check waitlist status by email/token |

Email flow:
1. Waitlist join -> send confirmation email.
2. Email confirmation -> status becomes `pending_admin_approval`.
3. Admin approval -> generate registration token and send registration email.

### Invitations (`/api/invitations`)
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/invitations` | List inviter's invitations + usage |
| POST | `/api/invitations` | Invite one or more emails (enforces quota + feature flag) |
| DELETE | `/api/invitations/:id` | Revoke pending invitation |

Behavior:
- Admin sets `invitations_enabled`, `invitation_quota_per_user`, and `invitation_waitlist_required`.
- If `invitation_waitlist_required=true`, invited users receive waitlist email.
- Else invited users receive direct registration email with single-use token.

### Admin (`/api/admin`)
Requires `role=admin`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/users` | List/search users |
| PATCH | `/api/admin/users/:id/activate` | Activate/reactivate user |
| PATCH | `/api/admin/users/:id/deactivate` | Deactivate user |
| POST | `/api/admin/users/:id/reset-password` | Trigger password reset email |
| GET | `/api/admin/waitlist` | List waitlist entries |
| PATCH | `/api/admin/waitlist/:id/approve` | Approve waitlist and send registration link |
| PATCH | `/api/admin/waitlist/:id/reject` | Reject waitlist entry |
| GET | `/api/admin/settings` | Read feature flags/policy |
| PATCH | `/api/admin/settings` | Update waitlist/invitation settings |

### Profile / Account Lifecycle (`/api/profile`)
| Method | Route | Purpose |
|---|---|---|
| POST | `/api/profile/reset-password/request` | Send password reset confirmation email |
| POST | `/api/profile/change-email/request` | Send email change confirmation |
| POST | `/api/profile/export-data/request` | Send data export confirmation |
| POST | `/api/profile/delete-account/request` | Send delete confirmation |
| POST | `/api/profile/reactivate/request` | Send reactivation confirmation |
| GET | `/api/profile/actions/confirm` | Confirm action via token |

Deletion lifecycle:
- Confirmed deletion sets user to `deactivated` and `deactivated_until = now() + interval '30 days'`.
- During the 30-day window: user can self-reactivate (email-confirmed) or admin can reactivate.
- After 30 days: background worker hard-deletes or anonymizes account data per retention policy.

### SSE Events (`/api/events`)
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/events/stream` | User-scoped SSE stream for chat updates + notifications |
| GET | `/api/events/replay` | Replay missed notifications since event id/timestamp |

Event types:
- `chat.item.updated`
- `chat.query.state`
- `notification.created`
- `admin.settings.updated`
- `account.status.changed`

SSE requirements:
- JWT-authenticated stream.
- Heartbeats every 15-30 seconds.
- `Last-Event-ID` support for reconnect.
- Per-user channel isolation.

### Existing domain endpoints
Retain and migrate:
- `/api/chat/*`
- `/api/query/*`
- `/api/files/*`
- `/api/llm/*`

---

## LLM Integration - Vercel AI SDK

Replaces provider-specific adapters from Amplify Lambda code.

Provider mapping:
- `anthropic` -> `@ai-sdk/anthropic`
- `openai` -> `@ai-sdk/openai`
- `xai` -> `@ai-sdk/xai`
- `ollama` -> `ollama-ai-provider`

Two-stage pipeline:
1. Conversation model with tool use.
2. Build123d code generation model.

Pipeline state transitions are published via SSE (`chat.query.state`) instead of polling.

---

## Build123d Rendering

Self-hosted in this repository under `services/build123d` and orchestrated by `docker-compose`.
- `docker-compose` runs `build123d` as `platform: linux/amd64` (required because native arm runtime is not supported).
- Backend calls local service URL (`http://build123d:80` in-container by default).
- No external Build123d endpoint is required for local/prod Docker deployments.
- POST `${BUILD123D_URL}/render/` with auth token.
- Parse success/error payloads.
- Store generated files on local mounted volume.
- Publish render progress and completion through SSE.

---

## File Storage

Local filesystem mounted at `/data/storage`:
- `modelcreator/{messageId}.b123d`
- `modelcreator/{messageId}.3mf`
- `modelcreator/{messageId}.step`
- `modelcreator/{messageId}.stl`
- `upload/*`

Served through `/api/files/*`.

---

## Frontend Migration

### Key replacements
| Current (Amplify) | New |
|---|---|
| GraphQL subscriptions / polling fallback | SSE via `EventSource` (`useSSE`) |
| `<Authenticator>` | `AuthProvider` + custom auth views |
| `generateClient<Schema>()` | REST client with JWT |
| Cognito account flows | Profile routes + email-confirmed actions |

### New product areas
- Admin panel for user management and feature flags.
- Waitlist entry + confirmation screens.
- Invitation manager in profile.
- Notification center fed by SSE events.

---

## Email Workflows (Mandatory Confirmation)

Every sensitive action sends a signed, single-use, expiring link:
- Waitlist email confirmation.
- Waitlist approval -> registration link.
- Invitation -> waitlist or registration link based on policy.
- Password reset.
- Email change confirmation.
- Data export request confirmation.
- Account deletion confirmation.
- Account reactivation confirmation.

Token handling:
- Store only token hash in DB.
- Enforce TTL and one-time consumption.
- Log audit trail for every consumed token.

---

## Docker Setup

### `docker-compose.yml` services
- `postgres` (PostgreSQL 16)
- `redis` (pub/sub + queue)
- `build123d` (FastAPI render service, forced `linux/amd64`)
- `backend` (Express API)
- `frontend` (nginx + built React)

### `.env.example` (minimum)
```
DB_PASSWORD=chat3d_dev
JWT_SECRET=change-this
BUILD123D_PORT=30222
BUILD123D_URL=http://build123d:80
BUILD123D_TOKEN=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
XAI_API_KEY=
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_TOKEN=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=no-reply@example.com
APP_BASE_URL=http://localhost
```

---

## Implementation Phases

### Order Sanity Check (Reviewed)

This plan still makes sense, with one ordering adjustment for lower risk: build the SSE/event spine early, before most product flows, so waitlist/admin/chat can all publish realtime updates from day one without retrofitting.

Revised build order:
1. Foundation and schema.
2. Auth and roles.
3. SSE and notification spine.
4. Waitlist + registration tokens.
5. Invitations + policy rules.
6. Admin APIs + admin panel.
7. Profile/account lifecycle flows.
8. Chat + file domain migration.
9. Query/LLM/rendering orchestration.
10. Hardening, cutover, decommission.

### Progress Tracking Rules

- Every subtask uses a stable ID (`M{milestone}.{subtask}`).
- Mark done by changing `[ ]` to `[x]`.
- Do not start a milestone until all dependencies are `[x]`.
- Each completed milestone must have evidence: PR/commit, test command, and demo note.

### Milestone Ledger

| Milestone | Status | Depends On | Evidence |
|---|---|---|---|
| M1 Foundation + Schema | Completed | - | `npm run m1:typecheck:workspaces`, `npm --workspace @chat3d/backend run build`, `docker-compose config -q`, `docker-compose up -d postgres redis backend frontend && docker-compose ps`, `npm run m1:backend:bootstrap`, Postgres validation queries for migrations/tables/admin/settings |
| M2 Auth + Roles | Completed | M1 | `npm --workspace @chat3d/backend run test`, `npm --workspace @chat3d/backend run build`, `npm --workspace @chat3d/frontend run test`, `npm --workspace @chat3d/frontend run typecheck`, `npm run m1:typecheck:workspaces` |
| M3 SSE + Notification Spine | Completed | M2 | `npm --workspace @chat3d/backend run test`, `npm --workspace @chat3d/backend run build`, `npm --workspace @chat3d/frontend run test`, `npm --workspace @chat3d/frontend run typecheck`, `npm run m1:typecheck:workspaces` |
| M4 Waitlist + Registration Tokens | Completed | M2, M3 | `npm --workspace @chat3d/backend run test`, `npm --workspace @chat3d/backend run build`, `npm --workspace @chat3d/frontend run test`, `npm --workspace @chat3d/frontend run typecheck`, `npm run m1:typecheck:workspaces` |
| M5 Invitations + Policy Controls | Not Started | M4 | - |
| M6 Admin APIs + Admin Panel | Not Started | M5 | - |
| M7 Profile + Account Lifecycle | Not Started | M6 | - |
| M8 Chat CRUD + Files Migration | Not Started | M2, M3 | - |
| M9 Query + LLM + Build123d Pipeline | Not Started | M8 | - |
| M10 Hardening + Cutover + Decommission | Not Started | M7, M9 | - |

### M1: Foundation + Schema

- Objective: runnable Docker baseline, migration framework, and initial schema.
- Subtasks:
- [x] M1.1 Create monorepo package structure and TypeScript workspace wiring.
- [x] M1.2 Add `docker-compose.yml` with `postgres`, `redis`, backend, frontend.
- [x] M1.3 Implement DB connection and migration runner.
- [x] M1.4 Add migration `001_initial_schema` for chat domain tables.
- [x] M1.5 Add migration `002_auth_admin_waitlist_invites` for users/settings/waitlist/invites/tokens.
- [x] M1.6 Add migration `003_notifications_account_lifecycle` for notifications/account actions.
- [x] M1.7 Seed initial admin user and default `app_settings`.
- Exit criteria:
- [x] M1.E1 `docker compose up` starts all base services.
- [x] M1.E2 Fresh DB bootstrap succeeds end-to-end.

### M2: Auth + Roles

- Objective: secure auth baseline with `admin` and `user` authorization.
- Subtasks:
- [x] M2.1 Implement password hashing and JWT issuance/verification.
- [x] M2.2 Add auth middleware and role guard middleware.
- [x] M2.3 Implement `/api/auth/register`, `/api/auth/login`, `/api/auth/me`.
- [x] M2.4 Enforce `users.status` checks (`active` only for login/use).
- [x] M2.5 Frontend auth context and route guards.
- Exit criteria:
- [x] M2.E1 Non-admins are blocked from admin routes.
- [x] M2.E2 Auth integration test suite passes.

### M3: SSE + Notification Spine

- Objective: no-polling realtime transport available to all later features.
- Subtasks:
- [x] M3.1 Implement `/api/events/stream` with JWT auth.
- [x] M3.2 Add heartbeat, reconnect support, and `Last-Event-ID`.
- [x] M3.3 Add `notifications` persistence and replay endpoint.
- [x] M3.4 Implement backend event publisher abstraction (`notification.service`, `sse.service`).
- [x] M3.5 Implement frontend `useSSE` + notification context.
- Exit criteria:
- [x] M3.E1 Realtime event delivery verified for authenticated user.
- [x] M3.E2 Reconnect/replay behavior verified.

### M4: Waitlist + Registration Tokens

- Objective: waitlist gate and approval flow with email confirmation.
- Subtasks:
- [x] M4.1 Implement `/api/waitlist/join` with marketing consent capture.
- [x] M4.2 Implement waitlist email confirmation token flow.
- [x] M4.3 Implement admin approve/reject endpoints for waitlist entries.
- [x] M4.4 Generate single-use registration tokens tied to email.
- [x] M4.5 Enforce registration token validation in `/api/auth/register` when waitlist is enabled.
- [x] M4.6 Send approval email with registration link token.
- Exit criteria:
- [x] M4.E1 Waitlisted user cannot register before admin approval.
- [x] M4.E2 Approved user can register exactly once with token.

### M5: Invitations + Policy Controls

- Objective: user invitations with admin-defined quota and waitlist behavior.
- Subtasks:
- [ ] M5.1 Implement `/api/invitations` CRUD for inviter users.
- [ ] M5.2 Enforce `invitations_enabled` gate and per-user quota.
- [ ] M5.3 Implement invite path switch: direct registration or waitlist (`invitation_waitlist_required`).
- [ ] M5.4 Add invitation email templates and token issuance where applicable.
- [ ] M5.5 Add SSE notifications for invitation lifecycle changes.
- Exit criteria:
- [ ] M5.E1 Quota and feature flag behavior verified by integration tests.
- [ ] M5.E2 Invited user receives correct email flow in both policy modes.

### M6: Admin APIs + Admin Panel

- Objective: full admin control plane for users, waitlist, and settings.
- Subtasks:
- [ ] M6.1 Implement `/api/admin/users` list/search.
- [ ] M6.2 Implement activate/deactivate and admin-triggered password reset.
- [ ] M6.3 Implement `/api/admin/settings` read/update endpoints.
- [ ] M6.4 Build admin frontend page with users, waitlist moderation, and settings toggles.
- [ ] M6.5 Emit SSE events on admin setting changes and account status changes.
- Exit criteria:
- [ ] M6.E1 Admin can fully manage waitlist and invitation policies from UI.
- [ ] M6.E2 User activation/deactivation path works and is audited.

### M7: Profile + Account Lifecycle

- Objective: self-service account actions with email-confirmed security.
- Subtasks:
- [ ] M7.1 Implement request endpoints for password reset, email change, data export, account delete, account reactivate.
- [ ] M7.2 Implement token confirmation endpoint for all account actions.
- [ ] M7.3 Implement `deactivated` + `deactivated_until` (30-day window) behavior.
- [ ] M7.4 Add worker for post-window delete/anonymize policy.
- [ ] M7.5 Build profile UI for all lifecycle actions.
- Exit criteria:
- [ ] M7.E1 Account deletion enters deactivated state for 30 days.
- [ ] M7.E2 User/admin reactivation works during grace period.

### M8: Chat CRUD + Files Migration

- Objective: migrate core chat and file features off Amplify.
- Subtasks:
- [ ] M8.1 Implement chat context/item REST endpoints with ownership checks.
- [ ] M8.2 Implement file upload/download/delete endpoints over local storage.
- [ ] M8.3 Migrate frontend chat pages/components to REST APIs.
- [ ] M8.4 Replace Amplify storage integrations with `/api/files/*`.
- [ ] M8.5 Publish chat update events over SSE (`chat.item.updated`).
- Exit criteria:
- [ ] M8.E1 End-to-end chat CRUD works without Amplify.
- [ ] M8.E2 File upload and model file download verified.

### M9: Query + LLM + Build123d Pipeline

- Objective: restore AI query flow and model rendering with SSE progress updates.
- Subtasks:
- [ ] M9.1 Implement LLM model registry and provider clients via Vercel AI SDK.
- [ ] M9.2 Port two-stage orchestration (conversation + Build123d code generation).
- [ ] M9.3 Integrate Build123d service render call and store outputs.
- [ ] M9.4 Emit query/render lifecycle events (`chat.query.state`) through SSE.
- [ ] M9.5 Migrate frontend query submit flow to SSE-driven state updates.
- Exit criteria:
- [ ] M9.E1 Query produces rendered files and assistant response.
- [ ] M9.E2 No polling codepath remains in chat realtime UX.

### M10: Hardening + Cutover + Decommission

- Objective: production readiness and complete Amplify removal.
- Subtasks:
- [ ] M10.1 Add request validation, rate limits, audit logs, and abuse controls.
- [ ] M10.2 Finalize CORS, auth token handling, and security headers.
- [ ] M10.3 Add health/readiness checks and operational runbooks.
- [ ] M10.4 Remove Amplify runtime dependencies and obsolete integration code.
- [ ] M10.5 Update README and deployment docs for Docker-only operation.
- Exit criteria:
- [ ] M10.E1 Full regression checklist passes in Docker.
- [ ] M10.E2 Amplify is not required for runtime behavior.

---

## Key Design Decisions

1. SSE over polling for dynamic updates, messaging state, and notifications.
2. Centralized feature flags in `app_settings` so admin policy changes are immediate and auditable.
3. One-time hashed tokens for registration and all email-confirmed account actions.
4. Soft deactivation + 30-day delayed deletion window for account recovery and admin intervention.
5. Redis-backed event fanout and queueing to support multi-instance backend scaling.
6. Local storage first, with clear abstraction to switch to object storage later.

---

## Critical Source Files to Reference During Implementation

| File | What to extract |
|---|---|
| `amplify/functions/submitqueryfunction/handler.ts` | Two-stage LLM orchestration and tool flow |
| `amplify/functions/submitqueryfunction/LLMDefinitions.ts` | Model configs and prompts |
| `amplify/functions/submitqueryfunction/Build123dRenderingProvider.ts` | Rendering call pattern and response handling |
| `amplify/functions/submitqueryfunction/Helpers.ts` | XML/document section parsing helpers |
| `amplify/functions/submitqueryfunction/Build123dExamples.ts` | Build123d examples |
| `amplify/functions/submitqueryfunction/StaticDocuments.ts` | Static docs used for prompting |
| `amplify/functions/submitqueryfunction/RetryUtils.ts` | Retry/backoff behavior |
| `amplify/data/resource.ts` | Chat data model shape |
| `amplify/auth/pre-sign-up/handler.ts` | Registration gating patterns to port |
| `amplify/auth/post-confirmation/handler.ts` | Post-registration hooks to replace |
| `src/Pages/Chat.tsx` | Frontend chat state transitions and actions |
| `src/Components/ChatMessageAI.tsx` | Chat rendering and model output display |
| `src/Components/ModelViewer.tsx` | 3D model viewer behavior |
| `src/Components/ChatContextComponent.tsx` | Context CRUD UX behavior |
