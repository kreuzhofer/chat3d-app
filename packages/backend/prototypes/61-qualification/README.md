# PROTOTYPE — wayfinder #61: the qualification run, qwen under the first instrument revision on the 125

Throwaway record. Not built, not imported by production code. Primary source for the resolution posted on
[issue #61](https://github.com/kreuzhofer/chat3d-app/issues/61) (map #45). The code this ticket landed is the
screen itself — `packages/backend/scripts/qualification-screen.ts` over `src/services/qualification-screen.service.ts`
and `qualification-screen-dump.ts` — plus the zoom follow-up outcome marker on stored checklist items
(`ChecklistResult.zoomFollowUp`, set by `visual-eval-zoom.service.ts`), which the screen's "unreadable follow-ups"
term reads.

All runs: the fixed 125 (the selections of `7337a398`, copied by id), production's instrument
`production@22e0f10b0505` (zoom on, 1536 px, 3 follow-ups), guided JSON on vLLM, `global.vlm_experiment_concurrency = 3`.

| run | judge | experiment | when (UTC) | tenancy on the pool | role |
|---|---|---|---|---|---|
| `62b4fa58` | qwen3.8-27b-nvfp4 (thinking off, 3-node pool) | `7a9ea679` (#59) | 12:32–12:45 | judge only | candidate arm 1 |
| `1f63d1d1` | same | `4c8088eb` | 13:32–13:46 | a chat + multi-agent codegen session from 13:40:44 | candidate arm 2 (co-tenant) |
| `444483ec` | Claude Sonnet 4.6 (Anthropic API, thinking off) | `4c8088eb` | 13:46–14:02 | n/a (Anthropic) | reference under the new id |
| `043c80fd` | qwen, same | `1550fb75` | 14:02–14:14 | judge only | candidate arm 3 (clean) |

## Files

- `screen-arm1-arm3-vs-sonnet.txt` — **the qualification screen**: identity, completeness, stability (arm 3 vs arm 1),
  throughput, raw agreement of both arms with the reference. Mechanical screen: PASS.
- `disagreements-arm1-vs-sonnet.md` — **the dump for #57**: 73 items on 47 examples where arm 1 and Sonnet differ,
  each judge's evidence, arm 3's answer where it moved (it never did), an empty verdict column.
- `screen-arm1-arm2-vs-sonnet.txt` — the same screen with the co-tenant arm 2 as the pair: stability FAIL, 3.3% hard flips.
- `screen-arm1-arm2-vs-old-reference.txt` — the first screen run, against the old-text reference `786b6e3c` (identity FAIL by design).
- `screen-sequential-qwen-pair-b05bb3c6-ebd54b53.txt` — the earlier single-node sequential qwen pair (old control
  instrument): 100% identical at first pass, 1 flip after zoom — the contrast for the co-tenancy finding.
- `screen-sonnet-new-vs-old-786b6e3c.txt` — how far the instrument revision moved Sonnet itself.
- `flips-arm2-vs-arm1.txt` — the 17 flipped items of the co-tenant arm, with Sonnet's answer and run position.
- `position-identity-arm2.txt`, `position-identity-arm3.txt` — byte-identity of raw responses by run position, per arm.
- `tenancy61.sh`, `tenancy-arm1-arm2.txt`, `tenancy-arm3.txt` — who else was on the pool, per 3-minute bucket, from `llm_usage_events`.
- `exp61*.txt`, `run61-*.txt`, `start61*.txt` — the ids and start times.

## Readings (the issue holds the resolution)

- **Clean pair (arm 3 vs arm 1): 511/511 items identical, 0 hard flips, 124/125 raw responses byte-identical,
  125/125 scores identical.** Stability PASS with nothing to spare in the other direction.
- **Co-tenant pair (arm 2 vs arm 1): 17 hard flips (3.3%), all at run positions 82–115.** 73 of the first 75 responses
  byte-identical, then 11 of 50 and 0 of 25. A chat query started at 13:40:44 on the same pool (all nine non-judge
  purposes point at it); the three replicas' vLLM logs go from `Running: 1 reqs` to 2–3 from 13:40:46. Continuous
  batching with foreign requests changes the numerics; temperature 0 does not protect against that.
- **Sonnet under the new id: complete on all six counts, 14 items residual uncertain** (old text: 0). The backend log
  shows 11 of 53 follow-up replies unreadable: prose ("Looking at this high-resolution image, I can see…") cut at the
  follow-up's 256-token cap before any JSON. The Anthropic path has no guided output (#56 guarded vLLM only); the #59
  follow-up template's evidence clause invites prose. Those rows predate the outcome marker, so the screen shows 0 there.
- **Arm 1 vs Sonnet (new id): 85.7% identical, 11.5% hard flips (59); raw false passes 19 of 99 reference fails,
  raw false fails 40 of 398 reference passes; item gate 79.2% agree, false accepts 14 / false rejects 6.**
- **Throughput:** qwen 17.2–18.7 s per example, 12.0–13.0 min wall clock at concurrency 3 → 4.2–4.6 h per corpus pass
  (2,618 rated rows); Sonnet 23.8 s, 16.6 min, 5.8 h at concurrency 3.
- **The revision on Sonnet:** 90.8% identical / 6.5% hard flips vs its old-text run after zoom, 2.2% at first pass;
  item gate 89.6% agree, approves 39 vs 45.
