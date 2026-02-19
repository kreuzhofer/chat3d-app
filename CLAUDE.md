# Chat3D — Project Guide

## Overview

Chat3D is an AI-powered 3D CAD modeling application. Users create 3D models via natural language chat. The app uses a two-stage LLM pipeline: a conversation LLM decides if a 3D model is needed (via tool_use), then a code-generation LLM produces Build123d Python code, which is rendered by an external service.

## Architecture

- **Frontend:** React 18 + TypeScript + Vite, served via nginx in Docker
- **Backend:** Express + TypeScript API in Docker
- **Database:** PostgreSQL 16 (Docker service)
- **File Storage:** Local filesystem mounted as Docker volume at `/data/storage`
- **LLM Providers:** Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/xai`, `ollama-ai-provider`)
- **3D Rendering:** External Build123d service via REST API (POST `/render/`)
- **Auth:** JWT with bcrypt password hashing (email/password)
- **Orchestration:** docker-compose.yml

## Project Structure

Monorepo with three packages:
- `packages/shared/` — Shared TypeScript types (IChatMessage, ChatContext, ChatItem, User)
- `packages/backend/` — Express API server (port 3001)
- `packages/frontend/` — React SPA (nginx on port 80, proxies `/api/` to backend)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18 + TypeScript |
| Frontend build | Vite |
| Frontend UI | semantic-ui-react |
| 3D rendering (browser) | Three.js with ThreeMFLoader |
| Backend framework | Express + TypeScript |
| Database | PostgreSQL 16 with knex (migrations + query builder) |
| Auth | bcrypt + jsonwebtoken (JWT) |
| LLM abstraction | Vercel AI SDK |
| 3D model generation | Build123d (external Docker service) |
| Container runtime | Docker + Docker Compose |

## Build & Run

```bash
# Start all services
docker compose up --build

# Start only PostgreSQL (for local backend dev)
docker compose up postgres

# Run backend in dev mode (outside Docker)
cd packages/backend && npm run dev

# Run frontend in dev mode (outside Docker)
cd packages/frontend && npm run dev

# Run database migrations
cd packages/backend && npx knex migrate:latest
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Purpose |
|----------|---------|
| `DB_PASSWORD` | PostgreSQL password |
| `JWT_SECRET` | Secret key for JWT signing |
| `BUILD123D_URL` | URL of the Build123d rendering service |
| `BUILD123D_TOKEN` | Auth token for Build123d service |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `XAI_API_KEY` | xAI (Grok) API key |
| `OLLAMA_BASE_URL` | Ollama server URL (default: `http://host.docker.internal:11434`) |
| `OLLAMA_TOKEN` | Auth bearer token for Ollama server (if required) |

## API Routes

- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Login, returns JWT
- `GET /api/auth/me` — Current user profile
- `GET /api/chat/contexts` — List chat contexts
- `POST /api/chat/contexts` — Create chat context
- `PATCH /api/chat/contexts/:id` — Update chat context
- `DELETE /api/chat/contexts/:id` — Delete chat context + items + files
- `GET /api/chat/contexts/:id/items` — Get chat items
- `POST /api/chat/items` — Create chat item
- `PATCH /api/chat/items/:id` — Update chat item (messages, rating)
- `POST /api/query/submit` — Submit query (fire-and-forget, async processing)
- `POST /api/query/name-chat` — Generate chat name via LLM
- `GET /api/files/:path` — Serve stored file
- `POST /api/files/upload` — Upload file
- `GET /api/llm/models` — List available LLM configurations

## Key Patterns

- **Fire-and-forget queries:** `POST /api/query/submit` returns immediately. Backend processes async. Frontend polls for chat item updates.
- **Two-stage LLM pipeline:** Conversation LLM with tool_use decides intent → Build123d code generator LLM produces Python code → external service renders to .3mf/.step/.stl.
- **JWT auth middleware:** All routes except `/api/auth/register` and `/api/auth/login` require `Authorization: Bearer <token>` header.
- **Owner-scoped data:** All chat contexts and items are scoped to the authenticated user via `owner_id`.

## Database

PostgreSQL with three tables:
- `users` — id (UUID), email, password_hash, display_name, timestamps
- `chat_contexts` — id (UUID), name, model IDs, owner_id (FK→users), timestamps
- `chat_items` — id (UUID), chat_context_id (FK→chat_contexts), role, messages (JSONB), rating, owner_id, timestamps

## File Storage Layout

Files stored at `/data/storage` (Docker volume):
- `modelcreator/{messageId}.b123d` — Build123d source code
- `modelcreator/{messageId}.3mf` — 3D Manufacturing Format
- `modelcreator/{messageId}.step` — STEP CAD format
- `modelcreator/{messageId}.stl` — STL format
- `upload/` — User-uploaded files

## Docker Services

| Service | Image | Port | Depends On |
|---------|-------|------|-----------|
| postgres | postgres:16-alpine | 5432 | — |
| backend | Custom (Node 20 Alpine) | 3001 | postgres |
| frontend | Custom (nginx Alpine) | 80 | backend |

## Coding Conventions

- TypeScript strict mode in all packages
- Shared types in `packages/shared` — import from there, never duplicate type definitions
- Backend services layer: routes → services → database (no direct DB access from routes)
- Use Vercel AI SDK `generateText()` for all LLM calls — never call provider APIs directly
- Use knex for all database queries and migrations
- Frontend API calls go through `src/api/client.ts` fetch wrapper (handles JWT, error handling)
- Frontend auth state managed via React Context (`AuthContext`)
- Frontend real-time updates via polling hooks (not WebSockets)
- All architecture diagrams must use Mermaid notation

## Development Principles

1. **Test-Driven Development**: Write or update tests first. Do not claim completion unless tests run and pass, or explicitly state why they could not be run.

2. **Small, Reversible, Observable Changes**: Prefer small diffs and scoped changes. Implement user-testable and visible changes before backend changes wherever feasible. Keep changes reversible where possible. Maintain separation of concerns; avoid mixing orchestration, domain logic, and IO unless trivial.

3. **Fail Fast, No Silent Fallbacks**: Validate inputs at boundaries. Surface errors early and explicitly. Assume dependencies may fail. No silent fallbacks or hidden degradation. Any fallback must be explicit, tested, and observable.

4. **Minimize Complexity (YAGNI, No Premature Optimization)**: Implement the simplest solution that meets current requirements and tests. Do not design for speculative future use cases. Optimize only with evidence.

5. **Deliberate Trade-offs: Reusability vs. Fit (DRY with Restraint)**: Apply DRY only to real, stable duplication. Avoid abstractions that increase cognitive load without clear benefit. Prefer fit-for-purpose code unless a second use case is concrete.

6. **Don't Assume—Ask for Clarification**: If requirements are ambiguous or multiple interpretations exist, ask. If proceeding is necessary, state assumptions explicitly and keep changes localized and reversible.

7. **Confidence-Gated Autonomy**: Proceed end-to-end only when confidence is high. Narrow scope and increase checks when confidence is medium. Stop and ask when confidence is low.

8. **Security-by-Default**: Treat all external input as untrusted. Use safe defaults and least privilege. Do not weaken auth, authz, crypto, or injection defenses without explicit instruction. Never introduce secrets into code.

9. **Don't Break Contracts**: Preserve existing public APIs, schemas, and behavioral contracts unless explicitly instructed otherwise. If breaking changes are required, provide migration steps and compatibility tests.

10. **Risk-Scaled Rigor**: Scale rigor with impact: (1) Low risk — unit tests, lint/format. (2) Medium risk — integration tests, edge cases, rollback awareness. (3) High risk (security, auth, money, data loss, core flows) — explicit approval before destructive actions, targeted tests, minimal refactoring.