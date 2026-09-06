# PROTOTYPE — wayfinder #59: the first instrument revision, measured on the 125

Throwaway. Not built, not imported by production code. Primary source for the resolution posted on
[issue #59](https://github.com/kreuzhofer/chat3d-app/issues/59) (map #45). The code change itself is on
`main` (`feat(eval): land the one instrument — id stamping, staleness, eight views, evidence clause`).

Experiment `30c351f7` on the fixed 125 (the selections of `7337a398`, copied by id), **production's
instrument** — the first revision under an Instrument id (`production@22e0f10b0505`: one instrument, the
same eight views, the evidence clause, no eval-plan text, the follow-up template with its own evidence
clause) — zoom follow-up on, guided JSON, thinking off. Run `27f584d2` glm-5.3-flash (thinking off,
spark-02+03, restarted from the stored #56 recipe).

Compared against: #56's guarded run `60cdd170` (same guards, the old instrument text as the
`pb-legacy-control` variant — the pair that isolates the revision), #50's control `3b5edb08` (the
ticket's named control, unguarded follow-up), and the zoom-enabled reference `786b6e3c` (Sonnet with the
follow-up, old instrument).

- `eval59.sh` — the whole measurement: run summary with one-instrument-id-per-run and the views each
  run's stored prompt promised, item-level comparisons (`compare-items.py`, copied from
  `prototypes/50-pass-bias` on `wayfinder/50-pass-bias-variant`), the item gate (`gate58.py`, copied from
  `prototypes/58-qualification-screen` on `wayfinder/58-qualification-bar`), the 33 plan-carrying examples
  against the rest (`subset59.py`), evidence completeness of zoom details (`...` rate), residual uncertain.
- `results59.txt` — its output.
- `exp59.txt`, `run59.txt`, `start59.txt` — the ids and the start time.
- `probe-glm-temperature0.md` — dgx-manager's 32-request sequential probe on the idle deployment
  (#56 finding 4, isolated).
- **Throughput test (Daniel's ask):** experiment `7a9ea679`, run `62b4fa58` — qwen3.8-27b-nvfp4 (thinking off)
  served by three single-node replicas (spark-02 `cmtprzt671w352auhqgq43q4y`, spark-03 `cmtpsaud71whj2auh0k27ynki`,
  spark-04 `cmtpeql4y1etk2auhbk9668ry`) under one gateway pool, `global.vlm_experiment_concurrency = 3`, the new
  instrument, zoom on. `gateway-poll.py` / `gateway-summary.py` sample `/api/gateway` every 2 s; `gateway-pool.tsv`
  is the raw poll, `gateway-distribution59q.txt` the per-member split, `results59q.txt` the run summary, wall
  clock against the sequential qwen run `ebd54b53`, completeness, and item agreement. `purpose-map-repoint.md`
  records why the served name changed and how the ten purposes were re-pointed. `exp59q.txt`, `run59q.txt`,
  `model59q.txt`, `start59q.txt` are the ids.

The reading is on the issue, not here.
