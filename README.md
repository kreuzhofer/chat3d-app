# Chat3D (Docker Stack)

Chat3D now runs as a Dockerized stack (PostgreSQL, Redis, backend API, frontend, build123d service).  
AWS Amplify is no longer required for runtime behavior.

## Stack

- Backend: Express + PostgreSQL (`/packages/backend`)
- Frontend package: React + TypeScript (`/packages/frontend`)
- Realtime: SSE (`/api/events/stream`)
- Rendering: local build123d container (`/services/build123d`) running as `linux/amd64`

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

## Notes

- Legacy Amplify code remains in `amplify/` as migration reference only.
- Active product runtime is the Docker stack and `/packages/*` services.
