# Chat3D

**Build 3D models with natural language.**

Chat3D is an AI-powered prompt-to-CAD workspace. Describe a part in plain English, and Chat3D generates production-ready 3D models (STL, STEP, 3MF) using an agent-based LLM pipeline and [Build123d](https://github.com/gumyr/build123d) under the hood. Preview results in-browser, iterate through conversation, and download files when ready.

## What It Does

1. **Describe your part** -- Open a chat context and tell Chat3D what you need: "Design a spur gear with 20 teeth and a 5mm bore."
2. **Generate & review** -- A conversation LLM interprets your intent, then an agent-based code-generation pipeline produces Build123d Python code via multi-step reasoning with spec generation, technique research, and automated evaluation. The code is executed by a rendering service that returns solid geometry.
3. **Preview & iterate** -- View the 3D model directly in the browser (Three.js), download STL/STEP/3MF files, rate results, tweak parameters, and regenerate until the part is production-ready.

## Three-Pane Workspace

The UI is organized into three persistent panes so you never lose context:

| Contexts | Thread | 3D Preview |
|----------|--------|------------|
| All your chat contexts in one sidebar. Switch between projects instantly. | The full conversation with generated code, output files, and download links. | Interactive 3D preview powered by Three.js. Rotate, zoom, and inspect geometry in real time. |

## Key Features

- **Conversational modeling** -- Describe parts in natural language. The agent-based pipeline handles intent detection, spec generation, technique research, code generation, validation, and multi-track evaluation automatically.
- **Multi-format export** -- Download models as STL, STEP, 3MF, or raw Build123d Python source.
- **In-browser 3D preview** -- Inspect generated geometry with Three.js without leaving the app. Auto-turntable, fullscreen, and camera controls included.
- **Multi-provider LLM support** -- Use OpenAI, Anthropic, xAI (Grok), DeepSeek, Amazon Bedrock, Minimax, or a local Ollama instance. Configure conversation, code-generation, evaluation, and embedding models independently via the Admin UI.
- **Public gallery** -- Browse and search approved models by category. Remix gallery models into new chat conversations to use as a starting point.
- **Workbench** -- Admin tooling for curating a prompt library with automated batch generation, VLM-based evaluation, auto-approval workflows, and training data export (JSONL).
- **Experiments** -- A/B test different LLM models on curated workbench prompts. Compare eval scores, cost, and generation quality side-by-side.
- **Knowledge base** -- Crawl and index Build123d documentation, examples, and forums. Semantic search (pgvector) feeds relevant technique examples into the generation pipeline.
- **Curation pipeline** -- User-rated chat items surface as curation candidates. Admins review, distill prompts, tag, and promote to the workbench library.
- **Multi-track evaluation** -- Generated models are scored via code assertions, LLM code review, and VLM visual evaluation (with zoom follow-ups for uncertain items). Scores combine adaptively.
- **Usage analytics** -- Track token consumption, cost, and latency per user, model, provider, and purpose. Pipeline performance dashboards show generation throughput and phase timing.
- **Self-hosted** -- Runs entirely on your own infrastructure via Docker Compose. No data leaves your network unless you choose a cloud LLM provider.
- **Admin & governance** -- Waitlist mode, invitation controls, user management, audit logging, and policy-based administration built in.
- **Real-time updates** -- Server-Sent Events (SSE) push generation progress, notifications, and admin events to the browser. Optional Web Push notifications.
- **Internationalization** -- Multi-language support via i18next.
- **Dark theme** -- Purpose-built dark UI with emerald accent colors.

## Architecture

```
Browser (React + Three.js + Tailwind)
    |
    | REST API + SSE
    v
Express API Server
    |
    |-- PostgreSQL 16 + pgvector (users, chats, workbench, knowledge, experiments)
    |-- Redis 7 (SSE event bus, notifications)
    |-- LLM providers (OpenAI / Anthropic / xAI / DeepSeek / Bedrock / Minimax / Ollama)
    |
    |-- Build123d Rendering Service (Python, 2 replicas)
    |       |-> STL / STEP / 3MF files
    |
    |-- Screenshot Service (Pyrender, 2 replicas)
            |-> Multi-angle screenshots for VLM evaluation
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, Three.js, Recharts, i18next |
| Backend | Express, TypeScript, Prisma (PostgreSQL 16 + pgvector) |
| LLM abstraction | Vercel AI SDK (OpenAI, Anthropic, xAI, DeepSeek, Amazon Bedrock, Minimax, Ollama) |
| 3D rendering | Build123d (Python, containerized, 2 replicas) |
| Screenshots | Pyrender-based STL screenshot service (containerized, 2 replicas) |
| Vector search | pgvector with HNSW indexes for embeddings |
| Job queue | pg-boss (knowledge pipeline), in-memory queue (workbench batching) |
| Real-time | Server-Sent Events via Redis pub/sub + Web Push (VAPID) |
| Auth | JWT + bcrypt |
| Infrastructure | Docker Compose |

## Quick Start

### Prerequisites

- Docker + Docker Compose
- Node.js 20+
- An API key for at least one LLM provider (OpenAI, Anthropic, xAI) or a running Ollama instance

### 1. Clone and install

```bash
git clone https://github.com/kreuzhofer/chat3d-app.git
cd chat3d-app
npm install
```

### 2. Configure environment

```bash
cp example.env .env
```

Edit `.env` and set your LLM API keys and other configuration. See [Environment Variables](#environment-variables) below.

### 3. Start the stack

```bash
docker compose up --build
```

This starts PostgreSQL, Redis, the Build123d rendering service, the backend API, and the frontend (nginx).

### 4. Open the app

Navigate to [http://localhost](http://localhost). On first launch, a setup wizard will guide you through creating the admin account.

## Environment Variables

Copy `example.env` to `.env` and configure:

| Variable | Purpose |
|----------|---------|
| `DB_PASSWORD` | PostgreSQL password |
| `JWT_SECRET` | Secret key for JWT signing |
| `BUILD123D_URL` | Build123d service URL (default: `http://build123d:80`) |
| `SCREENSHOT_SERVICE_URL` | Screenshot service URL (default: `http://screenshot-service:80`) |
| `QUERY_RENDER_MODE` | `live` (default) or `mock` — controls real vs stubbed 3D rendering |
| `QUERY_LLM_MODE` | `live` (default) or `mock` — controls real vs stubbed LLM calls |
| `FRONTEND_PORT` | Host port for the frontend (default: `80`) |
| `LOG_LEVEL` | Logging level: `fatal`, `error`, `warn`, `info` (default), `debug`, `trace`, `silent` |
| `LOG_FORMAT` | Log output format: `json` (default in Docker) or `pretty` (human-readable) |

> **LLM Provider Configuration:** API keys, endpoint URLs, model assignments, and purpose mappings are all managed via the **Admin UI → Providers tab**, not environment variables.

See `example.env` for the full list including SMTP, Redis, concurrency, security, and worker configuration.

## Docker Services

| Service | Purpose | Port |
|---------|---------|------|
| `postgres` | PostgreSQL 16 database (pgvector) | 5432 |
| `redis` | SSE event bus | 6379 |
| `build123d` | Build123d Python rendering service (2 replicas) | internal |
| `screenshot-service` | Pyrender STL screenshot service (2 replicas) | internal |
| `backend` | Express API server (proxied via nginx, not exposed to host) | internal |
| `frontend` | React SPA + API reverse proxy (nginx) | 80 |
| `account-deletion-worker` | Scheduled cleanup of deactivated accounts | -- |

## Development

```bash
# Run backend in dev mode (requires postgres + redis running)
cd packages/backend && npm run dev

# Run frontend in dev mode
cd packages/frontend && npm run dev

# Run backend tests
npm --workspace @chat3d/backend run test

# Run frontend tests
npm --workspace @chat3d/frontend run test

# Typecheck
npm --workspace @chat3d/frontend run typecheck
```

For selective Docker rebuilds during development:

```bash
# Rebuild only the frontend
docker compose build frontend && docker compose up -d frontend

# Rebuild only the backend
docker compose build backend && docker compose up -d backend
```

## Project Structure

```
chat3d-app/
  packages/
    shared/              # Shared TypeScript types (events, traces, domain models)
    backend/             # Express API server (Prisma, 85+ service files)
      prisma/            # Schema + migrations
      src/
        routes/          # 17 route files
        services/        # Business logic (pipeline, eval, workbench, experiments, ...)
    frontend/            # React SPA (Vite + Tailwind)
      src/
        components/      # 70+ components (chat, admin, gallery, workbench, UI primitives)
        hooks/           # 12 custom hooks (SSE, streaming, scroll, pull-to-refresh)
        api/             # 14 API client modules
  services/
    build123d/           # Build123d rendering container
    screenshot-service/  # Pyrender STL screenshot container
  workbench/             # Seed data for workbench categories and prompts
  docker-compose.yml
```

## API

All routes (except auth, setup, waitlist, and public) require `Authorization: Bearer <token>`. Admin routes require the `admin` role. 230+ endpoints total across 17 route files.

### Core

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/setup/init` | Initial setup (creates first admin) |
| `POST` | `/api/auth/login` | Login (returns JWT) |
| `POST` | `/api/auth/register` | Create account |
| `GET` | `/api/auth/me` | Current user profile |
| `GET` | `/api/chat/contexts` | List chat contexts |
| `POST` | `/api/chat/contexts` | Create chat context |
| `GET` | `/api/chat/contexts/:id/items` | Get chat items |
| `POST` | `/api/query/submit` | Submit a modeling query (async) |
| `POST` | `/api/query/regenerate` | Regenerate a previous response |
| `POST` | `/api/query/stop` | Stop a running query |
| `POST` | `/api/query/re-render` | Re-render with tweaked parameters |
| `GET` | `/api/events/stream` | SSE event stream (real-time updates) |
| `GET/POST` | `/api/files/*` | File upload, download, delete |
| `POST` | `/api/profile/*` | Account management (password, email, delete, export) |
| `GET` | `/api/llm/models` | List available LLM models |
| `GET` | `/health` | Health check |
| `GET` | `/ready` | Readiness check |

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/public/config` | Public app configuration |
| `GET` | `/api/public/gallery/categories` | List gallery categories |
| `GET` | `/api/public/gallery/categories/:id/models` | List models in category |
| `GET` | `/api/public/gallery/models/:id` | Model detail |
| `GET` | `/api/public/gallery/search` | Search gallery models |
| `GET` | `/api/public/gallery/models/:id/screenshot/:angle` | Model screenshot |
| `GET` | `/api/public/gallery/models/:id/download/:format` | Download model (stl/3mf/step/b123d) |
| `POST` | `/api/gallery/remix` | Remix a gallery model into a new chat |
| `POST` | `/api/waitlist/join` | Join the waitlist |

### Admin (admin role required)

| Group | Endpoints | Description |
|-------|-----------|-------------|
| Users | `GET/PATCH/DELETE /api/admin/users/*` | User management, activation, password reset |
| Waitlist | `GET/PATCH/DELETE /api/admin/waitlist/*` | Waitlist approvals and management |
| Settings | `GET/PATCH /api/admin/settings` | App-level configuration (waitlist, invitations) |
| LLM Providers | `CRUD /api/admin/llm-providers/*` | Provider configuration (API keys, endpoints) |
| LLM Models | `CRUD /api/admin/llm-models/*` | Model registration and capabilities |
| LLM Purposes | `GET/PATCH /api/admin/llm-purposes/*` | Purpose-to-model assignments |
| Generation Settings | `GET/PATCH/DELETE /api/admin/generation-settings/*` | Pipeline tuning knobs |
| Curation | `GET/PATCH/POST /api/admin/curation/*` | Candidate review, distillation, tagging, approval |
| Usage Analytics | `GET /api/admin/usage/*` | Token/cost analytics (summary, timeseries, export) |
| Pipeline Analytics | `GET /api/admin/pipeline/*` | Generation performance metrics and breakdowns |
| Workbench | `CRUD /api/admin/workbench/*` | Categories, prompts, examples, batch generation, embeddings, export/import |
| Experiments | `CRUD /api/admin/experiments/*` | Create, run, compare LLM model experiments |
| Backups | `GET/DELETE /api/admin/backups/*` | Database backup management |

## License

All rights reserved.
