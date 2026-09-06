# PROTOTYPE — wayfinder #57: the adjudication material, a third opinion on all 69 disagreements

Throwaway record. Not built, not imported by production code. The material for the HITL half of
[issue #57](https://github.com/kreuzhofer/chat3d-app/issues/57) (map #45): Daniel adjudicates the disagreements
between the candidate judge and the reference; this directory holds everything the hour needs, prepared by the agent.

The sheet being adjudicated is `../64-anthropic-followup/disagreements-arm1-vs-sonnet.md`: 69 items on 40 examples,
qwen3.8-27b-nvfp4 (thinking off, 3-node pool, run `62b4fa58`) vs Claude Sonnet 4.6 (thinking off, the re-made
reference `6f6bb5c0`), under `production@22e0f10b0505`.

## Files

- `third-opinion-69.md` — **the sheet with the third opinion on every item**: Fable 5.1 read the eight stored views of
  each of the 40 examples (two 2×2 contact sheets per example, single 768 px views where a count or a small feature
  decided it) and gave each item R (Sonnet right), C (qwen right) or N (neither / unanswerable), with what the views
  show, the deciding view and what would have settled it. 23 verdicts carry over from the 26-item sample
  (`../61-qualification/third-opinion-sample.md`), the other 46 are new. The **Daniel** column holds his verdicts (`adjudicated-69.json`, read from the page's store on 2026-09-06).
- `third-opinion-69.json` — the same, machine form (both judges' answers and details included).
- `build.py` + `page.template.html` — build the sheet (`python3 build.py sheet`) and **the adjudication page**
  (`python3 build.py page VIEWS_DIR out.html`, the eight views of every example inlined, ~10 MB). The page is
  published as the artifact *The 69 Disagreements* (https://claude.ai/code/artifact/ba989507-06ab-435e-931c-aa3904e1f880): one card per item with the prompt, the item,
  both judges' evidence, the third opinion, the eight views (click for full size), and R / C / N controls. Verdicts
  are written to the artifact's store as `verdicts/<example>-<item>` documents
  (`{verdict, agreed, note, third, direction, question, example_id, item, updatedAt}`), which the next session reads
  with the Artifact tool's `read_db` (collection `verdicts`); the page's Export button gives the same rows as
  markdown + JSON for browsers where the store is unavailable.

## Readings (third opinion, not verdicts)

| direction | items | R (Sonnet right) | C (qwen right) | N |
|---|---|---|---|---|
| qwen fails, Sonnet passes | 43 | 23 | 17 | 3 |
| qwen passes, Sonnet fails | 22 | 5 | 14 | 3 |
| Sonnet uncertain (4) | 4 | 0 | 4 | 0 |

On the 65 hard flips: qwen false passes **5** vs Sonnet false passes **17** (bar ≤: holds); qwen false fails **23** vs
Sonnet false fails **14**, allowance 28 (bar ≤ 2×: holds, with 5 to spare). The 26-item sample had extrapolated the
false-fail term to fail (≈24 vs ≈12); the full sheet reverses that because Sonnet's fails in the pass/fail direction
are wrong 14 of 22 times, not the sample's 1 of 3 — they are miscounts (four standoff rings read as one, three cutouts
as two, four holes as two) and three view-direction errors (a cavity seen in the 45° *up* view called "facing
upward"; the model was upside down).

Sonnet's zoom follow-up on the ten zoomed items in the sheet: right 5, wrong 3, undecidable 2; each wrong one went to
an angle that could not show the feature (an edge-on side view for walls, the 45° down view for standoffs the walls
hide, the 45° down view for a seam the left and top views show).

Items the eight views cannot settle at 768 px: the two Jetson cases' third cutout (a zoom on the back view), the
skeleton baseplate's cell profile, the strap hinge's 1 mm chamfer. Items no render can answer: "is the lid upside
down" on a featureless 3 mm slab (two), and three whose wording contradicts the spec or a correct model.
