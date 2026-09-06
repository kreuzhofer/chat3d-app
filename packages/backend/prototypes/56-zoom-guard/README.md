# PROTOTYPE — wayfinder #56: the zoom follow-up under the main call's guards, measured

Throwaway. Not built, not imported by production code. Primary source for the resolution posted on
[issue #56](https://github.com/kreuzhofer/chat3d-app/issues/56) (map #45). The code change itself is on
`main` (`feat(eval): guard the zoom follow-up like the main judge call` and its follow-up commit).

Experiment `4a970245` on the fixed 125 (the selections of `7337a398`, copied by id), control instrument
`pb-legacy-control` (byte copy of production's legacy instrument, md5 `a9da87f8…`), zoom follow-up on,
guided JSON, thinking off — the #58 screen's setup with the guarded follow-up. Runs: `60cdd170`
glm-5.3-flash (thinking off, spark-02+03), `ebd54b53` qwen38-nvfp4-spark (thinking off, spark-04).

Compared against: glm's two earlier runs under the identical harness with the unguarded follow-up
(`3b5edb08`, #50's control, 09-05; `1f9f3817`, #58's screen, 09-06), qwen's earlier run (`b05bb3c6`, #58),
and the zoom-enabled reference `786b6e3c` (Sonnet with the follow-up).

- `eval56.sh` — the whole measurement: run summary, item-level comparisons (`compare-items.py` from
  `prototypes/50-pass-bias`, branch `wayfinder/50-pass-bias-variant`), the item gate (`gate58.py` from
  `prototypes/58-qualification-screen`, branch `wayfinder/58-qualification-bar`), the keyword-fallback
  heuristic on stored zoom details, evidence completeness (`...` details), residual uncertain items, and the
  backend log's follow-up outcomes with the angle distribution per run.
- `results56.txt` — its output, 2026-09-06 09:15Z.
- `probes.md` — the direct gateway probes behind the findings (evidence collapse on glm, key order, budget).
- `runs56.txt`, `exp56.txt`, `start56.txt` — the ids and the log window the script reads.

The reading is on the issue, not here.
