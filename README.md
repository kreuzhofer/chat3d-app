# Chat3D

**Build 3D models with natural language.**

Chat3D is an AI-powered prompt-to-CAD workspace. Describe a part in plain English, and Chat3D generates production-ready 3D models (STL, STEP, 3MF) using a two-stage LLM pipeline and [Build123d](https://github.com/gumyr/build123d) under the hood. Preview results in-browser, iterate through conversation, and download files when ready.

## What It Does

1. **Describe your part** -- Open a chat context and tell Chat3D what you need: "Design a spur gear with 20 teeth and a 5mm bore."
2. **Generate & review** -- A conversation LLM interprets your intent, then a code-generation LLM produces Build123d Python code. The code is executed by a rendering service that returns solid geometry.
3. **Preview & iterate** -- View the 3D model directly in the browser (Three.js), download STL/STEP/3MF files, rate results, and regenerate until the part is production-ready.

## Three-Pane Workspace

The UI is organized into three persistent panes so you never lose context:

| Contexts | Thread | 3D Preview |
|----------|--------|------------|
| All your chat contexts in one sidebar. Switch between projects instantly. | The full conversation with generated code, output files, and download links. | Interactive 3D preview powered by Three.js. Rotate, zoom, and inspect geometry in real time. |

## Key Features

- **Conversational modeling** -- Describe parts in natural language. The LLM pipeline handles intent detection, code generation, and rendering automatically.
- **Multi-format export** -- Download models as STL, STEP, 3MF, or raw Build123d Python source.
- **In-browser 3D preview** -- Inspect generated geometry with Three.js without leaving the app.
- **Multi-provider LLM support** -- Use OpenAI, Anthropic, xAI (Grok), or a local Ollama instance. Configure conversation and code-generation models independently.
- **Self-hosted** -- Runs entirely on your own infrastructure via Docker Compose. No data leaves your network unless you choose a cloud LLM provider.
- **Admin & governance** -- Waitlist mode, invitation controls, user management, and policy-based administration built in.
- **Real-time updates** -- Server-Sent Events (SSE) push notifications and model generation progress to the browser.
- **Dark mode** -- Full light and dark theme support across all pages.

## Architecture

```
Browser (React + Three.js)
    |
    | REST API + SSE
    v
Express API Server
    |
    |-- PostgreSQL 16 (users, chat contexts, chat items)
    |-- Redis 7 (SSE event bus)
    |-- LLM providers (OpenAI / Anthropic / xAI / Ollama)
    |
    v
Build123d Rendering Service (Python, linux/amd64)
    |
    v
STL / STEP / 3MF files
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Three.js |
| Backend | Express, TypeScript, Knex (PostgreSQL) |
| LLM abstraction | Vercel AI SDK (OpenAI, Anthropic, xAI, Ollama) |
| 3D rendering | Build123d (Python, containerized) |
| Real-time | Server-Sent Events via Redis pub/sub |
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
cp .env.template .env
```

Edit `.env` and set your LLM API keys and other configuration. See [Environment Variables](#environment-variables) below.

### 3. Start the stack

```bash
docker compose up --build
```

This starts PostgreSQL, Redis, the Build123d rendering service, the backend API, and the frontend (nginx).

### 4. Bootstrap the database

```bash
npm --workspace @chat3d/backend run db:bootstrap
```

### 5. Open the app

Navigate to [http://localhost](http://localhost). A default admin account is created from the `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` env vars.

## Environment Variables

Copy `.env.template` to `.env` and configure:

| Variable | Purpose |
|----------|---------|
| `DB_PASSWORD` | PostgreSQL password |
| `JWT_SECRET` | Secret key for JWT signing |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `XAI_API_KEY` | xAI (Grok) API key |
| `OLLAMA_BASE_URL` | Ollama server URL (default: `http://host.docker.internal:11434`) |
| `QUERY_CONVERSATION_PROVIDER` | LLM provider for conversation (`openai`, `anthropic`, `xai`, `ollama`) |
| `QUERY_CONVERSATION_MODEL` | Model name for conversation (e.g. `gpt-4o-mini`) |
| `QUERY_CODEGEN_PROVIDER` | LLM provider for code generation |
| `QUERY_CODEGEN_MODEL` | Model name for code generation (e.g. `gpt-5.2-codex`) |
| `SEED_ADMIN_EMAIL` | Admin account email created on first bootstrap |
| `SEED_ADMIN_PASSWORD` | Admin account password |
| `BUILD123D_URL` | Build123d service URL (default: `http://build123d:80`) |

See `.env.template` for the full list including SMTP, Redis, and worker configuration.

## Docker Services

| Service | Purpose | Port |
|---------|---------|------|
| `postgres` | PostgreSQL 16 database | 5432 |
| `redis` | SSE event bus | 6379 |
| `build123d` | Build123d Python rendering service | internal |
| `backend` | Express API server | 3001 |
| `frontend` | React SPA served via nginx | 80 |
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
    shared/        # Shared TypeScript types
    backend/       # Express API server
    frontend/      # React SPA (Vite + Tailwind)
  services/
    build123d/     # Build123d rendering container
  docker-compose.yml
```

## API

All routes (except auth) require `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login (returns JWT) |
| `GET` | `/api/auth/me` | Current user profile |
| `GET` | `/api/chat/contexts` | List chat contexts |
| `POST` | `/api/chat/contexts` | Create chat context |
| `DELETE` | `/api/chat/contexts/:id` | Delete context + items + files |
| `GET` | `/api/chat/contexts/:id/items` | Get chat items for a context |
| `POST` | `/api/query/submit` | Submit a modeling query (async) |
| `GET` | `/api/files/:path` | Download a generated file |
| `GET` | `/api/llm/models` | List available LLM models |
| `GET` | `/health` | Health check |
| `GET` | `/ready` | Readiness check |

## License

All rights reserved.
