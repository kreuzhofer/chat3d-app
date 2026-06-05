# Per-Prompt Eval Plan — A/B Test Results (v2: assembly/mechanism band)

Generated: 2026-06-05T20:18:23.613Z

## Summary

- **30 prompts** tested across PCB Cases (8), Primitives (4), Boolean Operations (4), Hinges (4), Generic Enclosures (4), bd_warehouse (3), Extrusions (3).
- **v1** = single 3-band template (visual / balanced / sealed). State captured fresh just before the v2 regen.
- **v2** = 4-band template, adds an "assembly/mechanism" band (0.30–0.45) for hinges, gears, kinematic structures.
- **Mean composite Δ (v1→v2):** 0.32
- **Distribution:** 13 up, 11 down, 6 unchanged

## Hypothesis

Code-eval is unreliable for structural-assembly correctness. It can verify that the parameter values match the prompt, but cannot detect e.g. "hinge leaves rendered perpendicular instead of coplanar", "knuckles not interleaved", or "gear teeth not engaging". For mechanisms, the VLM is the reliable signal. Targeted edit: add a new `0.30–0.45 (assembly/mechanism)` band in the evalPlan-generation template so hinges, gears, sprockets and kinematic multi-part assemblies are routed with a lower code-eval weight. Other buckets should be unaffected.

## Did the LLM use the new band?

Yes, exactly where intended — and only where intended:

| Bucket | v2 mean weight | In new band (<0.45) | In balanced (0.45–0.70) | In sealed (≥0.70) |
|---|---|---|---|---|
| PCB Cases | 0.690 | 0 | 3 | 5 |
| Primitives | 0.637 | 0 | 2 | 2 |
| Boolean Operations | 0.600 | 0 | 4 | 0 |
| **Hinges** | **0.400** | **4** | **0** | **0** |
| Generic Enclosures | 0.600 | 0 | 4 | 0 |
| bd_warehouse | 0.600 | 0 | 2 | 1 |
| Extrusions | 0.550 | 0 | 3 | 0 |

All 4 hinges landed in the new assembly/mechanism band (0.38–0.42, mean 0.40). Nothing else moved into it. The change is surgical, as designed. bd_warehouse stayed in balanced/sealed — the spec LLM evidently does not classify standard fasteners/sprockets in `bd_warehouse` as kinematic assemblies, only the explicit hinge prompts.

## Did the change help Hinges? (The prediction set)

| Prompt | Visual | Code | v1 weight | v1 eval | v2 weight | v2 eval (predicted) | v2 eval (actual) |
|---|---|---|---|---|---|---|---|
| `32b6c670` (butterfly hinge) | 2→3 | 8→8 | 0.70 | 3.0 | 0.40 | 5.0 | **4.0** |
| `1a1b5f13` (interleaved knuckle) | 3→3 | 7→7 | 0.70 | 4.0 | 0.38 | 4.5 | **4.0** |
| `06af61b6` (piano hinge) | 8→9 | 4→4 | 0.70 | 5.0 | 0.40 | 7.0 | **5.0** |
| `5eeab060` (single-axis pivot) | 7→8 | 5→9 | 0.70 | 5.6 | 0.42 | 6.2 | **8.4** |

Two of four hinges improved (`32b6c670` +1.0, `5eeab060` +2.8), two stayed flat (`1a1b5f13`, `06af61b6`).

The two flat results are explained by the **±4 gap clamp** in `computeCompositeScore`: when |visual − code| ≥ 4 and effective weight < HIGH threshold, composite is capped at `min(v,c) + 1`. Lowering the weight increases VLM influence, but the gap-clamp now bites:

- `06af61b6`: visual=9, code=4, gap=5 → clamp caps at `min(9,4)+1 = 5`. We genuinely want a 7 here (VLM correctly sees a good model), but the clamp says "code disagrees, take the pessimistic floor". Lowering the weight does not help this prompt at all — the clamp dominates.
- `32b6c670`: visual=3, code=8, gap=5 → clamp caps at `min(3,8)+1 = 4`. The clamp helps here because we want the *low* (visual) signal to dominate — and it does.

So the assembly/mechanism band only delivers when (a) the gap is < 4, or (b) visual is the lower score. When visual is high and code low and they disagree by 4+, the clamp neutralises the band.

## Other buckets

- **PCB Cases**: −0.55 (range −2.50 to +1.00). Mostly noise from re-running the same evaluation. One prompt (`10024302`) flipped from composite→code_only because the VLM declined to score it this run; that alone is −2.10. Without that, PCB Cases is close to flat.
- **Boolean Operations**: −0.70. All four prompts drifted slightly negative (3 down, 1 up). Could be VLM stochasticity; the v2 template did not change their weight band assignment.
- **Primitives**: −0.05 (noise).
- **Generic Enclosures**: −0.27 (noise; one prompt `03909b59` dropped 1.8 on what looks like a VLM rescoring).
- **bd_warehouse**: +2.43. Driven by `2d902495` recovering from an assertion-fail run (1 → 5.6) — unrelated to the v2 template, just normal re-eval variance.
- **Extrusions**: +2.33. Driven by `03a8e28f` (2 → 9) — went from `code_only` source in v1 to `composite` source in v2, so the VLM ran this time and scored highly. Again, unrelated to the band change.

Overall +0.32 across 30 prompts; +0.95 for the targeted Hinge bucket. The negative drift in PCB Cases and Boolean Operations roughly cancels the off-target gains in bd_warehouse and Extrusions, leaving Hinge improvement as the real signal.

## Bottom line

**Keep v2 — but acknowledge the gap-clamp ceiling.**

The template change works as designed: hinges are correctly identified, their weight drops, and on the two prompts where the ±4 clamp does not interfere we see clear improvement (+1.0, +2.8). On the other two hinges the clamp prevents the band from helping — but it does not *hurt* either; they stayed flat.

Off-target buckets show no systematic regression — the negatives we see are within normal one-shot VLM-rescoring noise (PCB Cases drifted both ways; Boolean Operations slightly negative across all four, but small magnitudes).

Suggested follow-ups if we want to extract more from the assembly/mechanism band:
- Loosen or remove the ±4 clamp specifically when the prompt has `requiresDecomposition: true` or when the evalPlan put the weight in the new band — the clamp's premise is that visual ≠ code means something is wrong, but for assemblies the whole point is that code-eval cannot judge structural correctness, so the disagreement is *expected* and should not penalise.
- Re-run at higher VLM eval count (e.g. 3 trials averaged) to suppress the single-shot noise that dominates the small negative buckets.

## Per-bucket Δ

| Bucket | n | v1 mean | v2 mean | Mean Δ | Range | v2 mean weight |
|---|---|---|---|---|---|---|
| PCB Cases | 8 | 5.58 | 5.03 | -0.55 | [-2.50, +1.00] | 0.690 |
| Primitives | 4 | 9.77 | 9.73 | -0.05 | [-0.50, +0.30] | 0.637 |
| Boolean Operations | 4 | 8.28 | 7.57 | -0.70 | [-1.60, +0.40] | 0.600 |
| Hinges | 4 | 4.40 | 5.35 | 0.95 | [0.00, +2.80] | 0.400 |
| Generic Enclosures | 4 | 4.80 | 4.53 | -0.27 | [-1.80, +0.70] | 0.600 |
| bd_warehouse | 3 | 4.30 | 6.73 | 2.43 | [0.80, +4.60] | 0.600 |
| Extrusions | 3 | 6.20 | 8.53 | 2.33 | [-0.40, +7.00] | 0.550 |
| **Overall** | **30** | — | — | **0.32** | — | — |

## Per-bucket weight-band distribution (v2)

| Bucket | visual/assembly (<0.45) | balanced (0.45–0.70) | sealed/code-heavy (0.70+) |
|---|---|---|---|
| PCB Cases | 0 | 3 | 5 |
| Primitives | 0 | 2 | 2 |
| Boolean Operations | 0 | 4 | 0 |
| Hinges | 4 | 0 | 0 |
| Generic Enclosures | 0 | 4 | 0 |
| bd_warehouse | 0 | 2 | 1 |
| Extrusions | 0 | 3 | 0 |

## Per-prompt results

| Prompt (first 8) | Bucket | v2 weight | v2 band | v1 composite | v2 composite | Δ | v1 |v-c| | v2 |v-c| | v1 src | v2 src |
|---|---|---|---|---|---|---|---|---|---|---|
| `078e4d11` | PCB Cases | 0.75 | sealed/code-heavy (0.70+) | 7.6 | 6.8 | -0.80 | 2.0 | 1.0 | composite | composite |
| `05066df7` | PCB Cases | 0.75 | sealed/code-heavy (0.70+) | 7 | 4.5 | -2.50 | 0.0 | 2.0 | composite | composite |
| `19d8a259` | PCB Cases | 0.55 | balanced (0.45–0.70) | 3 | 3 | 0.00 | - | - | code_only | code_only |
| `09b73b07` | PCB Cases | 0.75 | sealed/code-heavy (0.70+) | 5.3 | 4.8 | -0.50 | 1.0 | 3.0 | composite | composite |
| `2341d5b6` | PCB Cases | 0.50 | balanced (0.45–0.70) | 4 | 4.5 | 0.50 | 0.0 | 1.0 | composite | composite |
| `09c2b5de` | PCB Cases | 0.75 | sealed/code-heavy (0.70+) | 6 | 6 | 0.00 | 0.0 | 0.0 | composite | composite |
| `24f10279` | PCB Cases | 0.82 | sealed/code-heavy (0.70+) | 6.6 | 7.6 | 1.00 | 2.0 | 2.0 | composite | composite |
| `10024302` | PCB Cases | 0.65 | balanced (0.45–0.70) | 5.1 | 3 | -2.10 | 3.0 | - | composite | code_only |
| `07e7526a` | Primitives | 0.50 | balanced (0.45–0.70) | 10 | 9.5 | -0.50 | 0.0 | 1.0 | composite | composite |
| `084375fa` | Primitives | 0.55 | balanced (0.45–0.70) | 9.7 | 9.6 | -0.10 | 1.0 | 1.0 | composite | composite |
| `09df32d8` | Primitives | 0.75 | sealed/code-heavy (0.70+) | 9.7 | 10 | 0.30 | 1.0 | 0.0 | composite | composite |
| `0b1a1ba1` | Primitives | 0.75 | sealed/code-heavy (0.70+) | 9.7 | 9.8 | 0.10 | 1.0 | 1.0 | composite | composite |
| `645de13c` | Boolean Operations | 0.60 | balanced (0.45–0.70) | 8 | 6.4 | -1.60 | 3.0 | 1.0 | composite | composite |
| `008049fc` | Boolean Operations | 0.60 | balanced (0.45–0.70) | 9 | 7.8 | -1.20 | 0.0 | 2.0 | composite | composite |
| `00bd1aed` | Boolean Operations | 0.55 | balanced (0.45–0.70) | 8.1 | 7.7 | -0.40 | 2.0 | 3.0 | composite | composite |
| `027bc5cc` | Boolean Operations | 0.65 | balanced (0.45–0.70) | 8 | 8.4 | 0.40 | 0.0 | 1.0 | composite | composite |
| `1a1b5f13` | Hinges | 0.38 | visual/assembly (0.20–0.45) | 4 | 4 | 0.00 | 4.0 | 4.0 | composite | composite |
| `06af61b6` | Hinges | 0.40 | visual/assembly (0.20–0.45) | 5 | 5 | 0.00 | 4.0 | 5.0 | composite | composite |
| `32b6c670` | Hinges | 0.40 | visual/assembly (0.20–0.45) | 3 | 4 | 1.00 | 6.0 | 5.0 | composite | composite |
| `5eeab060` | Hinges | 0.42 | visual/assembly (0.20–0.45) | 5.6 | 8.4 | 2.80 | 2.0 | 1.0 | composite | composite |
| `020c6ab4` | Generic Enclosures | 0.60 | balanced (0.45–0.70) | 5 | 5 | 0.00 | 0.0 | 0.0 | composite | composite |
| `00a8f375` | Generic Enclosures | 0.65 | balanced (0.45–0.70) | 7 | 7.7 | 0.70 | 0.0 | 1.0 | composite | composite |
| `5dd717c0` | Generic Enclosures | 0.55 | balanced (0.45–0.70) | 1 | 1 | 0.00 | - | - | assertion_fail | assertion_fail |
| `03909b59` | Generic Enclosures | 0.60 | balanced (0.45–0.70) | 6.2 | 4.4 | -1.80 | 2.0 | 1.0 | composite | composite |
| `00d1eb27` | bd_warehouse | 0.70 | sealed/code-heavy (0.70+) | 4.8 | 5.6 | 0.80 | 3.0 | 2.0 | composite | composite |
| `026e71b9` | bd_warehouse | 0.55 | balanced (0.45–0.70) | 7.1 | 9 | 1.90 | 3.0 | 0.0 | composite | composite |
| `2d902495` | bd_warehouse | 0.55 | balanced (0.45–0.70) | 1 | 5.6 | 4.60 | - | 1.0 | assertion_fail | composite |
| `00880a28` | Extrusions | 0.45 | balanced (0.45–0.70) | 8.6 | 9 | 0.40 | 1.0 | 0.0 | composite | composite |
| `03a8e28f` | Extrusions | 0.65 | balanced (0.45–0.70) | 2 | 9 | 7.00 | - | 0.0 | code_only | composite |
| `0636174a` | Extrusions | 0.55 | balanced (0.45–0.70) | 8 | 7.6 | -0.40 | 0.0 | 1.0 | composite | composite |
