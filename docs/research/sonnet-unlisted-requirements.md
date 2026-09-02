# What Sonnet penalises when every checklist item passes

Research note for [issue #48](https://github.com/kreuzhofer/chat3d-app/issues/48) (child of map #45). Evidence-only; no recommendations beyond what the data shows. Local database read on 2026-09-02; nothing was modified.

## Question

Across the Sonnet-judged evaluations in (1) the 1,333 backfilled production rows and (2) the Sonnet arm of experiment `7337a398` (run `c3658ef3`), take every evaluation where **all checklist items pass but `visual_score < 7.5`**, extract the cited issues, and classify each as

- **(a)** a requirement stated in the prompt but absent from the checklist;
- **(b)** a requirement present in `verification_criteria` but filtered out before the judge (dimension regex or `visibility: "code"`);
- **(c)** a genuinely holistic judgement not reducible to a checkable item.

## Headline

| | Production | Experiment (Sonnet arm) | Total |
|---|---:|---:|---:|
| Evaluations in source | 1,333 | 125 | 1,458 |
| All items `pass === true` (strict) | 1,116 | 53 | 1,169 |
| **Strict all-pass and `visual_score < 7.5`** | **68** | **13** | **81** |
| Cited issues in those evaluations | 120 | 27 | **147** |
| Lenient variant (NULL "uncertain" items ignored, see Method) | 123 | 24 | 147 evaluations / 276 issues |

Classification of the 147 issues (strict set):

| Class | Count | Meaning |
|---|---:|---|
| **(b)** filtered criterion | **74** | requirement is in `verification_criteria` (or the fallback checklist) and was removed by `deriveVisualChecklist()` — 73 by the dimension regex, 1 by `visibility: "code"` alone |
| ↳ of which also stated in the prompt | 47 | these satisfy the ticket's literal wording of (a) *and* (b); counted under (b) here (precedence rule in Method) |
| **(a)** prompt-stated, in no criterion at all | **5** | 3 distinct requirements: colour (×2), hemisphere-not-sphere (×2, same evaluation), rim lip (×1) |
| **(c)** holistic | **12** | "thread ridges look exaggerated", "cage dominates", realism of a bottle shoulder — no discrete requirement anywhere |
| Not one of (a)/(b)/(c), counted separately: | | |
| (S) requirement exists only in the **Geometric Specification** block the judge is shown | 11 | invented defaults such as "fan opening offset 10 mm toward SoC", "all edges sharp", "bottle is hollow" — not in prompt, not in criteria |
| (X) contradicts a checklist item that **passed** | 16 | e.g. checklist "exactly 4 standoff bosses" = pass, issue "only one standoff visible" |
| (N) non-issue — the text itself concedes correctness, or asserts no mismatch | 22 | e.g. "atypical ... but may be acceptable for an ISO 14583 screw", "which matches the geometric specification" |
| (K) discrete requirement from domain knowledge, stated nowhere | 4 | Gridfinity base-cell pattern, "typical electric guitar" upper bout, expected screw-tip chamfer, front-should-face-viewer |
| (U) uncertain between two classes | 3 | listed individually in the appendix |

So: of the 147 issues, **79 (54%) are requirements the judge could have been asked about and was not** — 74 because the filter removed them and 5 because nothing ever captured them — and **38 (26%) are either contradictions of items it had just passed or self-retracted non-issues**. Only 12 (8%) are holistic in the sense of (c).

At the evaluation level: 52 of the 81 evaluations cite at least one (a)/(b) issue; 10 cite nothing but (X)/(N) issues; 4 cite only (N).

## Method

### Sources and the qualifying condition

- Production: `workbench_examples` with `eval_checklist_state = 'real'`, `vlm_model = 'anthropic/claude-sonnet-4-6'`, `experiment_run_id IS NULL` — 1,333 rows, every one with an array in `eval_checklist_results`.
- Experiment: `vlm_experiment_results` with `run_id = 'c3658ef3-73c7-409e-91aa-b3e4ee9aef40'` (run 1 of experiment `7337a398-425c-40ed-8455-a8b4ff0d1ec4`, "judge head-to-head … (real checklists)", model label "Claude Sonnet 4.6 (Anthropic API, thinking off)") — 125 rows, all arrays.
- Every checklist element is `{question, pass, detail}`. `pass` takes three values: `true`, `false`, **`null`**. The judge prompt asks for `null` when it "CANNOT resolve this feature" (`packages/backend/src/services/visual-eval-prompt.service.ts:351-360`). 145 production items and 49 experiment items are `null`; 164 of the 1,458 evaluations contain at least one.
- **Strict definition used here:** every element has `pass = true` (`bool_and(coalesce((it->>'pass')::boolean, false))`). A naive `bool_and((it->>'pass')::boolean)` ignores NULLs and admits evaluations with unresolved items; that "lenient" count (123 + 24 = 147 evaluations, 276 issues) is reported for reference but not classified — an unresolved item is not a passed item.
- Empty checklists were excluded (`n_items > 0`); there are none in either source.

### How the checklist reached the judge

Both production and the experiment build the judge's checklist with the same function, `deriveVisualChecklist()` in `packages/backend/src/utils/verification-criteria.ts` (called from `eval-orchestrator.service.ts:379`, `scripts/backfill-issue-34.ts:115`, `vlm-experiment-execution.service.ts:319`):

```ts
// verification-criteria.ts:37
const DIMENSION_PATTERN = /\b\d+(\.\d+)?\s*(mm|cm|m\b|°|degrees?|radius|diameter)\b/i;
// verification-criteria.ts:89-90
const derived = toAnnotatedCriteria(criteria)
  .filter(c => c.visibility !== "code" && !DIMENSION_PATTERN.test(c.text))
```

If nothing survives, it falls back to `verification_checklist` with the same dimension filter applied (`:96-100`). Two facts about the inputs matter for the results:

1. Spec generation (`spec-generation.service.ts`) emits `{text, visibility}` and is told "NEVER include specific dimensions … in visual checks" and to mark "ALL specific dimensions/measurements … counts, spacing" as `code`.
2. Spec **enrichment** (`spec-enrichment.service.ts`) replaces those with bare strings ("3-6 verification criteria: objective structural checks"), which `toAnnotatedCriteria()` maps to `visibility: "both"` (`verification-criteria.ts:30`). Enriched criteria are long, coordinate-dense sentences that routinely bundle a count or a placement with a dimension — and the regex drops the whole sentence. 771 of the 1,333 production prompts and 109 of the 125 experiment prompts carry this bare-string shape.

The judge is also always shown the construction spec under the heading `## Geometric Specification … Use this specification as your primary reference for evaluating correctness` (`visual-eval-prompt.service.ts:327-334`). That block is present in 1,333/1,333 stored production judge prompts and 125/125 experiment prompts. This is why class (S) exists: several issues enforce "as specified" requirements that appear only there.

The replication of `deriveVisualChecklist()` used for classification reproduces the questions actually stored in `eval_checklist_results` for **81/81** strict evaluations. One trap for anyone re-doing this in Python: JavaScript's `\b` is ASCII-only, so `18,000 mm³` matches the pattern in JS (`³` is a non-word char there) but not in Python unless `re.ASCII` is set.

### Classification rules

Each cited issue was read against the prompt text, the criteria (kept and dropped), the checklist shown, and the Geometric Specification block the judge saw. The enforced requirement was located and classed:

| Class | Rule |
|---|---|
| (a) | stated in the prompt; not in the checklist shown; **and in no criterion** (nothing to filter) |
| (b) | present in a criterion or fallback-checklist item that the filter removed. Where the prompt *also* states it, still (b) — the flag "in prompt" records the overlap, and the taxonomy below is built on (a) ∪ (b ∩ in-prompt) so the ticket's literal reading of (a) is also served |
| (S) | present only in the Geometric Specification block |
| (K) | a discrete, checkable requirement the judge inferred from the object's identity or a standard, stated nowhere it could see |
| (c) | holistic: prominence, realism, "looks exaggerated", with no discrete requirement |
| (X) | the requirement *was* in the checklist shown and that item passed; the issue contradicts or re-litigates it |
| (N) | the issue text concedes the geometry is correct/acceptable, or complains about visibility without asserting a mismatch |
| (U) | uncertain between two classes; not forced |

Two further flags were recorded per issue: **hedged** (the text says "may be", "could be a rendering artifact", "cannot confirm") — 51 of 147 — and **duplicate** (restates another issue on the same evaluation) — 8 of 147. The full per-issue table with a one-line justification is in the appendix.

Requirement types used for the taxonomy: count, presence/absence, placement/position, openness (through-vs-blind, open-vs-closed, hollow-vs-solid), surface feature, edge treatment (fillet/chamfer/sharp), orientation, symmetry, assembly/fit, profile shape, proportion, colour.

## SQL used

All queries run via `docker exec -i chat3d-postgres psql -U chat3d -d chat3d -t -A`; all read-only.

Counts per source, strict and lenient:

```sql
WITH prod AS (
  SELECT 'production' AS source, e.id AS example_id, e.visual_score, e.eval_checklist_results AS cl, e.eval_issues AS issues
  FROM workbench_examples e
  WHERE e.eval_checklist_state = 'real' AND e.vlm_model = 'anthropic/claude-sonnet-4-6'
    AND e.experiment_run_id IS NULL AND jsonb_typeof(e.eval_checklist_results) = 'array'
), exp AS (
  SELECT 'experiment', r.example_id, r.visual_score, r.checklist_results, r.issues
  FROM vlm_experiment_results r
  WHERE r.run_id = 'c3658ef3-73c7-409e-91aa-b3e4ee9aef40' AND jsonb_typeof(r.checklist_results) = 'array'
), u AS (SELECT * FROM prod UNION ALL SELECT * FROM exp),
flags AS (
  SELECT source, example_id, visual_score, jsonb_array_length(cl) AS n_items,
    (SELECT bool_and((it->>'pass')::boolean) FROM jsonb_array_elements(cl) it) AS all_pass_lenient,
    (SELECT bool_and(coalesce((it->>'pass')::boolean, false)) FROM jsonb_array_elements(cl) it) AS all_pass_strict,
    CASE WHEN jsonb_typeof(issues) = 'array' THEN jsonb_array_length(issues) END AS n_issues
  FROM u
)
SELECT source, count(*) AS total,
  count(*) FILTER (WHERE all_pass_strict AND n_items > 0) AS all_pass_strict,
  count(*) FILTER (WHERE all_pass_strict AND n_items > 0 AND visual_score < 7.5) AS qualifying_strict,
  sum(n_issues) FILTER (WHERE all_pass_strict AND n_items > 0 AND visual_score < 7.5) AS issues_strict,
  count(*) FILTER (WHERE all_pass_lenient AND n_items > 0 AND visual_score < 7.5) AS qualifying_lenient
FROM flags GROUP BY source ORDER BY source;
```

Candidate-set extraction (one JSON object per line; classification was done on this output):

```sql
WITH prod AS (
  SELECT 'production' AS source, e.id AS example_id, e.prompt_id, e.visual_score, e.eval_score,
         e.eval_checklist_results AS cl, e.eval_issues AS issues, e.eval_suggestions AS suggestions,
         e.approval_status, e.created_at
  FROM workbench_examples e
  WHERE e.eval_checklist_state = 'real' AND e.vlm_model = 'anthropic/claude-sonnet-4-6'
    AND e.experiment_run_id IS NULL AND jsonb_typeof(e.eval_checklist_results) = 'array'
), exp AS (
  SELECT 'experiment' AS source, r.example_id, e.prompt_id, r.visual_score, e.eval_score,
         r.checklist_results AS cl, r.issues, r.suggestions, e.approval_status, r.created_at
  FROM vlm_experiment_results r JOIN workbench_examples e ON e.id = r.example_id
  WHERE r.run_id = 'c3658ef3-73c7-409e-91aa-b3e4ee9aef40' AND jsonb_typeof(r.checklist_results) = 'array'
), u AS (SELECT * FROM prod UNION ALL SELECT * FROM exp),
flags AS (
  SELECT u.*, jsonb_array_length(cl) AS n_items,
    (SELECT bool_and((it->>'pass')::boolean) FROM jsonb_array_elements(cl) it) AS all_pass_lenient,
    (SELECT bool_and(coalesce((it->>'pass')::boolean, false)) FROM jsonb_array_elements(cl) it) AS all_pass_strict
  FROM u
)
SELECT row_to_json(t)::text FROM (
  SELECT f.source, f.example_id, f.prompt_id, f.visual_score, f.eval_score, f.approval_status, f.n_items,
         f.all_pass_lenient, f.all_pass_strict, f.cl AS checklist, f.issues, f.suggestions,
         p.prompt, p.verification_criteria, p.verification_checklist, p.eval_plan, p.spec_interpretation,
         c.name AS category
  FROM flags f
  JOIN workbench_example_prompts p ON p.id = f.prompt_id
  LEFT JOIN workbench_categories c ON c.id = p.category_id
  WHERE f.n_items > 0 AND f.all_pass_lenient AND f.visual_score < 7.5
  ORDER BY f.source, f.visual_score, f.example_id
) t;
```

Row index in the appendix = position in this output after keeping only `all_pass_strict = true`. The Geometric Specification the judge saw was read from `workbench_examples.vlm_system_prompt` / `vlm_experiment_results.system_prompt` with `substring(sp from position('## Geometric Specification' in sp) for position('Verification Checklist' in sp) - position('## Geometric Specification' in sp))`.

Population-level filter statistics (section "What the checklist looked like") used the same two sources joined to `workbench_example_prompts(verification_criteria, verification_checklist)` and re-applied the filter in Python with `re.ASCII`.

## Results

### Class (b): what removed the criterion

| Filter that dropped the criterion carrying the requirement | Issues |
|---|---:|
| dimension regex on a bare-string (enriched, `visibility: "both"`) or `both`/`visual` criterion | 66 |
| criterion was both `visibility: "code"` and matched the regex (either alone would drop it) | 6 |
| `visibility: "code"` alone (no dimension in the text) | 1 — row 34, "Bottom outer corner is a sharp 90-degree edge with no fillet or rounding" |
| dimension regex on a fallback `verification_checklist` question | 1 — row 56, "Is the lid 12mm tall?" |

The one criterion in the set with `visibility: "visual"` that carried a penalised requirement was still dropped, by the regex: "Hole pattern is visibly diagonal (rows of holes oriented at 45 degrees to the plate edges)" (row 78, `ea5d48aa-…`).

Of the 74 (b) issues, 47 enforce something the prompt itself states; 27 enforce something only the criteria/spec added (9 openness — closed floors, hollow interiors, through-bores; 7 presence — barb notches, lid lips, cage pockets; 5 placement; 2 each surface, proportion, edge treatment).

### Class (a) as literally defined

Only three distinct prompt requirements were captured by no criterion at all:

| Type | Issues | Evaluation(s) | Prompt excerpt | Cited issue |
|---|---:|---|---|---|
| colour | 2 | `9294339f-8630-4cd6-9169-9d9608682d26` (both sources) | "A Jetson Nano case: charcoal grey base with a silver-grey lid …" | "No color differentiation is visible between the charcoal grey base and silver-grey lid — both parts render as the same light blue-grey tone" |
| profile shape | 2 (one is a restatement) | `8040e46d-a5bc-4107-bff8-1917034fbbb7` | "A simple ice cream scoop: hemisphere bowl 45mm diameter attached to a cylinder handle 20mm diameter and 120mm long." | "The model uses a full sphere rather than just the upper hemisphere for the bowl — the sphere extends below the cylinder top face, creating a ball-on-stick appearance rather than a hemisphere bowl flush with the handle top. …" |
| surface feature | 1 | `729b9b29-791a-44e8-9ed0-5c50fd661199` | "A trumpet mouthpiece revolved 360°: 60mm long. Wide rim end 20mm diameter with a 2mm rim lip, opening into a hemispherical cup cavity …" | "The rim end exterior appears rounded/domed rather than presenting a flat annular face with a distinct 2mm raised lip around the perimeter as specified" |

For the scoop, the criteria are bounding-box statements and the Geometric Specification itself says "created as a full Sphere … lower hemisphere is absorbed into the boolean union" — the judge is right and nothing upstream of it encoded "hemisphere". For the mouthpiece, the criteria list diameters only.

### Taxonomy: prompt-stated requirements the judge's checklist did not contain

This is (a) ∪ (b ∩ in-prompt): 52 issues, 46 after removing restatements. Counts are non-duplicate (duplicate-inclusive in parentheses). Both examples for each type are verbatim rows; class in brackets.

| Type | Issues | Example 1 | Example 2 |
|---|---:|---|---|
| **proportion** (relative size / prominence; the prompt gives the numbers, the judge judges them by eye) | 16 (17) | [b] `69d841c3-ad29-4db5-adb4-158a29b35f52` — prompt: "A simple jar lid: flat disc 80mm diameter and 10mm tall with a small cylindrical handle 20mm diameter and 15mm tall on top." — issue: "The handle appears visually shorter than the disc in the side views, whereas the handle (15mm) should be taller than the disc (10mm); the handle looks like a small nub rather than a prominent cylindrical handle" | [b] `515de8fa-e498-41ed-9e37-6550f4cf9130` — prompt: "A cylinder 40mm diameter and 60mm tall with a variable-radius fillet: 8mm at the top, 3mm at the bottom." — issue: "The top fillet appears very large — in the side views and angled views, the top rounding extends so far down the cylinder wall that it resembles a hemispherical cap rather than an 8mm fillet on a 40mm-diameter, 60mm-tall cylinder. The fillet radius appears disproportionately large relative to the cylinder height." |
| **count of features** | 11 (13) | [b] `9294339f-8630-4cd6-9169-9d9608682d26` (exp) — prompt: "… Standoffs at the B01 four-hole pattern. Cutouts for USB-A, USB micro, Ethernet, HDMI. …" — issue: "Only one interior standoff is visible in the top and 45° down views; the B01 four-hole pattern requires 4 standoffs — the other three appear absent or not rendered" | [b] `a2543f23-2c62-41bc-9125-70f69daccd64` — prompt: "A parliament hinge (cranked): two 100mm-tall leaves with an L-shaped profile. … Five barrel knuckles on a 3.5mm pin." — issue: "The barrel knuckles appear to be only 2-3 segments visible from side views rather than the required 5 interleaved knuckles spanning the full leaf height" |
| **presence / absence** | 3 (3) | [b] `1bd07a18-e31f-470d-a3ce-95bde97d570e` — prompt: "A flat rectangular plate 45mm wide, 20mm tall, and 3mm thick. Two 16mm diameter circular through-holes … Two 3.2mm diameter M3 clearance through-holes are positioned 4mm from each short edge …" — issue: "The two small M3 clearance through-holes (3.2mm diameter) positioned near the short edges of the plate are completely absent — no small holes are visible at the far left and far right ends of the plate in any view (top, bottom, or angled views)" | [b] `3a1d8a51-3cc0-4ece-8d2f-f81a580b043b` (exp) — prompt: "A Banana Pi M2 case: … Flat lid 73mm x 38mm x 3mm. …" — issue: "The flat lid has multiple horizontal slot/groove features visible on its surface, but the prompt specifies a plain flat solid slab with no surface features" |
| **profile shape** | 2 (4) | [b] `a2543f23-2c62-41bc-9125-70f69daccd64` — prompt: "A parliament hinge (cranked): two 100mm-tall leaves with an L-shaped profile. Each leaf has a 30mm-wide mounting flange and a 25mm offset arm leading to the barrel. …" — issue: "The leaves lack the required L-shaped cross-section profile; they appear as flat plates with no perpendicular offset arm extending toward the barrel axis" | [a] `8040e46d-a5bc-4107-bff8-1917034fbbb7` — the ice-cream-scoop hemisphere issue quoted above |
| **edge treatment** (fillet / chamfer / sharp) | 2 (3) | [b] `2fe78704-7bdd-4451-b075-866d8b826a68` — prompt: "An M8x1.25 ISO metric external thread, 30mm long, with chamfered start and fade-out at the end." — issue: "No visible chamfer at the entry end (bottom/start of thread): the thread appears to start abruptly without a tapered lead-in chamfer reducing outer diameter to minor diameter" | [b, `visibility: "code"`] `1d3cb76d-c164-4b52-b9b7-0dda165ab749` — prompt: "A shot glass: … Sharp flat bottom with a 90-degree corner between the bottom face and outer wall, no fillet or rounding. …" — issue: "The bottom corner between the outer wall and the bottom face appears rounded/filleted rather than the specified sharp 90-degree corner" |
| **orientation** | 2 (2) | [b, criterion was `visibility: "visual"`] `ea5d48aa-2b28-4c67-af92-a6eea7c45445` — prompt: "A rectangular plate 200mm × 100mm × 6mm with a diagonal grid of 8mm holes at 45 degrees." — issue: "The hole grid appears to be arranged in a regular orthogonal (rectangular) pattern rather than a 45-degree diagonal grid — the holes in the top/bottom views show rows and columns aligned with the plate edges, not at 45 degrees" | [b] `a2543f23-2c62-41bc-9125-70f69daccd64` — prompt as above ("two 100mm-tall leaves") — issue: "The hinge appears oriented with leaves extending horizontally rather than the barrel axis running vertically along the 100mm leaf height, suggesting incorrect geometry orientation" |
| **placement / position** | 2 (2) | [b] `247346bb-85ce-40ee-a3b7-cc39a5c5d15d` — prompt: "A cable clip for a 3mm cable … On the flat back face of the C-shape, sketch and extrude a 16x6x3mm rectangular base tab flush with the bottom. …" — issue: "The C-ring bottom face appears to sit at the top of the flange (Z=3mm) rather than sharing the same bottom plane (Z=0) as the mounting flange — in the left and right side views, the ring sits on top of the flange rather than being flush at the bottom" | [b, hedged] `0d4529e1-524b-40cf-a512-fad48852b72a` — prompt: "A simple ESP8266 NodeMCU mounting adapter: flat plate 30mm × 58mm × 3mm with four 2mm pin guide holes at each header end and two M3 mounting holes." — issue: "The top/bottom views show only 4 pairs of small pin guide holes (8 total) and 2 larger M3 holes, but the geometric specification requires 8 pin guide holes arranged as 4 holes per short end (2 rows × 2 pins). The visible layout appears to show only 2 small holes per corner group rather than the specified 2×2 arrangement — however this may be a resolution limitation." |
| **surface feature** | 2 (2) | [b] `2fe78704-7bdd-4451-b075-866d8b826a68` — prompt as above ("fade-out at the end") — issue: "No visible fade-out (thread runout) at the far end: the thread ridges appear to continue at full depth all the way to the top flat face with no gradual taper back into the cylinder surface" | [a] `729b9b29-791a-44e8-9ed0-5c50fd661199` — the trumpet-mouthpiece rim-lip issue quoted above |
| **colour** | 2 (2) | [a] `9294339f-8630-4cd6-9169-9d9608682d26` (exp) — quoted above | [a] same example, production row: "No color differentiation between base (charcoal grey) and lid (silver-grey) — both parts render identically" |
| **assembly / fit** (distinct parts vs merged) | 2 (2) | [b] `e4ddb8e2-1647-4d92-96d6-e1dff1d6374c` (exp) — prompt: "A cable clip for a 3mm diameter cable … Two flat rectangular mounting tabs, each 8mm wide, 6mm long, and 2mm thick, extend outward symmetrically from the back of the clip on opposite sides …" — issue: "The two mounting tabs appear to be merged into a single continuous flat rectangular plate rather than two distinct tabs separated at the clip centerline (Y=0); they should be two separate tabs on opposite sides of the clip" | [b] same example, production row: "The two mounting tabs appear to form a single continuous rectangular plate rather than two separate tabs on opposite sides of the clip; no visible gap between them at the centerline (Y=0)" |
| **symmetry** | 1 (1) | [b, hedged] `633db300-6299-4442-96ed-09f5d278368b` — prompt: "A birdbath basin 300mm in diameter and 80mm deep. … curving to a rounded lowest point 80mm below the rim at the center …" — issue: "The top view shows a slight asymmetry or off-center artifact at the bowl's lowest point, which may indicate the spline does not terminate cleanly at r=0 with a vertical tangent" | (only one; a second symmetry case, the kayak-blade "teardrop" `6edac583-…`, is filed as uncertain) |
| **openness** (hollow / open / through) | 1 (1) | [b, hedged] `ac70ac4c-cf41-4849-8dff-104810b75965` — prompt: "A simple custom keypad housing: 100mm × 80mm × 20mm, 3mm walls, a 3×4 grid of 12mm button holes on the top face, and a 5mm cable exit on the back." — issue: "The model appears to lack a hollow interior cavity — the 45° up view shows a solid bottom face with no open interior, suggesting the enclosure may be solid rather than hollow with 3mm walls and a cavity" | (only one in-prompt case; 9 further openness issues are (b) with the requirement supplied by the criteria/spec, not the prompt — see next table) |

Two things the table makes visible. First, 16 of the 46 are **dimension-by-eye** judgements: the requirement is a stated number (15 mm groove, 8 mm fillet, 12 mm pockets) and the judge penalises its visual consequence — exactly the class of question the regex exists to keep away from it, and the judge prompt says "Do NOT judge specific measurements". Second, the counts (11) are all bundled with dimensions in their criteria ("Each of the four standoff cylinders must have an outer diameter of 5.0mm …"), so a criterion that was mostly a count was dropped for its measurements.

### Requirements the criteria or spec added that the prompt never stated — (b) not-in-prompt and (S)

| Type | (b) not in prompt | (S) spec only | Example (verbatim) |
|---|---:|---:|---|
| openness | 9 | 2 | (b) `8b44b042-…` — prompt "A box with cable pass-through holes: 100mm × 80mm × 60mm box, two 15mm diameter holes centred on opposite end faces." → issue "The box appears to be solid rather than hollow — no interior cavity or wall thickness is visible in any view, which contradicts the typical interpretation of a cable pass-through box" (spec marks the 2 mm walls "default, not specified in prompt"). (S) `e1b58595-…` — bottle "appears to be a solid (not hollow) body … the hollow interior and open neck top specified in the geometric requirements" |
| presence | 7 | 0 | (b) `239c0c78-…` — "Barb/hook notch at the tip of the clip tabs is not clearly visible in any view" — prompt says "clip tabs"; the notch is in the criterion "…confirming the 2mm×1.5mm triangular barb notch is present" |
| placement | 5 | 5 | (S) `9294339f-…` — "The fan opening on the lid appears centered rather than offset ~10mm toward the SoC/processor side as specified" — the offset exists only in the spec. (S) `da20d169-…` — "the front keyhole appears to intersect with the 30mm lens hole rather than being offset to Z=+15mm as specified" |
| surface | 2 | 1 | (S) `a1173c67-…` — "The shank appears fully threaded along its entire length, whereas ISO 4014 for M8×50 requires only approximately 22mm of threading" — the criterion says "at least 22mm", which full thread satisfies; the unthreaded grip is spec-only |
| edge treatment | 2 | 1 | (S) `62d68a8a-…` — "The top and bottom edges appear to have visible rounding/filleting rather than sharp edges as specified — the geometric specification states all edges remain sharp" — prompt: "A cylinder 80mm diameter and 60mm tall with the outer surface offset outward by 2mm" |
| proportion | 2 | 0 | (b) `1bd3765e-…` — ledge "appears minimal compared to the specified 3mm outward protrusion" — prompt gives the ledge 2 mm height, no protrusion depth |
| assembly | 0 | 1 | (S) `3df30fa3-…` — "The seven circular discs appear to be separate unconnected solids rather than fused" — prompt: "centre circle 15mm diameter surrounded by six circles 10mm diameter at 30mm from centre"; the spec added "fused into a single connected solid", which those numbers make geometrically impossible |
| profile shape | 0 | 1 | (S) `9d741de7-…` — fish "widest point appears centered rather than one-third from the nose" — the one-third rule is spec-only |

### Contradictions of passed items (X, 16) and self-retracted issues (N, 22)

- (X) clusters on **interior standoffs** and **front apertures**: checklist "Are there exactly 4 cylindrical standoff bosses inside the enclosure?" = pass, "Are the standoffs located at the four interior corners?" = pass, issue "In the 45° down view, only one standoff boss is clearly visible … the other three bosses are not visible in any angled view, though the top view shows four circular features at the corners" (`485cf1ba-…`, both sources; also `5ac6a5be-…`). Checklist "Is there a large rectangular opening visible on the front face?" = pass, issue "The front aperture is not clearly visible as a rectangular opening dominating the front face in the front/back/side orthographic views" (`1fb0e3b7-…`, `384b0bc1-…`, `3acf4710-…`). 8 of the 16 are hedged.
- (N) is dominated by one prompt: "An M4 pan head Torx screw (ISO 14583), 16mm long, with visible threads." appears **8 times** in the strict set (22 issues, 15% of the total), always with the single surviving checklist item "The part consists of a single solid body…" and always the same two issues — "The shank tip appears flat/blunt rather than tapering to a point, which is atypical for a machine screw but may be acceptable for an ISO 14583 pan head screw with a flat tip end" (N) and "Thread ridges … appear very pronounced … suggesting the thread geometry may be exaggerated, though this is difficult to confirm" (c). Score 7 every time.
- Other (N): "which is consistent with the spec; however the bottom view shows the lid has a solid flat bottom face … which is correct" (`1bd3765e-…`); "the peg placement … matches the geometric specification" (`d2b36f40-…`); "though the front/back triangular profiles do confirm the wedge geometry exists" (`f3056e6f-…`).

### Holistic (c, 12) and domain-knowledge (K, 4)

All 12 (c) issues are hedged. Ten are the screw-thread "exaggerated / stacked rings / may be a rendering artifact" family and unexpected tip geometry on the same prompt; the other two are "cage geometry may be dominating over the ball geometry" (`5bf39c0c-…`) and the bottle shoulder "single convex dome arc rather than an S-curve … may not fully represent a realistic bottle shoulder" (`e1b58595-…`) — where the spec explicitly allows "S-curve or convex arc". (K): Gridfinity 5×1 bin whose bottom shows a 2×2 base-cell pattern (`8d2ec9e8-…`); "concave notch … atypical for a standard electric guitar body upper bout" (`06115f11-…`); "front face with the aperture is the top face in the render" (`1fb0e3b7-…`, where the spec puts the aperture on +Z); a screw tip "with no chamfer or taper" (`a524d933-…`).

### What the checklist looked like when this happened

Strict set (81 evaluations): checklist length 1 → 34 evaluations, 2 → 9, 3 → 10, 4 → 14, 5 → 11, 6 → 3. 28 of 81 were scored against the fallback `verification_checklist` because no criterion survived.

The 34 single surviving questions are: "single solid body / no disconnected geometry / manifold" ×14; a Z=0 datum or shared centroid ("both parts rest on the same flat plane", "no geometry intersects Z < 0") ×7; a symmetry or mirror statement ×4; "top face is open" ×3; "no fillet or chamfer on any edge" ×2; and four others (solid cylinder with flat faces, coaxial surfaces, hex-head chamfer, "two planar circular faces and one conical face"). None asks about the count, placement or presence of a requested feature.

Population (all 1,458 evaluations, criteria as currently stored on the prompt):

| | Production (1,333) | Experiment (125) |
|---|---:|---:|
| criteria on the prompts | 7,827 | 744 |
| survive `deriveVisualChecklist()` | 2,170 (27.7%) | 77 (10.3%) |
| dropped by the dimension regex only | 4,057 | 622 |
| dropped by `visibility: "code"` only | 102 | 1 |
| dropped by both | 1,498 | 44 |
| evaluations that fell back to `verification_checklist` | 351 (26.3%) | 85 (68.0%) |
| checklist length actually shown = 1 | 290 (21.8%) | 16 (12.8%) |
| strict all-pass evaluations with score < 7.5, by shown length | 1: 27/262 (10.3%) · 2: 8/284 (2.8%) · 3: 10/314 (3.2%) · 4: 12/163 (7.4%) · 5: 9/87 (10.3%) · 6: 2/6 | 1: 7/12 · 2: 1/12 · 3: 0/10 · 4: 2/6 · 5: 2/10 · 6: 1/3 |

Single-item checklists are 21.8% of production evaluations but 40% (27/68) of the production qualifying set; in the experiment, 7 of the 12 single-item all-pass evaluations scored below 7.5.

## What this means for checklist coverage

- The gap is overwhelmingly on the (b) side, not (a): 74 of 147 issues (and 50 of 81 evaluations) enforce a requirement that *was* written into `verification_criteria` and was deleted before the judge saw it. Only 3 distinct prompt requirements in the whole set were never captured by any criterion (colour, hemisphere-vs-sphere, a rim lip).
- The dimension regex is the deleting mechanism in 73 of the 74 (b) cases; `visibility: "code"` alone accounts for 1. Across the population it removes 71% of production criteria and 90% of experiment criteria, because enriched criteria arrive as bare strings (`visibility: "both"`) that bundle counts, placements and openness with millimetre values in one sentence.
- What survives is not feature coverage: in the strict set the single surviving question is a topology/datum/symmetry statement in 30 of 34 cases. An evaluation can therefore pass its entire checklist without a single requested feature having been asked about.
- 47 of the 74 (b) requirements are also stated in the prompt — counts (11), proportions (16) and profile/edge/orientation details — so the judge's issues are recoverable from the prompt alone in those cases; the other 27 (b) and all 11 (S) requirements exist only because spec generation/enrichment invented a default (closed floors, hollow interiors, hole positions, barb notches, "all edges sharp"), and the judge treats the spec block as authoritative ("as specified").
- 38 of 147 issues (26%) are not requirement gaps at all: 16 contradict a checklist item the same response marked pass, and 22 concede correctness in their own text. 51 of 147 issues are hedged. The score still dropped in every one of these evaluations.
- Sixteen of the 46 prompt-stated gaps are the judge estimating a stated dimension by eye (groove depth, fillet radius, pocket size, handle height) — the very judgement the filter and the prompt tell it not to make.

## Caveats

- Classification is one reader's reading of 147 free-text issues against prompt, criteria and spec; the appendix gives a one-line justification per issue so any label can be contested. Three were left uncertain rather than forced.
- The strict set is concentrated: 63 distinct prompts, 74 distinct examples; 7 examples appear in both sources; one prompt (the M4 Torx screw) contributes 8 evaluations and 22 issues, and the panel-mount socket housing 4 evaluations.
- Population filter statistics use the criteria currently stored on `workbench_example_prompts`. For the 81 classified evaluations the replication matched the stored checklist exactly, so those criteria are what produced the shown checklist; for the rest of the population this was not individually verified. Shown-length counts come from the stored `eval_checklist_results` and are exact.
- `visual_score` here is the VLM score; 45 of the 81 evaluations still have a composite `eval_score ≥ 7.5` (43 are `auto_approved`), so "penalised" means the visual score, not necessarily the gate.
- The experiment arm re-scored examples that already had a production score; where both qualify they are counted twice (7 examples), because they are separate evaluations of the same images.

## Appendix: per-issue classification

Columns: Row (index in the strict candidate set), Source, Example id, VLM score, Issue index within `issues`, Class, Type, In prompt (requirement explicitly stated in the prompt), Hedged, Dup (restates another issue on the same evaluation), Note (where the requirement was found / why the class).
| Row | Source | Example id | Score | Issue | Class | Type | In prompt | Hedged | Dup | Note |
|---:|---|---|---:|---:|:-:|---|:-:|:-:|:-:|---|
| 0 | exp | `3a1d8a51-3cc0-4ece-8d2f-f81a580b043b` | 3 | I0 | B | presence | y |  |  | lid must be plain; criterion "lid ... no holes, slots, or surface features" dropped by dim filter |
| 0 | exp | `3a1d8a51-3cc0-4ece-8d2f-f81a580b043b` | 3 | I1 | B | count | y |  |  | four standoffs; criterion "Each of the four standoff cylinders ... 5.0mm" dropped by dim filter |
| 0 | exp | `3a1d8a51-3cc0-4ece-8d2f-f81a580b043b` | 3 | I2 | B | count | y |  |  | two port cutouts; criterion dropped by dim filter |
| 0 | exp | `3a1d8a51-3cc0-4ece-8d2f-f81a580b043b` | 3 | I3 | B | proportion | y |  |  | box proportion vs 73x38x25; dimension-by-eye |
| 1 | exp | `9294339f-8630-4cd6-9169-9d9608682d26` | 4 | I0 | B | count | y |  |  | four standoffs (B01 four-hole); criterion dropped by dim |
| 1 | exp | `9294339f-8630-4cd6-9169-9d9608682d26` | 4 | I1 | B | count | y |  |  | four port cutouts; criterion dropped by dim |
| 1 | exp | `9294339f-8630-4cd6-9169-9d9608682d26` | 4 | I2 | S | placement |  |  |  | fan opening offset 10mm toward SoC exists only in the Geometric Specification |
| 1 | exp | `9294339f-8630-4cd6-9169-9d9608682d26` | 4 | I3 | A | color | y |  |  | charcoal grey base / silver-grey lid stated in prompt; no criterion or checklist item; STL renders carry no colour |
| 2 | exp | `427d888e-61ec-4ce5-b46e-85457cd8a4a7` | 6 | I0 | B | surface |  |  |  | stacking lip profile; criterion "0.8mm chamfer + 1.8mm recess" dropped by dim; prompt says only "frame-style blocks" |
| 2 | exp | `427d888e-61ec-4ce5-b46e-85457cd8a4a7` | 6 | I1 | B | surface |  |  | y | duplicate of I0 |
| 3 | exp | `f1265633-7686-4fb3-867e-130fa7087bf0` | 6 | I0 | B | count | y |  |  | four keyhole slots; criterion "Exactly 4 keyhole-shaped through-holes" dropped by dim |
| 3 | exp | `f1265633-7686-4fb3-867e-130fa7087bf0` | 6 | I1 | B | count | y |  | y | duplicate of I0 |
| 4 | exp | `1bd3765e-73a4-48d7-a81e-0c0062463e7f` | 7 | I0 | B | proportion |  | y |  | ledge protrusion magnitude (3mm) from spec/criteria; prompt gives 2mm height only; judge confirms step exists |
| 4 | exp | `1bd3765e-73a4-48d7-a81e-0c0062463e7f` | 7 | I1 | N | orientation |  |  |  | text concludes "this is consistent with the spec ... which is correct" |
| 4 | exp | `1bd3765e-73a4-48d7-a81e-0c0062463e7f` | 7 | I2 | N | assembly |  |  |  | text concludes "both parts appear to share the same inner wall footprint correctly" |
| 5 | exp | `239c0c78-1e34-420f-9939-8d30d981bbb9` | 7 | I0 | B | proportion | y |  |  | lip height 5mm vs 3mm plate; criteria with Z ranges dropped by dim; presence passed in checklist |
| 5 | exp | `239c0c78-1e34-420f-9939-8d30d981bbb9` | 7 | I1 | B | presence |  | y |  | barb notch on clip tabs; only in criteria/spec; criterion dropped by dim |
| 6 | exp | `29675811-f800-432b-9d06-3c169d2ea596` | 7 | I0 | B | openness |  |  |  | closed floor; criterion "confirming 5mm floor" dropped by dim; prompt says "5mm walls" only |
| 6 | exp | `29675811-f800-432b-9d06-3c169d2ea596` | 7 | I1 | B | edge_treatment |  | y |  | 1mm chamfers; criterion dropped by dim; judge says "may be present but too subtle" |
| 7 | exp | `485cf1ba-1263-4b11-914c-f6e2b44431a7` | 7 | I0 | X | count | y | y |  | checklist "exactly 4 standoff bosses" and "at four corners" both passed; issue says only one visible |
| 8 | exp | `9e046db1-91cf-4081-97eb-1667a9606344` | 7 | I0 | S | placement |  | y |  | encoder right of LCD / buttons left is only in the Geometric Specification |
| 8 | exp | `9e046db1-91cf-4081-97eb-1667a9606344` | 7 | I1 | X | count | y |  |  | checklist "exactly two circular button holes" passed; issue says only one visible in front view |
| 9 | exp | `c97ce502-be5e-4ea7-a57b-e5baaf3d5aa1` | 7 | I0 | B | openness |  | y |  | closed bottom; criterion "3mm wall thickness on all six faces" dropped by dim; judge says bottom view shows solid face |
| 10 | exp | `e4ddb8e2-1647-4d92-96d6-e1dff1d6374c` | 7 | I0 | B | assembly | y |  |  | two distinct tabs on opposite sides; criterion "two mounting tabs ... each 8mm" dropped by dim |
| 11 | exp | `f5168729-4324-44bb-bf0c-c2cf76366163` | 7 | I0 | B | placement |  |  |  | terminal hole positions ±72.5mm only in criteria/spec; prompt gives no placement |
| 12 | exp | `fea1a4fa-d9c8-4872-b725-aab1426740f4` | 7 | I0 | X | placement | y | y |  | checklist "rectangular cutout on the top edge" passed; issue says it may be on the bottom or duplicated |
| 12 | exp | `fea1a4fa-d9c8-4872-b725-aab1426740f4` | 7 | I1 | N | count | y |  |  | checklist "exactly two button cutouts" passed; issue ends "placement ... appears correct overall" |
| 13 | prod | `a2543f23-2c62-41bc-9125-70f69daccd64` | 3 | I0 | B | profile_shape | y |  |  | L-shaped leaf profile; criterion "arm extends exactly 25mm perpendicular ... 3mm wall" dropped by dim |
| 13 | prod | `a2543f23-2c62-41bc-9125-70f69daccd64` | 3 | I1 | B | count | y |  |  | five knuckles; criterion "exactly 5 cylindrical knuckles ... 8mm" dropped by dim |
| 13 | prod | `a2543f23-2c62-41bc-9125-70f69daccd64` | 3 | I2 | B | orientation | y |  |  | barrel axis vertical along 100mm leaf height; criterion "100mm in the Z (height)" dropped by dim |
| 13 | prod | `a2543f23-2c62-41bc-9125-70f69daccd64` | 3 | I3 | B | profile_shape | y |  | y | duplicate of I0 (offset arm) |
| 14 | prod | `3a1d8a51-3cc0-4ece-8d2f-f81a580b043b` | 4 | I0 | B | count | y |  |  | four standoffs; as row 0 |
| 14 | prod | `3a1d8a51-3cc0-4ece-8d2f-f81a580b043b` | 4 | I1 | B | presence | y |  |  | plain lid; as row 0 |
| 14 | prod | `3a1d8a51-3cc0-4ece-8d2f-f81a580b043b` | 4 | I2 | B | count | y |  |  | two cutouts; as row 0 |
| 15 | prod | `9294339f-8630-4cd6-9169-9d9608682d26` | 5 | I0 | B | count | y |  |  | four standoffs; as row 1 |
| 15 | prod | `9294339f-8630-4cd6-9169-9d9608682d26` | 5 | I1 | B | count | y |  |  | four cutouts; as row 1 |
| 15 | prod | `9294339f-8630-4cd6-9169-9d9608682d26` | 5 | I2 | A | color | y |  |  | as row 1 |
| 16 | prod | `1bd07a18-e31f-470d-a3ce-95bde97d570e` | 6 | I0 | B | presence | y |  |  | two M3 holes; criterion "two small holes ... 3.2mm ... X=±18.5mm" dropped by dim |
| 17 | prod | `247346bb-85ce-40ee-a3b7-cc39a5c5d15d` | 6 | I0 | B | placement | y |  |  | ring and flange share bottom plane ("flush with the bottom"); criterion "share the Z=0 bottom plane ... 10mm/3mm" dropped by dim |
| 17 | prod | `247346bb-85ce-40ee-a3b7-cc39a5c5d15d` | 6 | I1 | N | assembly |  |  |  | text concedes "the spec calls for a union so this may be acceptable" |
| 18 | prod | `2fe78704-7bdd-4451-b075-866d8b826a68` | 6 | I0 | B | edge_treatment | y |  |  | chamfered start; criterion "Lead chamfer geometry ... 8.0mm ... 6.647mm" dropped by dim |
| 18 | prod | `2fe78704-7bdd-4451-b075-866d8b826a68` | 6 | I1 | B | surface | y |  |  | thread fade-out; criterion "Thread runout ... 2.5mm" dropped by dim |
| 18 | prod | `2fe78704-7bdd-4451-b075-866d8b826a68` | 6 | I2 | B | edge_treatment | y |  | y | restates I0+I1 |
| 19 | prod | `3df30fa3-b1ae-4992-a4bd-2ae782fec689` | 6 | I0 | S | assembly |  |  |  | "fused into a single connected solid" exists only in the Geometric Specification; with 15mm/10mm discs 30mm apart the prompt geometry cannot touch |
| 20 | prod | `8040e46d-a5bc-4107-bff8-1917034fbbb7` | 6 | I0 | A | profile_shape | y |  |  | hemisphere (not full sphere) is in the prompt; criteria are bounding-box/junction dims and do not encode it; the spec itself describes a full Sphere |
| 20 | prod | `8040e46d-a5bc-4107-bff8-1917034fbbb7` | 6 | I1 | A | profile_shape | y |  | y | duplicate of I0 |
| 21 | prod | `b888a414-ce4f-41b9-892d-cf7658617bdc` | 6 | I0 | B | proportion | y |  |  | 15mm groove depth on 80mm wheel; criterion "Groove depth equals 15mm" is code+dim; dimension-by-eye |
| 21 | prod | `b888a414-ce4f-41b9-892d-cf7658617bdc` | 6 | I1 | B | proportion | y |  | y | duplicate of I0 |
| 22 | prod | `ca9d866e-143d-47d5-b021-69eb2a4b789b` | 6 | I0 | B | openness |  |  |  | closed bottom; criterion "bottom face must be a fully closed solid rectangle of 120mm × 80mm" dropped by dim |
| 23 | prod | `da20d169-5dfd-4d0d-9eb9-0b3730e94b29` | 6 | I0 | S | placement |  |  |  | front keyhole at Z=+15 to avoid lens hole exists only in the Geometric Specification |
| 23 | prod | `da20d169-5dfd-4d0d-9eb9-0b3730e94b29` | 6 | I1 | S | placement |  |  | y | duplicate of I0 |
| 24 | prod | `e482cc92-dbe4-4532-b7b9-10b1cd212996` | 6 | I0 | B | presence |  |  |  | slot/rail channel in the tab; criterion "slot feature at least 5mm deep" dropped by dim |
| 24 | prod | `e482cc92-dbe4-4532-b7b9-10b1cd212996` | 6 | I1 | B | openness |  | y |  | grommet holes through the floor; criterion "pass fully through the tray floor ... 6mm" dropped by dim |
| 24 | prod | `e482cc92-dbe4-4532-b7b9-10b1cd212996` | 6 | I2 | B | presence |  | y |  | lid perimeter lip; criterion "3mm base + 3mm lip" dropped by dim; prompt never describes the lid |
| 25 | prod | `f1265633-7686-4fb3-867e-130fa7087bf0` | 6 | I0 | B | count | y |  |  | four keyholes; as row 3 |
| 25 | prod | `f1265633-7686-4fb3-867e-130fa7087bf0` | 6 | I1 | B | count | y |  | y | duplicate of I0 |
| 26 | prod | `01c0e9f0-4ece-4144-8b6d-7126c4c9c50d` | 7 | I0 | X | proportion | y |  |  | checklist "S-curve body is filled and thick, not a thin line" passed; issue says thin strip |
| 26 | prod | `01c0e9f0-4ece-4144-8b6d-7126c4c9c50d` | 7 | I1 | X | profile_shape |  |  |  | checklist "terminal ends taper or terminate in a decorative tip" passed; issue says no taper |
| 27 | prod | `048427d5-0ba9-4785-b107-f8bf79a1a9ce` | 7 | I0 | N | proportion | y | y |  | text ends "this may simply be a rendering scale issue"; step is geometrically per spec |
| 27 | prod | `048427d5-0ba9-4785-b107-f8bf79a1a9ce` | 7 | I1 | N | proportion | y |  |  | text says "geometrically correct but visually marginal" |
| 28 | prod | `06115f11-17f8-4dcb-be9f-3e970522ca06` | 7 | I0 | X | symmetry |  | y |  | checklist "Two symmetric horn-like protrusions" passed; issue says asymmetric "may be viewing angle" |
| 28 | prod | `06115f11-17f8-4dcb-be9f-3e970522ca06` | 7 | I1 | K | profile_shape |  |  |  | convex upper bout "typical for a standard electric guitar body"; stated nowhere |
| 29 | prod | `0651f3f3-08e5-45c3-9c4d-5366947ac341` | 7 | I0 | B | openness |  |  |  | knockout as 1mm membrane not through-hole; criterion "knockout membranes ... 1.0mm" dropped by dim; prompt says "knockouts" |
| 30 | prod | `068ec54f-45ee-403e-824c-cce88d0b18fe` | 7 | I0 | N | profile_shape |  | y |  | flat tip "may be acceptable for an ISO 14583 pan head screw" |
| 30 | prod | `068ec54f-45ee-403e-824c-cce88d0b18fe` | 7 | I1 | C | proportion |  | y |  | thread ridges "exaggerated ... may be a rendering artifact"; no stated requirement |
| 30 | prod | `068ec54f-45ee-403e-824c-cce88d0b18fe` | 7 | I2 | B | presence |  | y |  | boss on bearing face; criterion "bearing face is a flat annular surface ... 4.0mm/8.0mm" dropped by dim |
| 31 | prod | `0a384a35-c4d4-449a-8570-3cd87061c9f6` | 7 | I0 | N | profile_shape |  | y |  | as row 30 I0 |
| 31 | prod | `0a384a35-c4d4-449a-8570-3cd87061c9f6` | 7 | I1 | C | proportion |  | y |  | as row 30 I1 |
| 31 | prod | `0a384a35-c4d4-449a-8570-3cd87061c9f6` | 7 | I2 | N | edge_treatment |  |  |  | "acceptable for ISO machine screws but worth noting" |
| 32 | prod | `0d4529e1-524b-40cf-a512-fad48852b72a` | 7 | I0 | B | placement | y | y |  | 2×2 pin arrangement per end; criterion with X/Y coordinates dropped by dim; judge sees 8 holes, questions layout, "may be a resolution limitation" |
| 32 | prod | `0d4529e1-524b-40cf-a512-fad48852b72a` | 7 | I1 | B | placement |  |  |  | M3 holes on centreline Y=0; criterion dropped by dim; prompt gives no placement |
| 33 | prod | `10513fd9-148d-4ea5-921c-80273f965f3c` | 7 | I0 | N | profile_shape |  | y |  | as row 30 I0 |
| 33 | prod | `10513fd9-148d-4ea5-921c-80273f965f3c` | 7 | I1 | C | proportion |  | y |  | as row 30 I1 |
| 33 | prod | `10513fd9-148d-4ea5-921c-80273f965f3c` | 7 | I2 | C | presence |  | y |  | boss/protrusion at shank tip "may indicate an artifact"; stated nowhere |
| 34 | prod | `1d3cb76d-c164-4b52-b9b7-0dda165ab749` | 7 | I0 | B | edge_treatment | y |  |  | sharp 90° bottom corner; criterion has visibility "code" — the only pure code-visibility drop in the set |
| 35 | prod | `1ede152b-73ed-45e5-9968-4be08b796a29` | 7 | I0 | X | presence | y | y |  | checklist "cylindrical boss is visible protruding inward" passed; issue says barely visible |
| 36 | prod | `1f0f342e-479e-49a5-acf5-1887b5742e83` | 7 | I0 | B | openness |  |  |  | open top vs open bottom; criterion "Top face must be fully open (no solid material at Z=+20mm)" dropped by dim; this prompt never says "open top" |
| 37 | prod | `1fb0e3b7-3d7a-43ec-841a-14afd9f7bdd1` | 7 | I0 | X | presence | y | y |  | checklist "large rectangular opening visible on the front face" passed; issue says front face appears mostly solid |
| 37 | prod | `1fb0e3b7-3d7a-43ec-841a-14afd9f7bdd1` | 7 | I1 | K | orientation |  |  |  | expects the aperture to face the viewer in the front view; the spec puts the aperture on +Z; stated nowhere |
| 38 | prod | `239c0c78-1e34-420f-9939-8d30d981bbb9` | 7 | I0 | B | proportion | y |  |  | as row 5 I0 |
| 38 | prod | `239c0c78-1e34-420f-9939-8d30d981bbb9` | 7 | I1 | B | presence |  | y |  | as row 5 I1 |
| 39 | prod | `24094ee2-9555-416b-b1fb-b783642dc587` | 7 | I0 | B | proportion | y |  |  | 5mm groove width; criterion "Groove width is 5mm" is code+dim; dimension-by-eye |
| 39 | prod | `24094ee2-9555-416b-b1fb-b783642dc587` | 7 | I1 | S | openness |  | y |  | "closed bottom" shell exists only in the Geometric Specification; prompt says "with a shell" |
| 40 | prod | `384b0bc1-ad51-4864-87da-ab84ed3ae8a0` | 7 | I0 | X | presence | y | y |  | as row 37 I0 |
| 40 | prod | `384b0bc1-ad51-4864-87da-ab84ed3ae8a0` | 7 | I1 | B | proportion | y |  |  | aperture 50×30 on 80×50 face leaves a border; criterion "leaving a 15mm border ..." dropped by dim |
| 41 | prod | `3acf4710-7a9d-4563-81d5-79392f0e7607` | 7 | I0 | U | placement |  | y |  | uncertain B (centred aperture, criterion dropped by dim) vs K (judge-assumed orientation) |
| 41 | prod | `3acf4710-7a9d-4563-81d5-79392f0e7607` | 7 | I1 | X | presence | y |  |  | as row 37 I0 |
| 41 | prod | `3acf4710-7a9d-4563-81d5-79392f0e7607` | 7 | I2 | B | proportion | y |  |  | as row 40 I1 |
| 42 | prod | `3d92cf2d-5ff5-4b4f-a494-e9837b94c1b3` | 7 | I0 | N | profile_shape |  | y |  | as row 30 I0 |
| 42 | prod | `3d92cf2d-5ff5-4b4f-a494-e9837b94c1b3` | 7 | I1 | C | surface |  | y |  | thread coverage near tip "may indicate incomplete"; prompt says only "visible threads" |
| 43 | prod | `43b66189-154e-46bb-8bde-424ed8b7ac83` | 7 | I0 | B | placement |  |  |  | back opening flush with floor; criterion "lower edge coinciding with Z = −40" dropped by dim; prompt gives no placement |
| 44 | prod | `485cf1ba-1263-4b11-914c-f6e2b44431a7` | 7 | I0 | X | count | y | y |  | as row 7 |
| 44 | prod | `485cf1ba-1263-4b11-914c-f6e2b44431a7` | 7 | I1 | X | placement | y |  |  | checklist "standoffs located at the four interior corners" passed; issue says clustered near one corner |
| 45 | prod | `515de8fa-e498-41ed-9e37-6550f4cf9130` | 7 | I0 | B | proportion | y |  |  | 8mm top fillet on 40×60 cylinder; criterion "Top edge fillet radius is 8mm" is code+dim; dimension-by-eye |
| 45 | prod | `515de8fa-e498-41ed-9e37-6550f4cf9130` | 7 | I1 | X | proportion | y |  |  | checklist "Top edge is visibly more rounded than the bottom edge" passed; issue says asymmetry not distinct |
| 46 | prod | `52e9bc69-2d09-46a9-ade8-8a4ce563737a` | 7 | I0 | B | presence |  |  |  | ISO 4026 flat point; criterion "flat circular region of approximately 2.0mm diameter" dropped by dim |
| 46 | prod | `52e9bc69-2d09-46a9-ade8-8a4ce563737a` | 7 | I1 | B | edge_treatment |  |  |  | 0.2mm end chamfers; criterion dropped by dim; invisible at render scale |
| 47 | prod | `5ac6a5be-be01-46b2-ab5b-3b69a21027f4` | 7 | I0 | X | count | y | y |  | checklist "four cylindrical standoff posts ... at the corners" passed; issue says only 2 clearly visible, "uncertain" |
| 48 | prod | `5baa9037-602c-42aa-9407-ae0f52bae91e` | 7 | I0 | N | profile_shape |  | y |  | as row 30 I0 |
| 48 | prod | `5baa9037-602c-42aa-9407-ae0f52bae91e` | 7 | I1 | C | proportion |  | y |  | as row 30 I1 |
| 48 | prod | `5baa9037-602c-42aa-9407-ae0f52bae91e` | 7 | I2 | C | presence |  | y |  | recess/chamfer at tip "geometry is ambiguous"; stated nowhere |
| 49 | prod | `5bf39c0c-c340-4c51-94fc-6866dead26c5` | 7 | I0 | N | presence |  |  |  | balls "only visible from top/bottom views" — checklist "single row of spherical balls visible" passed; no mismatch asserted |
| 49 | prod | `5bf39c0c-c340-4c51-94fc-6866dead26c5` | 7 | I1 | U | profile_shape |  |  |  | uncertain B (criterion "7 pockets ... pocket diameter ≥ 2.0mm" dropped by dim implies circular pockets) vs K ("typical bearing cage") |
| 49 | prod | `5bf39c0c-c340-4c51-94fc-6866dead26c5` | 7 | I2 | C | proportion |  | y |  | "cage geometry may be dominating over the ball geometry" |
| 50 | prod | `60ca1ffa-fb29-47b5-8ec2-95644f9f25d0` | 7 | I0 | B | proportion | y |  |  | 15mm deep groove on 80mm wheel; criterion "V-groove depth is 15mm" is code+dim; dimension-by-eye |
| 51 | prod | `62d68a8a-bed0-468e-a270-34986cab6afd` | 7 | I0 | S | edge_treatment |  |  |  | "All edges remain sharp" exists only in the Geometric Specification |
| 52 | prod | `633db300-6299-4442-96ed-09f5d278368b` | 7 | I0 | B | proportion | y | y |  | 80mm depth vs 300mm diameter; criteria with z=−80mm dropped by dim; dimension-by-eye |
| 52 | prod | `633db300-6299-4442-96ed-09f5d278368b` | 7 | I1 | B | symmetry | y | y |  | lowest point on axis, tangent arrival; criterion "at r=0 ... tangent to the z-axis" dropped by dim |
| 53 | prod | `69d841c3-ad29-4db5-adb4-158a29b35f52` | 7 | I0 | B | proportion | y |  |  | handle 15mm taller than 10mm disc; criterion "radius 40mm (height 10mm) ... radius 10mm (height 15mm)" dropped by dim |
| 54 | prod | `6edac583-ea27-4ffa-95cf-4e154c240911` | 7 | I0 | U | symmetry | y |  |  | uncertain A ("teardrop profile" is stated) vs K (symmetry is a property of the named shape, not stated) |
| 55 | prod | `729b9b29-791a-44e8-9ed0-5c50fd661199` | 7 | I0 | A | surface | y |  |  | "2mm rim lip" stated in prompt; criteria list diameters only and do not encode the lip; checklist has no rim item |
| 56 | prod | `7d442248-3cf7-4747-8725-da3f934cdf15` | 7 | I0 | B | proportion | y | y |  | 12mm tall vs 80mm dia; fallback checklist item "Is the lid 12mm tall?" dropped by dim; "could be a rendering scale issue" |
| 56 | prod | `7d442248-3cf7-4747-8725-da3f934cdf15` | 7 | I1 | N | proportion | y |  |  | "consistent with the 2mm rim thickness" |
| 57 | prod | `8b44b042-e313-419e-86bf-f4558d6e5ebd` | 7 | I0 | B | openness |  |  |  | hollow box; criterion "Wall thickness is 2mm on all sides" is code+dim; prompt never says hollow; spec marks 2mm walls as "default, not specified in prompt" |
| 58 | prod | `8d2ec9e8-3e54-46ff-9075-a34a711d204c` | 7 | I0 | K | count |  |  |  | 5×1 base-cell pattern on the bottom; Gridfinity domain knowledge; stated nowhere (spec describes base chamfer only) |
| 59 | prod | `931f5865-ab3a-40ee-a18d-7a657f8e4d85` | 7 | I0 | B | proportion | y |  |  | 12mm hemisphere pockets on 20mm tube; criterion "circular opening of diameter=12mm" dropped by dim; checklist "three pockets visible" passed |
| 60 | prod | `96fd4040-816e-4123-8172-22b54369b7e1` | 7 | I0 | B | openness |  |  |  | through-bore open at both ends; criterion "confirming through-bore continuity ... 20mm" dropped by dim; prompt says "20mm bore" |
| 61 | prod | `9d741de7-fbff-44bf-88b4-c5561576d233` | 7 | I0 | S | profile_shape |  |  |  | "widest point roughly one-third from the nose" exists only in the Geometric Specification; prompt says rounded front, pointed tail |
| 62 | prod | `9e046db1-91cf-4081-97eb-1667a9606344` | 7 | I0 | S | placement |  | y |  | as row 8 I0 |
| 62 | prod | `9e046db1-91cf-4081-97eb-1667a9606344` | 7 | I1 | X | count | y |  |  | as row 8 I1 |
| 63 | prod | `a1173c67-3ec7-4763-b1dd-ee6a899fd0c3` | 7 | I0 | S | surface |  |  |  | unthreaded grip shank per ISO 4014 is in the Geometric Specification; criterion says "at least 22mm" which full thread satisfies |
| 64 | prod | `a42b6b1e-a042-4c3a-8e51-0ebb96059e58` | 7 | I0 | B | placement |  |  |  | display cutout centred; criterion "centered at X = 0, Z = 0" dropped by dim; prompt gives no placement |
| 65 | prod | `a524d933-e02e-4974-aaad-1afd330e5923` | 7 | I0 | N | profile_shape |  | y |  | as row 30 I0 |
| 65 | prod | `a524d933-e02e-4974-aaad-1afd330e5923` | 7 | I1 | C | proportion |  | y |  | as row 30 I1 |
| 65 | prod | `a524d933-e02e-4974-aaad-1afd330e5923` | 7 | I2 | K | edge_treatment |  |  |  | tip chamfer expected of a machine screw; stated nowhere; no concession this time |
| 66 | prod | `a70d1491-0f7e-491c-9796-176a3d02c5ee` | 7 | I0 | N | profile_shape |  | y |  | as row 30 I0 |
| 66 | prod | `a70d1491-0f7e-491c-9796-176a3d02c5ee` | 7 | I1 | C | proportion |  | y |  | as row 30 I1 |
| 67 | prod | `ac70ac4c-cf41-4849-8dff-104810b75965` | 7 | I0 | B | openness | y | y |  | hollow with 3mm walls; criteria "Wall thickness check ... 3mm" / "Interior cavity 94mm × 74mm × 17mm" dropped by dim; spec has a closed bottom so a solid-looking bottom is expected |
| 68 | prod | `b8f34911-02d4-47b0-aae2-76ab18a33d3b` | 7 | I0 | X | profile_shape | y |  |  | checklist "round loop/eye head at the closed end" passed; issue says solid bump, not an eye |
| 68 | prod | `b8f34911-02d4-47b0-aae2-76ab18a33d3b` | 7 | I1 | B | proportion |  |  |  | loop outer diameter 12mm; criterion dropped by dim; prompt says only "round head" |
| 69 | prod | `ca56944c-515d-4c2e-9912-bfd875b6660c` | 7 | I0 | N | proportion | y | y |  | "though the 45° views confirm the correct conical shape" |
| 70 | prod | `d246ed87-4071-4725-826c-06bd42e49891` | 7 | I0 | B | proportion | y | y |  | as row 59 |
| 71 | prod | `d2b36f40-30f2-4583-b742-b01c9a3aa52f` | 7 | I0 | N | placement |  |  |  | "which matches the geometric specification" |
| 72 | prod | `d4bea35c-cf04-44a9-9519-d63eb2be2d27` | 7 | I0 | N | profile_shape |  | y |  | as row 30 I0 |
| 72 | prod | `d4bea35c-cf04-44a9-9519-d63eb2be2d27` | 7 | I1 | C | surface |  | y |  | threads as stacked rings vs helix "may be a rendering/resolution artifact" |
| 72 | prod | `d4bea35c-cf04-44a9-9519-d63eb2be2d27` | 7 | I2 | B | presence |  |  |  | as row 30 I2 |
| 73 | prod | `d78892bf-c183-459b-85c5-813f4ed11abe` | 7 | I0 | B | placement |  |  |  | even hole spacing; criterion "uniform spacing of 16.6667mm" dropped by dim; prompt says "1×5 row"; note the blade is 100 of 220mm so holes in one half is correct |
| 74 | prod | `e1b58595-003e-4d72-b4e1-968a32dd6ac7` | 7 | I0 | S | openness |  |  |  | hollow bottle with open neck exists only in the Geometric Specification (marked "default") |
| 74 | prod | `e1b58595-003e-4d72-b4e1-968a32dd6ac7` | 7 | I1 | C | profile_shape |  | y |  | S-curve vs convex shoulder; spec allows "S-curve or convex arc"; judge invokes "realistic bottle shoulder" |
| 75 | prod | `e4ddb8e2-1647-4d92-96d6-e1dff1d6374c` | 7 | I0 | B | assembly | y |  |  | as row 10 |
| 76 | prod | `e4e72573-2e12-4394-ba72-435299ce7b9d` | 7 | I0 | B | proportion | y |  |  | 30×5 slot aspect ratio; criterion "Each slot is 30mm long × 5mm wide" is code+dim |
| 77 | prod | `e594a1d2-2f16-4280-a644-8f69772b5a20` | 7 | I0 | N | profile_shape |  |  |  | "which is acceptable" |
| 77 | prod | `e594a1d2-2f16-4280-a644-8f69772b5a20` | 7 | I1 | N | presence |  | y |  | angled views do not show all faces; no mismatch asserted; checklist "exactly 4 slots" per face passed |
| 77 | prod | `e594a1d2-2f16-4280-a644-8f69772b5a20` | 7 | I2 | B | openness |  | y |  | through-hole in the gland boss; criterion "coaxial through-hole of diameter 8mm" dropped by dim; prompt says "15mm cable gland boss" |
| 78 | prod | `ea5d48aa-2b28-4c67-af92-a6eea7c45445` | 7 | I0 | B | orientation | y |  |  | 45° diagonal hole grid; criterion "Hole pattern is visibly diagonal (rows of holes oriented at 45 degrees ...)" has visibility "visual" but is dropped by the dimension regex on "45 degrees" |
| 79 | prod | `f3056e6f-f7cd-466f-8a40-7a1a852a2277` | 7 | I0 | N | proportion | y | y |  | "though the front/back triangular profiles do confirm the wedge geometry exists"; 10mm over 120mm is subtle by construction |
| 80 | prod | `f4981c80-2cc9-4faf-a96b-70a08c9ad022` | 7 | I0 | B | proportion | y |  |  | as row 40 I1 |
