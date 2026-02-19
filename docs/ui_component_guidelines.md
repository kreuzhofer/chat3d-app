# UI Component Guidelines

## Purpose

This document defines UI composition rules for the design-system track.
Use shared primitives first; only add page-specific styling when there is no reusable option.

## Layout Primitives

- `AppShell`: authenticated page chrome and responsive shell framing.
- `PageHeader`: title, optional breadcrumb, and action row.
- `SectionCard`: standard grouped content container.
- `EmptyState`: no-data surface with optional CTA.
- `InlineAlert`: inline info/success/warning/error messaging.

## Interaction Primitives

- `CommandBarTrigger`: reserved extension point for command palette entry.
- `DropdownMenu`: contextual actions with low-clutter affordance.
- `Dialog`: confirmation and irreversible action gate.
- `Drawer`: side-detail workflows (for example user detail inspector).
- `ToastProvider` + `useToast`: non-blocking feedback for completed actions.
- `Tabs`: compact view switches for dense workflows.

## Form Standards

- Use `FormField` for labels + helper/error messaging.
- Show validation close to the field; avoid only top-level error blocks.
- Mark required inputs explicitly with `*`.
- Use `DestructiveActionNotice` before irreversible actions.
- Any destructive submit should require an explicit confirmation dialog.

## Anti-Patterns

- Do not use ad hoc spacing values if tokenized spacing works.
- Do not duplicate page-specific alert styles; use `InlineAlert`.
- Do not place destructive controls next to primary submit without visual separation.
- Do not hide critical action outcomes; show toast + inline confirmation.
- Do not use dense tables on mobile when a card/list view is possible.
