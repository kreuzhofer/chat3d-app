# UX6 Accessibility + Quality Gate

Date: 2026-02-19

## Scope

Validated UX quality for the rewritten surfaces:
- Public routes (`/`, `/pricing`, `/login`, `/register`, `/waitlist`, `/legal`, `/imprint`)
- Authenticated chat (`/chat`)
- Admin (`/admin`)
- Profile (`/profile`)
- Notifications (`/notifications`)

## Checklist

- [x] Keyboard navigation baseline
  - Dialog and drawer now support `Escape` close and focus trapping.
  - Focus restoration is implemented when overlays close.
- [x] Landmark and labeling baseline
  - App shell and public pages use explicit header/main/footer landmarks.
  - Route/group navigation labels are present for screen-reader discoverability.
- [x] Contrast and typography sanity
  - Shared tokenized palette and typography scale applied across migrated pages.
  - Alert and badge color roles are consistent with semantic meanings.
- [x] Motion/performance guard
  - Added reduced-motion CSS fallback to disable non-essential animation/transition.
- [x] Regression snapshot capture
  - Playwright route capture test added for public UX surfaces (`public-ux-snapshots.spec.ts`).

## Residual Risks

- Automated contrast ratio checks are not yet integrated into CI.
- Authenticated visual snapshots are still manual due auth/bootstrap complexity.
- 3D viewer bundle size remains above the warning threshold and should be split further in a follow-up perf milestone.
