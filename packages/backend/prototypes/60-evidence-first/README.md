# PROTOTYPE — wayfinder #60: evidence-first key order in the judge's answer

Throwaway record for [issue #60](https://github.com/kreuzhofer/chat3d-app/issues/60) (map #45). The harness knob
(`ResponseShape = "evidence-first"`, each checklist item written `question → detail → pass`) is in `src/`; this
directory holds the experiment and its measurement. **Result: evidence-first does not ship.**

## The question

Under guided decoding the schema's key order is the generation order, so production's judge commits `pass` before
writing `detail`. Does writing the evidence first move item-level agreement outside the noise floor, and in which
direction? Measured on the incumbent — `qwen3.8-27b-nvfp4` (thinking off, the 3-node pool), not the glm of the
ticket's first draft — under production's template byte for byte (`variant60.ts`), so the shape is the only
difference from the control.

## The runs (2026-09-14, sole tenant throughout — `tenancy60-*.txt`)

| arm | experiment | run | instrument | rows | note |
|---|---|---|---|---|---|
| control | #83 arm A | `05c9a31e` | `production@4892d8d1b160` | 125 | the qualified judge's own answers |
| A | `adf4da2e` | `7e2f23e6` | `evidence-first@c024692d7c91` | 125 | 15:39–15:53 UTC |
| B | `720213a7` | `3dfed3ed` | — | 51 | **halted by the serving gate (replica-lost) at 15:58; marked, not a term (ADR 0006)** |
| B2 | `bfce9b7b` | `run60-B2.txt` | `evidence-first@c024692d7c91` | 125 | 15:59–16:13 UTC |

A first arm (`3eb6bb22`, deleted) failed every evaluation on a second, hard-coded list of shapes in the run
executor — fixed on the branch (one list, `RESPONSE_SHAPES`, read by the executor and the create validation).

## What it measured

**Stability (the bar's own term, `screen60-B2.txt`): FAIL.** Arm B2 vs arm A: 92.8% identical items, **7.2% hard
flips (37 of 511)** against the floor of 2.9%. Production's own two arms differ by 2.74% under the same shuffled
assignment (#86). Writing the evidence first makes the judge *less* reproducible.

**Agreement with the reference (Sonnet 4.6, `bc4354d4`): unchanged.** A 85.9% identical / 72 hard flips, B2 85.3% /
75, against production's 86.3% / 70 on the same 125 (#85). Raw false passes rise (33 vs ~28 of 110 reference fails)
and raw false fails hold (39–42 of 401).

**Truth (`grade60-*.txt`, the 81 items on the 125 whose truth Daniel's adjudications fix — #57's 69 and #85's 70,
deduplicated, N excluded):**

| arm | control right → arm wrong (broken) | control wrong → arm right (fixed) | net |
|---|---|---|---|
| A | 16 | 6 | **−10** |
| B2 | 9 | 10 | **+1** |

The two arms disagree about the effect by 11 items on 81: the shape adds movement, not accuracy.

**Direction (against the control, all 511 items):** A flips 8.2% (fail→pass 25, pass→fail 17), B2 7.6% (22 / 17);
pass rate 75.7% → 77.3% / 76.7%. A mild lean toward pass, well short of #66's 20 points, and — unlike #66 — with no
gain on the graded items to weigh against it.

## Decision

Evidence-first key order **does not ship** in the production instrument: it fails the bar's stability term outright,
buys nothing in agreement, and its effect on the adjudicated items is not even the same sign across two arms. The
knob stays in the harness for any future instrument that wants it (a fine-tuned judge, #95/#96, may behave
differently under it and can be measured the same way in an afternoon).

## Files

`variant60.ts` builds an arm's body; `run60.sh start|status|screen|grade <arm>`; `grade60.ts` grades any arm against
the adjudications in the database and reads its direction against the control; `screen60-*.txt`, `grade60-*.txt`,
`dump60-*.md` (the disagreement dumps), `tenancy60-*.txt`, `exp60-*.json`, `start60-*/end60-*.txt`.
