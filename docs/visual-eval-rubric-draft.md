# Visual Evaluator Rubric & Instruction Set — Draft Proposal

**Status:** draft for review · **Date:** 2026-09-01
**Scope:** the VLM visual judge in the workbench eval pipeline (`visual-eval.service.ts`, `visual-eval-prompt.service.ts`, `eval-orchestrator.service.ts`) and the upstream spec/checklist that feeds it (`spec-generation.service.ts`, `spec-enrichment.service.ts`).

This document is grounded in direct inspection of the live database (3,553 Sonnet-judged examples) and of the actual rendered screenshots of 20 high-scoring examples in the four hardest categories. Twelve of those twenty turned out to be false positives or near-false-positives — verified against both the renders and the stored Build123d code. The owner's report ("single examples … where the rating was good but it was broken") understates the problem in the hard categories: **at visual ≥ 8 in Gridfinity/Hinges/PCB Cases, broken-but-approved is closer to the norm than the exception.**

---

## Verification status — read before acting on this

This document was produced by a delegated analysis agent in a single pass. **Its findings are leads, not established facts.** Independent checking of one central claim found it directionally right but wrong in mechanism, so the rest should be treated the same way until confirmed.

**Checked and corrected.** §3.3's "checklist starvation" claim reported checklist *presence* rates of 37.5% / 56% / 79% in the hard categories against 91–95% in the easy ones, framing hard categories as starved. Those figures are actually the rate at which the checklist was present **but filled with literal `undefined`** — so the reading is inverted: the easy categories are worst on that axis (91–95% placeholder), and only 0–7% of evaluations in *any* production category carried a real checklist. The underlying defect is real and larger than described; it was fixed in issue #33, and the corrected per-category breakdown is recorded there.

**Not independently verified.** The twelve false positives in §0.1, the spec-echo confirmation effect, and the specific geometric claims about individual examples. These are the most valuable part of the document if they hold, and the most consequential if they do not — several assert that an approved example in the fine-tuning set is broken. They warrant re-inspection of the renders before any of them is cited as evidence.

**Numbers may not reconcile.** The corpus counts here (e.g. 3,553 Sonnet-judged examples) differ from independently-run queries (2,618 with a visual score, excluding experiment rows), most likely a different filter. Prefer a fresh query over a figure quoted here.

The structural proposal in §1 — the judge answering discrete per-item verdicts with named-view evidence, the score computed in code rather than emitted by the model, and spec citations inadmissible as visual evidence — does not depend on the unverified findings and is the part most worth carrying forward. It is being taken up in issues #35 and #36.

---

## 0. Summary of findings (evidence first)

### 0.1 Verified false positives (all `auto_approved`, all in the fine-tuning dataset)

| Example | Category | Visual / Code | What is actually wrong (verified in render and/or code) |
|---|---|---|---|
| `faf740d6` 3×2 Gridfinity bin | Gridfinity | 9 / 8 | No stacking lip (code review proved the lip solid is coincident with the body footprint — it protrudes nowhere); base tab profile marginal. Judge wrote *"Stacking lip: Visible in the 45° up view"* — false. |
| `093cffdf` 2×2 Gridfinity base | Gridfinity | 8 / 8 | Renders as a nearly featureless flat plate. The defining stepped socket profile is absent. Judge's checklist block contained six items reading literally `"1. undefined"` (see §3.3). |
| `ba264d41` desk organizer baseplate | Gridfinity | 9 / 9 | "Baseplate" blocks are solid plain cubes — no socket cavities; nothing could ever seat on it. |
| `9998f1ac` 2×1 bin w/ scoop | Gridfinity | 8 / 7 | "Scoop" is a floating thin sliver in the middle of the floor, not a curved front ramp; no visible stacking lip. |
| `8099f7bc` RPi 4 case + lid | PCB Cases | 8 / 8 | Only **one** of four standoffs present in an open-top box where all four would be plainly visible. Port cutout layout dubious. |
| `d5b347b6` battery box | Generic Encl. | 9 / 8 | Requested two 3 mm-deep floor recesses; floor is 2 mm thick, so the recesses punch **through** (verified in code: `recess_depth = 3` > `wall_thickness = 2`). Top view shows two *background-white* circles — i.e. through-holes. Judge: *"Both circular recesses are clearly visible and appropriately positioned. ✓"*, score 9, issues []. |
| `0e604851` concealed barrel hinge | Hinges | 8 / 8 | Cylinder ~2.5–3× too fat for 12 mm ⌀ × 80 mm (visible without measuring anything); the two "halves" appear split lengthwise — a barrel hinge split that way cannot rotate. |
| `7be47615` RPi 4 fin-tower lid | PCB Cases | 8 / 8 | Fins run across the **short** axis; prompt explicitly says parallel to the board's long axis. |
| `1d999583` open-frame PCB cage | PCB Cases | 9 / 6 | Extra duplicated rails at multiple levels; prompt specifies exactly 2 long + 2 short cross-rails. |
| `c3683090` offset pivot hinge | Hinges | 9 / 9 | Pivot post appears centered, not offset 15 mm from the plate edge (weaker evidence — "which edge" is ambiguous). |
| `0b7e487d` living hinge | Hinges | 8 / 10 | The load-bearing 0.4 mm bridge is physically invisible at render resolution; the judge scored 8 anyway — asserting presence of something it cannot see. |
| `b4f1e555` piano hinge | Hinges | 8 / 8 | Borderline: knuckle strip may be cosmetic overlay on a continuous plate (cannot rotate); not resolvable from the provided views. |

For contrast, `8692e8a3` (cable junction conduit, 10/10) is genuinely correct — all three stubs on three faces, plausible proportions. A 10 today means "all requested features present, nothing visibly wrong", which is roughly right; the problem is that 8s and 9s are being handed to models that fail explicit requirements.

### 0.2 The mechanism (why the judge gets it wrong)

Three pipeline defects combine with one behavioral failure:

1. **The checklist is starved out of the prompt exactly where it matters.** The orchestrator (`eval-orchestrator.service.ts` Phase 3) replaces the spec-gen binary checklist with `annotatedCriteria` filtered by visibility and a `DIMENSION_PATTERN` regex. Enriched criteria in hard categories are dimension-saturated ("38mm × 38mm", "~2.15mm"), so **every item is filtered and the judge receives no checklist at all** — and there is no fallback to the original `verification_checklist`, which is still sitting in the DB and asks exactly the right questions ("Is there a stacking lip/raised rim visible at the top edge?"). Measured checklist presence in the VLM system prompt: Primitives 95 %, Missing Examples 91 %, **Gridfinity 79 %, Hinges 56 %, PCB Cases 37.5 %**. Of the 12 false positives above, **9 had no checklist in their prompt.**
2. **Schema mismatch renders the checklist as garbage when it does survive.** `spec-enrichment` returns `verificationCriteria: string[]` (plain strings), while spec-gen returns `{text, visibility}` objects. The orchestrator maps `.text` over whatever it gets; for enriched prompts the judge receives `"1. undefined … 6. undefined"` (verified on `093cffdf`, whose stored checklist contained the exact question — *"Is the base profile stepped/chamfered rather than a plain flat slab?"* — that would have caught the failure).
3. **The construction spec is handed to the judge as "primary reference", inviting text-echo confirmation.** For `faf740d6` the judge wrote *"The model looks well-assembled with all three components (base_tab_array, bin_body, stacking_lip) correctly integrated"* — those are **variable names from the construction spec**, not observations. The spec tells the judge what should exist, and the judge confirms it from the text.
4. **Behavioral: confirmation without evidence.** In every verified FP the judge asserted presence ("✓") of a feature that is absent, malformed, or physically unresolvable, and returned `issues: []`. The current prompt never requires the judge to say *where* it saw a feature or *what it looks like* — so hallucinated confirmation is free.

Conversely, **when the checklist runs, it works**: across 2,022 stored checklist item verdicts, 251 items failed — and only 6 failed items co-occur with a visual score ≥ 8. The instrument exists; it is being disconnected precisely in the hard categories.

### 0.3 Score distribution confirms the rubric does not discriminate

Sonnet-judged histogram (n = 3,553): 9.x is a single bucket holding **62 %** of all examples (2,209), 8.x holds 705, 10 holds 240. The auto-approval gate is at composite 7.5, so the only distinctions that matter live in 7–10 — exactly where the current 4-line rubric has one line and a half.

---

## 1. Proposed rubric: derived score from independent verdicts

### 1.1 The single 1–10 holistic score is the wrong output shape

Argument from the evidence:

- Every verified FP is "gestalt right, load-bearing detail wrong". A holistic score lets overall-shape impressions dominate; the judge pattern-matches "looks like a bin" and rounds up. Sub-judgments force the judge through each failure class before any number exists.
- The false-negative evidence points the same way: the local Qwen judge (9.09 % FN rate) scored a *correct* bookend and a *correct* bucket 1.0/10 holistically. Small VLMs are unreliable at calibrated scalars but are far better at concrete binary questions with visible referents ("is the profile stepped or flat?"). A rubric a mid-size model can apply consistently is worth more than a subtle one only a frontier model can — that means the model should answer **discrete, checkable questions** and the **runtime computes the score**.
- A computed score is auditable and model-agnostic by construction: two judges agree if and only if their discrete answers agree, and every point of disagreement names a specific feature and view. Holistic scores can only be compared statistically; derived scores can be *diffed*.
- Per-model calibration preambles (two exist today in `llm_models.vlm_eval_preamble`, both for local Gemma judges, both mutating the score bands) are an admission that scalar calibration doesn't transfer between models. Deriving the score removes the thing being calibrated.

The model still may emit a free holistic score for telemetry during rollout (cheap to keep), but the **official visual score is computed by code from the verdicts below.**

### 1.2 Judge output contract

The judge performs three phases and returns JSON only. No score field is authoritative.

**Phase 1 — Inventory (look before judging).**
List the distinct parts visible and their count; state the overall shape family (box / plate / cylinder / bracket / assembly of N parts / …). This forces observation before pattern-matching, and part count is directly checkable against the spec's declared part count.

**Phase 2 — Item verdicts.** For each checklist item, exactly one verdict:

| Verdict | Meaning | Rule |
|---|---|---|
| `confirmed` | Feature present in correct form | MUST name the view(s) and describe what is visible in the pixels ("stepped profile visible along the bottom edge in front view"). A description that paraphrases the spec instead of the image is invalid. |
| `wrong_form` | Something is there, but malformed for its purpose | e.g. scoop rendered as a floating sliver; recess showing background color through it (= through-hole); knuckles overlaid on a continuous plate. Must name view + describe the discrepancy. |
| `absent` | Feature clearly missing in views that would show it | Must name the view that *should* show it. |
| `unverifiable` | No provided view can resolve it (too small, occluded in all views) | NEVER counts as confirmed. Routed to zoom follow-up or code eval. |

**Phase 3 — Global flags**, each `true/false` + one-sentence evidence:

- `structural_flag`: floating/disconnected geometry, parts fused that must articulate, interpenetrating parts, split along a direction that defeats the mechanism.
- `extra_geometry_flag`: significant geometry the prompt did not request (duplicated rails, phantom solids).
- `proportion_flag`: `none | moderate | gross` — judged **only as ratios between features or against stated dimension ratios** ("12 mm diameter × 80 mm long should be slender ~7:1; rendered ≈ 2.5:1 → gross"). Absolute sizes remain out of scope, as today.
- `canonical_form_flag` (named-standard objects only, see §2.1): the class-defining signature geometry is absent (`true` = absent).

### 1.3 Score derivation (in code, deterministic)

Definitions: an item is **load-bearing** if tagged so by the spec (§3.2); otherwise secondary.

```
start at 10
identity failure (wrong object class)                        → score = 2, stop
canonical_form_flag                                          → cap at 5
structural_flag                                              → cap at 4
any load-bearing item absent or wrong_form                   → cap at 6
proportion gross                                             → cap at 6
each secondary item absent or wrong_form                     → −1 (max −3)
proportion moderate                                          → −1
extra_geometry_flag                                          → −1
all items confirmed, no flags, ≥1 minor deviation noted      → 9
all items confirmed, no flags, no deviations                 → 10
unverifiable items                                           → no score effect; reduce visual
                                                               weight in the composite
                                                               (see §1.5) and trigger zoom
```

The caps are chosen against the 7.5 auto-approval gate: **any load-bearing failure lands below the gate** (≤ 6), structural failures land well below it (≤ 4), and the 7–10 band now has real content: 7 ≈ "all load-bearing present, a couple of secondary blemishes", 8 ≈ "one secondary blemish", 9 ≈ "complete but not flawless", 10 ≈ "no visible deviation of any kind". Applied retroactively, every FP in §0.1 lands at ≤ 6 from its verified defect alone.

Numbers in this table are proposals to be calibrated on a labeled set (§5); the *structure* — caps for defeating defects, decrements for blemishes — is the point.

### 1.4 What the judge must be told to ignore (keep, verbatim)

The two good instincts in the current prompt survive unchanged in the frozen core: the "you CANNOT measure dimensions" instruction (narrowed: *ratios* between visible features and against stated dimension ratios ARE in scope), and the STL-artefact ignore-list (faceting, tessellation, aliasing, flat shading). Likewise the orthographic-projection, extrusion-profile, 45°-displacement, and occlusion caveats — these were written to fix real false-negative patterns and inspection of the renders confirms they are still needed.

One addition to the visual vocabulary, from `d5b347b6`: **"background color visible through an opening means the opening goes all the way through. A pocket/recess must show an interior floor. If the prompt requests a blind pocket and you see background through it, that is `wrong_form`."** This single sentence converts the hardest verified FP into an easy catch.

### 1.5 Unverifiable items and the composite

`unverifiable` must feed back into the composite weight: if ≥ half of the load-bearing items are unverifiable, the composite should shift toward code eval for this example regardless of the eval-plan's static `suggestedCodeWeight` (the living-hinge case: the entire point of the object is a 0.4 mm feature no render can show — visual opinion should be nearly weightless). This is a small change in `code-eval-composite.service.ts`'s weight resolution: an *observed* signal (what the judge could actually resolve) beats a *predicted* one (what the spec LLM guessed).

---

## 2. Taxonomy of "important details" — the failure classes the judge must catch

Every class below is instantiated by at least one verified example from this database (§0.1). Ordered by observed frequency × severity.

1. **Missing signature geometry of a named standard.** "Gridfinity bin" is not "open box": the 42 mm modular stepped base tabs, socket profile, and stacking lip *are the identity*. Same logic: hinge knuckles must interleave; a thread must spiral; a DIN rail has a hat profile. (3 verified cases.)
2. **Feature count shortfall.** 1 of 4 standoffs; 2 of 3 port cutouts. Counting visible instances of an explicitly requested countable feature is squarely within VLM competence for counts ≤ ~8 and must be demanded. (`8099f7bc`.)
3. **Wrong-form / vestigial features.** Present-in-name-only: a scoop as a floating sliver, a lip absorbed into the wall it should protrude from. This is why the verdict set has `wrong_form` distinct from `absent` — judges currently collapse it into "present ✓". (`9998f1ac`, `faf740d6`.)
4. **Depth-semantics inversion** (blind pocket ↔ through-hole; hollow ↔ solid). Visible via the background-through-opening cue and interior shading. (`d5b347b6`; the hollow/solid variant is called out in the existing Gemma preamble because it was already being missed.)
5. **Assembly semantics.** Parts that must articulate rendered fused; a barrel hinge split lengthwise; leaves coplanar-welded. Code eval is structurally blind here (it sees parameters, not mating) — the eval plan's own "assembly/mechanism" band admits this. The VLM is the *only* line of defense, so these items must always be routed visual. (`0e604851`, `b4f1e555` risk.)
6. **Gross proportion error.** Ratio ≥ ~2× off from stated dimension ratios. Requires no measurement, only comparison. (`0e604851`.)
7. **Placement/orientation violations of explicit instructions.** Fins parallel to the wrong axis; an offset feature centered. Only when the prompt explicitly specifies — the "do not invent requirements" guard stays. (`7be47615`, `c3683090`.)
8. **Extra/duplicated geometry.** More rails, more bosses, phantom solids left un-subtracted. (`1d999583`.)
9. **Display-convention violations** for multi-part prompts ("side by side, 20 mm gap, lid upside down") — worth one checklist item, since many workbench prompts encode it and it verifies part count for free.

Classes that look important but must **not** be scored by the VLM: absolute dimensional accuracy (code eval + assertions), interior features of sealed enclosures (code eval; occlusion rule), mesh cosmetics (ignore-list), sub-resolution features (`unverifiable` → zoom/code). And two classes should leave the LLM judges entirely — they are deterministic mesh computations: **connected-component count** (would catch fused/split assemblies and the disconnected-living-hinge case exactly) and **bounding-box ratio vs. spec dimensions** (would catch every gross proportion error mechanically). Both are cheap, model-free, and strictly more reliable than any judge; recommended as a new assertion type alongside the existing code assertions.

---

## 3. Does the upstream spec ask the right questions? (Owner's question 2)

### 3.1 What is already right

The spec-gen binary checklist is genuinely good. For both Gridfinity FPs the stored `verification_checklist` contained the exact discriminating questions. The failure is 100 % in delivery (§0.2), 0 % in question quality — for those cases. Fix delivery before rewriting questions.

### 3.2 What is wrong and the specific changes

1. **Enrichment destroys the visual checklist.** `spec-enrichment.service.ts`'s system prompt demands criteria "referencing ONLY geometry (**not object identity**)" and rewrites everything with exact dimensions — producing criteria the dimension filter then (correctly) withholds from the VLM. Change the enrichment contract: it must **preserve the annotated `{text, visibility}` schema** and must not drop or dimension-ify items whose visibility is `visual`. Enrichment adds precision for *code* items; it has no business touching visual ones.
2. **Every criterion should carry a paired visual form.** Change spec-gen's `verificationCriteria` item schema to `{text, visibility, visualForm?}` where `visualForm` is the dimension-free phrasing ("stacking lip protrudes outward by ~2.15 mm" → visualForm: "a raised ledge is visible running around the top rim, standing proud of the wall"). The VLM gets `visualForm`; code eval gets `text`. This removes the need for the lossy `DIMENSION_PATTERN` filter altogether.
3. **Tag load-bearing items.** Add `loadBearing: boolean` to each criterion, defined for the spec LLM as: *"true if a reasonable owner would reject the print on discovering this feature missing or malformed — class-defining signature geometry, explicitly requested countable features, mating/articulation interfaces, depth semantics of every hole/pocket, and explicitly specified orientations."* This is the answer to the owner's question 1, made machine-readable. The score-cap logic in §1.3 keys off it.
4. **Require the spec to declare:** expected part count (drives the Phase-1 inventory check), for every hole/pocket whether it is through or blind (drives class 4), and for named standards a one-line "signature geometry" description (drives `canonical_form_flag` — e.g. "Gridfinity: stepped 42 mm base tabs on the underside; stacking lip ledge on the top rim"). The spec LLM demonstrably knows these facts — they are in the construction specs today — they are just never phrased as questions for the judge.
5. **Feasibility cross-check at spec time:** the battery-box failure was *specified into existence* — a 3 mm recess in a floor the spec allowed to be 2 mm. A one-line instruction in spec-gen ("verify that every pocket depth is strictly less than the wall/floor it cuts into; if the prompt makes this impossible, flag disambiguation") prevents the whole class upstream of any judge.
6. **Demote the construction spec in the judge's prompt.** Today it is "your primary reference for evaluating correctness" — which produced verbatim spec-echo confirmation. Either drop it from the VLM prompt entirely (the checklist + visualForms carry the needed content), or relabel it: *"Background reference only. It is NOT evidence. Never cite the spec or its component names as confirmation — evidence is only what you can point to in a named view."*
7. **Fix the plumbing bugs** (independent of any redesign, highest value-per-line in this document):
   - Orchestrator: when the filtered criteria list is empty, **fall back to `verification_checklist`** instead of sending no checklist (`eval-orchestrator.service.ts`, Phase 3, `effectiveChecklist`).
   - Normalize `verificationCriteria` at the DB boundary so plain strings become `{text, visibility:"both"}` before `.text` mapping (the `"1. undefined"` bug).
   - Persist checklist results consistently — only 331 of 3,624 scored examples have `eval_checklist_results`; the agent-submit path appears to drop them (not fully diagnosed, see §5).

---

## 4. What must be held constant (the instrument problem)

3,019 distinct system prompts over 3,228 stored evaluations (avg 8,979 chars) means no two evaluations ran the same instrument. To make judge-vs-judge and prompt-vs-prompt comparison meaningful:

1. **Frozen, versioned rubric core.** Role, projection/STL caveats, verdict definitions, evidence rule, ignore-list, output schema: one byte-identical block for *all* evaluations, stored once and referenced by `rubric_version` (new column on `workbench_examples` / experiment rows). Per-example content is confined to a delimited variable section: user prompt, checklist items (+ visualForms), expected part count, display convention. The per-prompt `evalPlan.systemPrompt` (free-form, LLM-generated, 800–2,500 chars) is the single largest variance source and should be **retired** in favor of the structured fields; its useful content (defer-to-code lists, occlusion notes) is exactly what `visibility` annotations already encode.
2. **No per-model preambles.** `vlm_eval_preamble` mutates score bands per judge — the definition of a non-transferable instrument. Delete both existing preambles once the derived score lands; their content (strictness anchoring, hollow-vs-solid, multi-part) is absorbed into the shared core and taxonomy.
3. **Identical images per example.** All judges of the same example must see the same views, same order, same labels, same resolution. Today the agent-submit path silently drops the isometric view (`agent-tools.service.ts`: `screenshots.filter(s => s.angle !== "isometric")`) while re-eval paths don't — two "same" evaluations see different evidence. Store the actual angle list used (`vlm_angles` column) and reuse it on re-eval. If eval-plan angle narrowing survives, the selection must be deterministic per prompt and shared across judges.
4. **Decoding pinned:** temperature 0 (already true), fixed `maxOutputTokens`, JSON-only responses; score arithmetic in code, never in the model.
5. **A frozen calibration set as regression gate.** Seed it with the 12 verified FPs in §0.1 + the two verified FNs (bookend, bucket) + ~20 verified-good examples across score bands. Any rubric edit, judge swap, or prompt change must reproduce the reference verdicts within tolerance before deployment. This converts "we changed the prompt and the average moved" into "we changed the prompt and it now catches/misses these named cases". The acceptance criterion for a mid-size judge (glm-5.3-flash, Qwen-27B) is agreement on the *verdict vectors* of this set — not score correlation with Sonnet.

---

## 5. Open questions and risks

1. **One call vs. N focused calls.** `checklist-eval.service.ts` already supports per-item focused verification (PASS/FAIL/UNCERTAIN with 3 images). Focused calls are likely more reliable for small VLMs but cost N× images tokens. Unresolved; proposed experiment: run both modes over the calibration set with the 27B candidate and compare verdict accuracy per token.
2. **Checklist-results persistence gap.** Only 9 % of scored examples store `eval_checklist_results` although 91 % of prompts contained a checklist block. I traced the block into the prompt but did not fully trace why results are dropped on the agent-submit persist path. Needs a dedicated look before the derived score can rely on stored verdicts.
3. **Counting reliability of mid-size VLMs.** The rubric leans on counting (standoffs, stubs, rails ≤ ~8 instances). Sonnet counts reliably at these magnitudes; whether the 27B candidates do is untested. If not, counts shift to the deterministic mesh/code side.
4. **Named-standard knowledge.** `canonical_form_flag` assumes the judge recognizes what a Gridfinity profile or interleaved knuckles look like. Mid-size models may not. Mitigation is in §3.2-4 (spec supplies the signature-geometry description in words); residual risk that a small judge can't match description to pixels. Calibration set will answer this.
5. **Approval-rate shock.** Applied retroactively, the caps in §1.3 would demote a substantial share of currently-approved hard-category examples (all 12 FPs, and plausibly a large fraction of the 62 % sitting at 9.x). That is the intended behavior — those examples are training-data poison — but expect Gridfinity/Hinges/PCB approval rates to drop further before category improvement work raises true quality. Do not "fix" this by loosening caps.
6. **Score-derivation thresholds are uncalibrated.** The cap/decrement values were chosen to place verified FPs below the 7.5 gate; they have not been validated against a broader human-labeled sample. Recommend labeling ~100 hard-category examples (owner or delegated) before finalizing the mapping.
7. **Not investigated:** the FN side for the new rubric (does evidence-demanding scoring make a strict judge *too* strict on correct-but-occluded models?). The occlusion and `unverifiable` rules are designed to prevent this, but it must be measured on the calibration set — it is the exact failure mode that made the local Qwen unusable holistically.

---

## Appendix A — Draft frozen rubric core (v1, for the judge system prompt)

```
You are a 3D model quality inspector for CAD models rendered from STL files.

RENDERING FACTS (never penalize these):
- Orthographic projection: parallel edges stay parallel; no foreshortening. Do not
  report tapering/convergence.
- STL is a tessellated mesh: curved surfaces ALWAYS appear faceted; edges may look
  jagged. Faceting, tessellation, aliasing, and flat shading are never defects.
- A 2D profile extruded along an axis shows its shape only in views perpendicular
  to that axis; along the axis it is a plain rectangle. Thin plates appear as lines
  edge-on. Check ALL views before judging shape.
- 45° views displace feature positions; judge positions only from straight views.
- Interior features may be occluded in every exterior view. Absence of evidence in
  an occluded region is not evidence of absence: use verdict "unverifiable".

VISUAL VOCABULARY:
- If background color is visible through an opening, the opening passes all the way
  through. A blind pocket/recess must show an interior floor. Blind feature showing
  background = wrong_form.
- You cannot measure absolute sizes. You CAN and MUST compare ratios: between parts,
  and against ratios implied by the request's stated dimensions.

PROCEDURE:
1. INVENTORY: list the distinct parts you see and their count, and the overall shape
   family. Do this before reading further into the request.
2. VERDICTS: for each checklist item answer exactly one of:
   confirmed    - present in correct form. You MUST name the view(s) and describe
                  what is visible in the image. Describing what the request says,
                  or citing the specification, is NOT evidence.
   wrong_form   - something is there but malformed for its purpose (vestigial,
                  absorbed, through instead of blind, cosmetic instead of
                  functional). Name the view and the discrepancy.
   absent       - missing in a view that would show it. Name that view.
   unverifiable - no provided view can resolve it. Never guess presence.
3. FLAGS (true/false + one sentence of evidence each):
   structural_flag     - floating/disconnected geometry, parts fused that must move
                         against each other, interpenetration, split direction that
                         defeats the mechanism.
   extra_geometry_flag - significant geometry the request did not ask for.
   proportion_flag     - none | moderate | gross, judged by ratio comparison only.
   canonical_form_flag - (only if a signature-geometry description is provided)
                         true if the described signature geometry is absent.

Do not invent requirements: if the request leaves a detail open, any reasonable
interpretation is correct. Only flag deviations from what was actually requested
or from the signature geometry provided.

Return JSON only:
{
  "inventory": { "parts": <int>, "description": "..." },
  "verdicts": [ { "item": "...", "verdict": "confirmed|wrong_form|absent|unverifiable",
                  "view": "...", "evidence": "..." } ],
  "flags": { "structural": bool, "extra_geometry": bool,
             "proportion": "none|moderate|gross", "canonical_form_missing": bool,
             "notes": "..." }
}
```

The per-example variable block appended after the core contains only: the user
request, the checklist items (visual forms), the expected part count, the
signature-geometry description (if any), the display convention (if any), and the
labeled image list. Nothing else varies.

## Appendix B — Where the evidence lives

- Renders inspected: `workbench_examples.screenshot_*` for the 20 IDs in §0; copies under the session scratchpad (`shots/`).
- Judge transcripts: `workbench_examples.vlm_raw_response` (`faf740d6`, `d5b347b6` quoted above).
- Checklist-starvation counts: `position('Verification Checklist' in vlm_system_prompt)` grouped by category.
- `"1. undefined"` bug: `vlm_system_prompt` of `093cffdf-…`; schema divergence between `spec-generation.service.ts` (`AnnotatedCriterion[]`) and `spec-enrichment.service.ts` (`string[]`).
- Through-hole proof: `workbench_examples.code` for `d5b347b6` (`recess_depth = 3`, `wall_thickness = 2`).
