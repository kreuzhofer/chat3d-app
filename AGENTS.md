# Repository Guidelines

## Project Structure & Module Organization
This repo is a React + Vite + TypeScript frontend with an AWS Amplify backend.

- `src/`: app code.
- `src/Pages/`: route-level screens (`Chat.tsx`, `Profile.tsx`).
- `src/Components/`: reusable UI and 3D/chat components.
- `public/`: static assets (icons, images, mock HTML).
- `amplify/`: backend definitions, auth triggers, and Lambda handlers (for chat submission, Patreon flows, etc.).
- `dist/`: production build output (generated).

Keep new UI logic in `src/`, and backend cloud logic in `amplify/functions/` or `amplify/auth/`.

## Build, Test, and Development Commands
- `npm install`: install frontend dependencies.
- `npm run dev`: start local Vite dev server.
- `npm run build`: type-check (`tsc`) and build production bundle.
- `npm run preview`: serve the built bundle locally.
- `npm run lint`: run ESLint for `.ts`/`.tsx`.
- `npx dotenvx run npx ampx sandbox`: start/update Amplify sandbox using `.env`.

Run `npm run lint && npm run build` before opening a PR.

## Coding Style & Naming Conventions
- Language: TypeScript (`strict` mode enabled in `tsconfig.json`).
- Components/pages: PascalCase filenames and exports (`ChatMessageAI.tsx`).
- Variables/functions: camelCase.
- Prefer functional React components and typed props/interfaces.
- Respect existing folder casing (`Pages`, `Components`) and keep imports consistent.
- Use ESLint as the baseline quality gate; fix warnings/errors before merge.

## Testing Guidelines
There is currently no dedicated automated test framework configured in `package.json`.

- Minimum pre-PR checks: `npm run lint` and `npm run build`.
- For UI/backend changes, include manual verification steps in the PR description (route tested, auth flow, chat behavior, etc.).
- If you add tests, colocate by feature (for example `src/Components/__tests__/`) and document run commands in `README.md`.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit messages (for example: `upgrade packages`, `implement build123d model generator, v0.1`).

- Keep commit subjects concise and action-oriented.
- Scope each commit to one logical change.
- PRs should include: purpose, key changes, validation steps, linked issue(s), and screenshots/GIFs for UI updates.
- Never commit secrets; keep credentials in `.env` and use `.env.template` for required keys.

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

11. **Milestone Completion Gate**: After implementing any milestone, always run build/tests and then deploy the updated stack before marking the milestone done. Minimum required commands:
   - `npm --workspace @chat3d/backend run test && npm --workspace @chat3d/backend run build`
   - `npm --workspace @chat3d/frontend run test && npm --workspace @chat3d/frontend run typecheck`
   - `npm run m1:typecheck:workspaces`
   - Prefer targeted container build/deploy for changed services (for example: `docker compose build backend frontend && docker compose up -d backend frontend && docker compose ps backend frontend`).
   - Avoid full-stack rebuilds by default. Use `docker compose up --build -d && docker compose ps` only when cross-service changes require rebuilding the entire stack.
