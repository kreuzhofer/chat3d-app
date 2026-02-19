# Chat3D (Docker Stack)

Chat3D runs as a Dockerized stack (PostgreSQL, Redis, backend API, frontend, build123d service, scheduled account-deletion worker).

## Stack

- Backend: Express + PostgreSQL (`/packages/backend`)
- Frontend package: React + TypeScript (`/packages/frontend`)
- Realtime: SSE (`/api/events/stream`)
- Rendering: local build123d container (`/services/build123d`) running as `linux/amd64`
- Lifecycle worker: `account-deletion-worker` sweeps expired deactivated accounts on a schedule

## Prerequisites

- Docker + Docker Compose
- Node.js 20+
- npm

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.template .env
```

3. Start the full stack:
```bash
docker compose up --build
```

`build123d` is internal-only by default (reachable from backend as `http://build123d:80`).
If you need direct host access for debugging, start with the debug override:
```bash
docker compose -f docker-compose.yml -f docker-compose.build123d-debug.yml up --build
```

4. Bootstrap DB (migrations + seed):
```bash
npm --workspace @chat3d/backend run db:bootstrap
```

## Validation Commands

- Backend tests: `npm --workspace @chat3d/backend run test`
- Backend build: `npm --workspace @chat3d/backend run build`
- Frontend tests: `npm --workspace @chat3d/frontend run test`
- Frontend typecheck: `npm --workspace @chat3d/frontend run typecheck`
- Workspace typecheck: `npm run m1:typecheck:workspaces`

## Operations

- Health: `GET /health`
- Readiness: `GET /ready`
- Account deletion worker:
```bash
npm --workspace @chat3d/backend run worker:account-deletion
```

Detailed operational procedures are documented in:
- `docs/operations-runbook.md`

Worker schedule controls:
- `ACCOUNT_DELETION_SWEEP_INTERVAL_SECONDS` (default `3600`)
- `ACCOUNT_DELETION_SWEEP_LIMIT` (default `100`)

## Notes

- Active runtime ownership is `packages/*`; default install/build/test workflows target the Docker stack runtime.
- `npm run guard:active-runtime` enforces no deprecated runtime integrations in active packages.
- Active product runtime is the Docker stack and `/packages/*` services.
