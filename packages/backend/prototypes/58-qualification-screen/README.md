# PROTOTYPE — wayfinder #58: the qualification screen, first run

Throwaway. Not built, not imported by production code. Primary source for the screen posted on
[issue #58](https://github.com/kreuzhofer/chat3d-app/issues/58) (map #45).

Experiment `273836a2` on the fixed 125 (the selections of `7337a398`, **copied by id** — seed 34 no
longer reproduces them), control instrument `pb-legacy-control` (byte copy of production's legacy
instrument) with the zoom follow-up, guided JSON, thinking off. Runs: `b05bb3c6` qwen38-nvfp4-spark
(thinking off, spark-04), `1f9f3817` glm-5.3-flash (thinking off, spark-02+03). Reference `786b6e3c`
(Sonnet with the follow-up). Stability pair for glm: `1f9f3817` vs `3b5edb08` (#50's control run).

- `gate58.py <cand_run> <ref_run>` — the item-level gate (ADR 0001): an example is approved when
  every item passes after zoom; examples with ≥ 3 items in both runs. Reproduces #50's gate table.
  Imports `compare-items.py` from `prototypes/50-pass-bias` (branch `wayfinder/50-pass-bias-variant`).
- `eval-screen.sh` — runs the comparison script for both arms and the stability pair, the gate, and a
  heuristic count of follow-up parser fallbacks (a stored zoom detail ≤ 200 chars containing a brace
  or `"pass"` is the raw reply, not a parsed `detail`).
- `screen58-results.txt`, `numbers-qwen-vs-reference.txt` — the outputs, 2026-09-06 07:40Z.

The reading and the pick are on the issue, not here. #61 promotes this to a backend script that
prints each term of the bar as PASS / FAIL.
