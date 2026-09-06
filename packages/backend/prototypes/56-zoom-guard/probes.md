# Direct probes behind the #56 findings (2026-09-06, gateway 192.168.44.14:4000, thinking off, temperature 0, 256 output tokens unless noted)

Requests reproduce the follow-up call exactly: the follow-up instrument text with the question and the
construction spec, one 1536×1536 render of the angle the harness picked, `response_format: json_schema`
`{pass: boolean, detail: string}` (`strict: true`, as the SDK sends it). Probes ran while the experiment arm
was executing on the same deployment, so they do not isolate MTP from batch composition.

## glm-5.3-flash, example c967d6df, "Do all three compartments have a scoop cutout on the front face?" (angle front)

| schema | replies |
|---|---|
| pass-first (deployed), strict true ×2, unset ×2, false ×1 | 4× `{"pass":true,"detail":"..."}` (10 tokens), 1× full 55-token detail |
| detail `minLength: 20` ×3 | `"..."` then padding; 2 of 3 open a second JSON object and hit the cap (finish `length`) |
| detail-first key order ×3 | real evidence ("two visible notches … three compartments"), all 3 hit the 256 cap mid-detail (finish `length`) |
| unguided | prose reasoning, then a JSON fragment: the shape the old keyword fallback guessed on |

## glm-5.3-flash, example cebf8316, "Does the model appear to have uniform wall thickness on all closed faces?" (angle front)

| schema | replies |
|---|---|
| pass-first, 2x image + spec ×4 | 4× full detail, pass; two identical requests worded differently |
| detail-first ×2 | evidence first, then **fail** (pass-first said pass) |
| standard-resolution image, no spec | same pattern: pass-first pass, detail-first fail |

In the run this item's follow-up was stored as pass with detail `...` (Sonnet: pass).

## qwen38-nvfp4-spark, example b04a8444, "Are all 15 cells fully filled (no skeletonized or hollow cells)?" (angle ortho_45)

| budget | replies |
|---|---|
| 256 ×3 | identical each time: `{"pass": false, "detail": "The image shows the bottom face …` cut at the cap, unterminated string; finish `length` |
| 512, 1024 | finish `stop` at 447 tokens, parses: `pass: false`, 1,822-char detail that reasons and ends **"So, pass."** |

Old unguarded qwen run (`b05bb3c6`) stored this item as pass with a coherent detail; Sonnet and both glm runs: pass.
In the #56 run the SDK's output parser rejected the reply and the item stayed uncertain.
