# Milestone 12 Chat UI Parity Matrix

Date: 2026-02-18

## Scope

This document maps legacy Amplify chat UX behavior to the Docker frontend in `packages/frontend`.
It covers route-level chat workflows only (core chat context + timeline + SSE updates).
3D viewer/files/ratings/regenerate parity is intentionally deferred to Milestone 13.

## Legacy to New Mapping

| Legacy source | Legacy behavior | New implementation | Status |
|---|---|---|---|
| `src/Pages/Chat.tsx` | Route-driven chat context loading (`/chat/:chatId`, `/chat/new`) | `packages/frontend/src/app.tsx` routes: `/chat`, `/chat/new`, `/chat/:contextId` + `packages/frontend/src/components/ChatPage.tsx` | Completed |
| `src/Components/ChatContextComponent.tsx` | Context open/delete interactions from sidebar | `packages/frontend/src/components/ChatPage.tsx` context sidebar (open/rename/delete + create) | Completed |
| `src/Pages/Chat.tsx` | New chat creation and context naming | `packages/frontend/src/components/ChatPage.tsx` create context + rename action (`updateChatContext`) | Completed |
| `src/Components/ChatMessageUser.tsx` | User markdown message rendering | `packages/frontend/src/components/ChatPage.tsx` timeline renderer + `react-markdown`/`remark-gfm` | Completed |
| `src/Components/ChatMessageAI.tsx` | Assistant markdown message rendering with pending/error state | `packages/frontend/src/components/ChatPage.tsx` timeline segments using adapter state (`pending`, `error`, `completed`) | Completed |
| `src/Pages/Chat.tsx` subscriptions | Realtime update handling via observe subscriptions | `packages/frontend/src/components/ChatPage.tsx` consuming SSE notifications (`chat.item.updated`, `chat.query.state`) + replay hooks | Completed |
| `src/Pages/Chat.tsx` composer | Prompt submit + pipeline trigger | `packages/frontend/src/components/ChatPage.tsx` composer calling `/api/query/submit` | Completed |
| `src/Pages/Chat.tsx` model selector | Chat-level model config selection | `packages/frontend/src/components/ChatPage.tsx` context-scoped conversation/codegen model selection and save | Completed |

## Adapter Boundary

To avoid coupling UI rendering to raw backend payloads, chat item payload adaptation is isolated in:

- `packages/frontend/src/features/chat/chat-adapters.ts`

This module converts `ChatItem.messages` (unknown[]) into stable timeline segments for rendering.

## Intentional Deviations (M12)

The following are intentionally not part of M12 and are planned for M13:

- 3D model inline viewer parity
- download action bar parity for generated CAD assets
- thumbs up/down rating actions
- regenerate/retry action parity

## Validation Notes

- Route-level flows tested in `packages/frontend/src/__tests__/chat.page.test.tsx`:
  - context switching via route
  - optimistic/pending prompt submit state
  - SSE event-driven timeline refresh
- Adapter contract tested in `packages/frontend/src/__tests__/chat-adapters.test.ts`.
