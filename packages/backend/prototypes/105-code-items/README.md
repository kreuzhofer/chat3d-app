# PROTOTYPE — wayfinder #105: the code reviewer answers the code-routed items

Record for [issue #105](https://github.com/kreuzhofer/chat3d-app/issues/105) (map #45). The build is in `src/`
(branch `wayfinder/105-code-items`); this directory holds the measurement and the corpus backfill's log.

## What was built

- The code reviewer answers each code-routed criterion, in order, as `{question, pass, detail}` (`code-eval.service.ts`);
  `alignCodeItems()` aligns the answers to the criteria asked — a skipped criterion is **unanswered** (`pass: null`),
  never a guess, and fails the gate.
- Stored in `workbench_examples.code_checklist_results`, a sibling of the judge's `eval_checklist_results`: the judge's
  list, the screen's positional pairing and the adjudications' item positions are untouched.
- The gate counts the union (`gateItems()`), version `items-v2+backstop`; `scripts/rederive-gate.ts` reads both
  columns; `scripts/backfill-code-items.ts` runs the reviewer alone on rows without answers.
- The reviewer's output cap went 1024 → 4096: at 1024 it hit the cap on 42 of 120 rows and the cut JSON parsed as no
  items (39 rows with every criterion unanswered); re-run at 4096, 18 of 638 items (2.8%) are unanswered.

## Measured on the 125 (2026-09-14, 120 rows carry code-routed criteria)

| | v1 (visual items only) | v2 (visual + code) |
|---|---:|---:|
| gate-eligible rows (≥ 3 items) | 92 | 120 |
| approved | 43 | 52 |

638 code items: 537 pass, 83 fail, 18 unanswered. 19 rows became eligible and pass every item; 10 approved rows fail
a code item. Hand check of three of the reviewer's fails against the code: all three verdicts right (standoff radius
2.0 where 2.5 was required; outer diameter 4.5 where 5 was required; a lid 11 mm tall where 3 was required), one with
a partly wrong detail on positions.

**Corpus re-derivation under v2 (Daniel's decision, applied 2026-09-14):** 29 verdicts changed (19 up, 10 down),
every row re-stamped; the corpus reads **1,001 approved / 1,516 pending; the export admits 1,001** (was 992).

## The corpus backfill

`backfill-corpus.log`, started `backfill-corpus-start.txt` (pid in `backfill-corpus.pid`): 2,388 rows without code
answers that carry code-routed criteria, concurrency 2, ~28 s a review — about ten hours at the pool's R=2 (spark-02
lent to dgx-manager for the Flash-Next TP2 gate that day). Runs detached on the host against the dev database; when
it ends, `scripts/rederive-gate.ts --apply` recomputes the verdicts and the counts go on the ticket.

## Outcome (2026-09-15)

Backfill done 19:05 → ~04:10 UTC: 2,388 rows, 9,370 item answers, 37 unanswered (0.4 %), 0 failed; reviews ran ~11 s
after the first hour. Re-derived in four passes as rows landed (29 + 168 + 689 + 217 = 1,103 verdicts changed after the
125-only pass). Corpus: 2,517 rated, 2,508 with code answers, 10,008 code items (598 fails), 11 rows still below three
items; **1,925 approved / 592 pending; the export admits 1,925** (992 after #88, 2,112 before the item gate).
