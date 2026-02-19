# Legacy Archive

This directory contains archived AWS Amplify-era sources and assets retained only for migration reference.

Scope:
- `legacy/amplify/`: archived Amplify backend definitions, auth triggers, and Lambda handlers.
- `legacy/src/`: archived legacy frontend implementation.
- `legacy/public/`: archived legacy static assets.
- `legacy/index.html`, `legacy/vite.config.ts`, `legacy/tsconfig*.json`, `legacy/amplify.yml`: archived legacy build/config files.

Policy:
- Active runtime ownership is `packages/backend` and `packages/frontend`.
- Do not add new runtime features under `legacy/`.
- Do not add new dependencies to support `legacy/` in default install/build/test workflows.
