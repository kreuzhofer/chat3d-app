# PROTOTYPE — wayfinder #50: an item prompt that counters the pass-bias

Throwaway. Not built, not imported by production code. Kept as the primary source for
[issue #50](https://github.com/kreuzhofer/chat3d-app/issues/50) on the map
[Eval harness for an open-weights judge](https://github.com/kreuzhofer/chat3d-app/issues/45).

- `evidence-uncertain-v1.instrument.txt` — the variant: `LEGACY_INSTRUMENT_TEMPLATE` with the
  checklist block replaced (evidence per item = the view checked and what was seen; `null` the
  default; items framed as claims to falsify; fail named as the expected answer) and one sentence
  added to the occlusion paragraph. Zoom on uncertain is the harness's own follow-up (#54).
- `legacy-control.instrument.txt` — byte copy of production's legacy instrument, run as a variant so
  the control shares the zoom follow-up with the variant.
- `render.ts` — renders both against a sample specimen (`cd packages/backend && npx tsx prototypes/50-pass-bias/render.ts`);
  asserts the control equals production's prompt for a no-plan example.
- `compare-items.py` — item-level comparison of two experiment runs
  (`python3 compare-items.py <candidate_run> <reference_run> [--first-pass]`), reads the DB through
  `docker compose exec postgres`. Reproduces the tables of #54 and #55 exactly.

Experiment `9e55f258-4e13-4aa9-92c0-e5468fb38dcd` on the fixed 125 (selections of `7337a398`),
judge `glm-5.3-flash (thinking off)`, runs `2410f9d2` (variant) and `3b5edb08` (control),
reference run `786b6e3c` (Sonnet with the follow-up).
