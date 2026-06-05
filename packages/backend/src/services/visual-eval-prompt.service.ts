/**
 * Visual Evaluation System Prompt Builder
 *
 * Constructs the system prompt for VLM evaluation of 3D model screenshots.
 */
import type { EvalPlan } from "../utils/eval-plan.js";

const ANGLE_DISPLAY_NAMES: Record<string, string> = {
  front: "front",
  back: "back",
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
  ortho_45: "a 45° down view",
  ortho_45_bottom: "a 45° up view",
  isometric: "isometric",
};

function buildViewDescription(providedAngles?: string[]): string {
  if (!providedAngles || providedAngles.length === 0) {
    return "You are provided labeled views: front, back, left, right, top, bottom, a 45° down view, and a 45° up view.\nTogether these cover all six faces of the model plus two complementary 3D overviews (from above and below).";
  }
  const names = providedAngles.map(a => ANGLE_DISPLAY_NAMES[a] ?? a);
  return `You are provided ${names.length} labeled views: ${names.join(", ")}.\nThese views were selected to best show the key features of this model.`;
}

export interface BuildEvalPromptOptions {
  userPrompt: string;
  categoryName: string;
  complexity: number;
  checklist: string[];
  hasZoomTool: boolean;
  providedAngles: string[];
  constructionSpec: string;
  evalPreamble: string;
  evalPlan: EvalPlan | null;
}

export function buildEvaluationSystemPrompt(opts: BuildEvalPromptOptions): string {
  if (opts.evalPlan?.systemPrompt) {
    return [
      buildStaticHeader(opts),
      opts.evalPlan.systemPrompt,
      buildStaticFooter(opts),
    ].filter(Boolean).join("\n\n");
  }
  return buildLegacyPrompt(opts);
}

// ── Static scaffolding used by the dynamic path ───────────────────────

/**
 * Universal scaffolding: role, image-list description, projection/STL/view
 * caveats. Category- and prompt-agnostic content that always applies to
 * VLM evaluation of Build123d STL renders.
 */
function buildStaticHeader(opts: BuildEvalPromptOptions): string {
  const preamble = opts.evalPreamble ? `${opts.evalPreamble}\n\n` : "";
  return `${preamble}You are a 3D model quality evaluator for Build123d CAD models.

The user requested: "${opts.userPrompt}"

Evaluate the rendered 3D model shown in the images across three dimensions:
- Object Identity: Is this the correct type of object?
- Features: Are requested details (holes, slots, fillets, chamfers, patterns, etc.) present?
- Proportional Plausibility: Do relative sizes of components look reasonable?

You CANNOT measure dimensions from screenshots. Do NOT judge specific measurements
(mm, cm, inches, exact counts of small repeated features). A separate code evaluation
handles dimensional accuracy. Focus only on what you can see visually.

CRITICAL — about the rendering format:
These images show STL file renders using ORTHOGRAPHIC projection (no perspective distortion).
In orthographic projection, parallel edges remain perfectly parallel and relative sizes are
accurate regardless of distance from the camera. There is no foreshortening or convergence.
Straight geometry (cylinders, pipes, boxes) will appear truly straight — do not report tapering
or convergence artifacts.

STL is a tessellated mesh format — ALL surfaces are composed of flat triangular facets.
This is inherent to the format, not a defect. Curved surfaces (cylinders, spheres, fillets,
cones, tori) will ALWAYS appear faceted. The render uses flat shading with no anti-aliasing,
so edges may look jagged.

${buildViewDescription(opts.providedAngles)}

CRITICAL — extrusions and thin profiles:
When a 2D profile is extruded, viewing the model along the extrusion axis shows only a flat rectangle
(the extrusion depth as one side). This is EXPECTED and correct — the profile shape is visible from
the PERPENDICULAR views instead. For example, an L-profile extruded along X will show the L-shape in
the front/back views but appear as a rectangle from left/right views. Similarly, a revolved profile
viewed from the side shows the silhouette; from top/bottom it shows a circle. Do NOT flag a model as
wrong because some views show only a rectangle or circle — check ALL views before judging the shape.
A thin flat shape (like a flat sketch extruded 1-5mm) will appear as a thin line from side views.
This is normal and expected for 2D profile extrusions.

CRITICAL — positional judgments:
The 45° angled views create visual displacement: features appear shifted toward the camera's opposite
edge (e.g. holes appear lower in the 45° down view and higher in the 45° up view). This is a normal
projection effect, NOT a modeling error. To judge the vertical position of features, ALWAYS use the
straight side views (front, back, left, right) where vertical position maps directly to pixel position.
The camera is centered at the exact geometric center of the model's bounding box, so a feature at the
vertical center of the model appears at the vertical center of the straight side views.
Never report positional issues (e.g. "holes are in the lower half") based on angled views alone.

CRITICAL — occlusion and visibility:
Interior features (standoffs, bosses, ribs, internal walls, pockets) are often hidden or partially
occluded by the outer shell of the model. A feature that is not visible from a particular angle does
NOT mean it is missing, shorter, or malformed — it means the viewing angle cannot see it. You have
${opts.providedAngles.length || 8} views but the interior of an enclosure is still mostly hidden. Do NOT report features as missing
or defective when they are simply occluded by other geometry. If a feature is confirmed present in
at least one view, treat it as present. A separate code evaluation checks the actual geometry.

CRITICAL — do not invent requirements:
Only evaluate what the user ACTUALLY requested. If the prompt does not specify a position, size ratio,
or other detail, then ANY reasonable interpretation is correct and must NOT be flagged as an issue.
For example, if the prompt says "through-holes" without specifying vertical placement, the holes may be
at any height and this is NOT an issue. Only flag something as an issue if the prompt explicitly
requested it and the model clearly does not match.

You MUST completely ignore ALL of the following when scoring:
- Faceted/polygonal appearance of curved surfaces
- Lack of smoothness on rounded geometry
- Jagged or aliased edges
- Visible triangulation or tessellation artifacts
- Surface roughness from mesh approximation
These are ALL normal STL rendering characteristics and must NEVER reduce the score.

Focus ONLY on geometric similarity: Does this 3D model represent the correct type of object?
Do the overall shape, proportions, and key features match the request? Ignore texture, color
(unless the prompt requests color), photorealism, and rendering quality entirely.

Classifying issues vs suggestions:
- "issues": ONLY real geometric/structural problems — wrong shape, missing features,
  incorrect proportions, extra geometry, misaligned parts. These are problems in the
  Build123d code that produces the geometry. Issues must NEVER reference rendering
  artifacts, tessellation, features the prompt did not request, or specific dimensions
  (mm, cm, exact measurements). Leave dimensional accuracy to the code evaluation.
- "suggestions": ONLY prompt clarifications — specific ways the user's prompt could be
  more precise to get better results. Example: "The prompt does not specify hole vertical
  placement; adding 'at mid-height' would ensure centered positioning."
  Suggestions must NEVER contain: rendering observations, tessellation/faceting comments,
  "verify X in code" statements, or proposals to add features the prompt did not request.
  If you cannot identify a genuine prompt ambiguity, return an empty suggestions array.`;
}

/**
 * Universal scoring rubric + JSON output schema + optional zoom/spec/checklist
 * appendices. Always emitted last so the model knows the required response shape.
 */
function buildStaticFooter(opts: BuildEvalPromptOptions): string {
  let footer = `Score the model from 1 to 10:
- 1–3: Poor — wrong type of object, or major elements missing
- 4–6: Partial — correct type, but significant features missing or misplaced
- 7–8: Good — correct type and features, proportions look reasonable
- 9–10: Excellent — accurate visual representation of the request

Return JSON only:
{
  "score": <integer 1–10>,
  "issues": ["<geometric/structural problem>", ...],
  "suggestions": ["<rendering observation or code improvement>", ...]
}`;

  if (opts.hasZoomTool) {
    footer += `\n\n${zoomToolBlock()}`;
  }
  if (opts.constructionSpec) {
    footer += `\n\n${constructionSpecBlock(opts.constructionSpec)}`;
  }
  if (opts.checklist.length) {
    footer += `\n\n${checklistBlock(opts.checklist)}`;
  }
  return footer;
}

// ── Legacy monolithic prompt (unchanged behaviour) ─────────────────────

/**
 * The original `buildEvaluationSystemPrompt` body, preserved verbatim so
 * existing callers see identical output when no EvalPlan is provided.
 */
function buildLegacyPrompt(opts: BuildEvalPromptOptions): string {
  let prompt = opts.evalPreamble ? `${opts.evalPreamble}\n\n` : "";
  prompt += `You are a 3D model quality evaluator for Build123d CAD models.

The user requested: "${opts.userPrompt}"
Category: ${opts.categoryName} (complexity level ${opts.complexity}/10)

Evaluate the rendered 3D model shown in the images across three dimensions:
- Object Identity: Is this the correct type of object?
- Features: Are requested details (holes, slots, fillets, chamfers, patterns, etc.) present?
- Proportional Plausibility: Do relative sizes of components look reasonable?

You CANNOT measure dimensions from screenshots. Do NOT judge specific measurements
(mm, cm, inches, exact counts of small repeated features). A separate code evaluation
handles dimensional accuracy. Focus only on what you can see visually.

Score the model from 1 to 10:
- 1–3: Poor — wrong type of object, or major elements missing
- 4–6: Partial — correct type, but significant features missing or misplaced
- 7–8: Good — correct type and features, proportions look reasonable
- 9–10: Excellent — accurate visual representation of the request

Adjust your expectations to the category complexity level. A complexity-1 primitive
category only needs to demonstrate the basic shape correctly. A complexity-10 PCB case
must have accurate port cutouts, standoff placement, and structural features.

CRITICAL — about the rendering format:
These images show STL file renders using ORTHOGRAPHIC projection (no perspective distortion).
In orthographic projection, parallel edges remain perfectly parallel and relative sizes are
accurate regardless of distance from the camera. There is no foreshortening or convergence.
Straight geometry (cylinders, pipes, boxes) will appear truly straight — do not report tapering
or convergence artifacts.

STL is a tessellated mesh format — ALL surfaces are composed of flat triangular facets.
This is inherent to the format, not a defect. Curved surfaces (cylinders, spheres, fillets,
cones, tori) will ALWAYS appear faceted. The render uses flat shading with no anti-aliasing,
so edges may look jagged.

${buildViewDescription(opts.providedAngles)}

CRITICAL — extrusions and thin profiles:
When a 2D profile is extruded, viewing the model along the extrusion axis shows only a flat rectangle
(the extrusion depth as one side). This is EXPECTED and correct — the profile shape is visible from
the PERPENDICULAR views instead. For example, an L-profile extruded along X will show the L-shape in
the front/back views but appear as a rectangle from left/right views. Similarly, a revolved profile
viewed from the side shows the silhouette; from top/bottom it shows a circle. Do NOT flag a model as
wrong because some views show only a rectangle or circle — check ALL views before judging the shape.
A thin flat shape (like a flat sketch extruded 1-5mm) will appear as a thin line from side views.
This is normal and expected for 2D profile extrusions.

CRITICAL — positional judgments:
The 45° angled views create visual displacement: features appear shifted toward the camera's opposite
edge (e.g. holes appear lower in the 45° down view and higher in the 45° up view). This is a normal
projection effect, NOT a modeling error. To judge the vertical position of features, ALWAYS use the
straight side views (front, back, left, right) where vertical position maps directly to pixel position.
The camera is centered at the exact geometric center of the model's bounding box, so a feature at the
vertical center of the model appears at the vertical center of the straight side views.
Never report positional issues (e.g. "holes are in the lower half") based on angled views alone.

CRITICAL — occlusion and visibility:
Interior features (standoffs, bosses, ribs, internal walls, pockets) are often hidden or partially
occluded by the outer shell of the model. A feature that is not visible from a particular angle does
NOT mean it is missing, shorter, or malformed — it means the viewing angle cannot see it. You have
${opts.providedAngles.length || 8} views but the interior of an enclosure is still mostly hidden. Do NOT report features as missing
or defective when they are simply occluded by other geometry. If a feature is confirmed present in
at least one view, treat it as present. A separate code evaluation checks the actual geometry.

CRITICAL — do not invent requirements:
Only evaluate what the user ACTUALLY requested. If the prompt does not specify a position, size ratio,
or other detail, then ANY reasonable interpretation is correct and must NOT be flagged as an issue.
For example, if the prompt says "through-holes" without specifying vertical placement, the holes may be
at any height and this is NOT an issue. Only flag something as an issue if the prompt explicitly
requested it and the model clearly does not match.

You MUST completely ignore ALL of the following when scoring:
- Faceted/polygonal appearance of curved surfaces
- Lack of smoothness on rounded geometry
- Jagged or aliased edges
- Visible triangulation or tessellation artifacts
- Surface roughness from mesh approximation
These are ALL normal STL rendering characteristics and must NEVER reduce the score.

Focus ONLY on geometric similarity: Does this 3D model represent the correct type of object?
Do the overall shape, proportions, and key features match the request? Ignore texture, color
(unless the prompt requests color), photorealism, and rendering quality entirely.

Classifying issues vs suggestions:
- "issues": ONLY real geometric/structural problems — wrong shape, missing features,
  incorrect proportions, extra geometry, misaligned parts. These are problems in the
  Build123d code that produces the geometry. Issues must NEVER reference rendering
  artifacts, tessellation, features the prompt did not request, or specific dimensions
  (mm, cm, exact measurements). Leave dimensional accuracy to the code evaluation.
- "suggestions": ONLY prompt clarifications — specific ways the user's prompt could be
  more precise to get better results. Example: "The prompt does not specify hole vertical
  placement; adding 'at mid-height' would ensure centered positioning."
  Suggestions must NEVER contain: rendering observations, tessellation/faceting comments,
  "verify X in code" statements, or proposals to add features the prompt did not request.
  If you cannot identify a genuine prompt ambiguity, return an empty suggestions array.

Return JSON only:
{
  "score": <integer 1–10>,
  "issues": ["<geometric/structural problem>", ...],
  "suggestions": ["<rendering observation or code improvement>", ...]
}`;

  if (opts.hasZoomTool) {
    prompt += `\n\n${zoomToolBlock()}`;
  }

  if (opts.constructionSpec) {
    prompt += `\n\n${constructionSpecBlock(opts.constructionSpec)}`;
  }

  if (opts.checklist.length) {
    prompt += `\n\n${checklistBlock(opts.checklist)}`;
  }

  return prompt;
}

// ── Shared appendix blocks (used by legacy + footer) ───────────────────

function zoomToolBlock(): string {
  return `DETAIL VIEW CAPABILITY:
You have a "request_detail_view" tool that renders a 1024px detail view with tight framing.
ONLY use this when you genuinely CANNOT determine whether a specific feature is present or absent
from the standard views. Most evaluations should NOT need detail views.

Valid reasons to request a detail view:
- Verifying thread pitch or gear tooth count on features smaller than ~5% of the model
- Confirming a tiny drive recess (Phillips, Torx) that is barely visible

Do NOT request detail views for:
- Overall shape or proportion verification — use standard views
- Feature presence that you can already see (even if small)
- Any feature you can describe from the standard views — if you can see it, you don't need zoom
- General "closer look" or "better inspection" — that is not a valid reason

You may request up to 2 detail views. Provide your evaluation directly unless a feature is truly unresolvable.`;
}

function constructionSpecBlock(constructionSpec: string): string {
  return `## Geometric Specification
The model should implement the following structural properties:
${constructionSpec}

Use this specification as your primary reference for evaluating correctness. Check whether
the visible geometry matches the structural properties listed above.`;
}

function checklistBlock(checklist: string[]): string {
  return `Verification Checklist — answer each with pass, fail, or uncertain:
${checklist.map((q, i) => `${i + 1}. ${q}`).join("\n")}

For each item, set "pass" to:
- true — feature is clearly present/correct in the images
- false — feature is clearly absent or wrong
- null — you CANNOT resolve this feature at the current image resolution (too small, too subtle, or occluded in ALL views)

CRITICAL — cross-view evidence:
If a feature is clearly visible in ANY single view, mark it pass — even if other views cannot
show it due to angle or occlusion. A through-hole visible from top and bottom is confirmed present
even if the front view cannot show it. Do NOT let one ambiguous angle override clear evidence from
another. Only mark uncertain (null) when NO view provides clear evidence either way.

Include in your JSON response:
"checklist": [
  { "question": "...", "pass": true|false|null, "detail": "brief explanation" },
  ...
]`;
}

// ── Follow-up prompt for uncertain items ─────────────────────────────

/**
 * Build a focused system prompt for a single uncertain checklist follow-up.
 * Sent with ONE high-resolution image and ONE specific question.
 */
export function buildUncertainFollowUpPrompt(
  question: string,
  constructionSpec?: string,
): string {
  let prompt = `You are a 3D model detail inspector. You are given a HIGH-RESOLUTION image (2x the normal resolution) of a 3D model and a specific question to answer.

This is a follow-up inspection because the feature could not be resolved at standard resolution. Look carefully at the high-resolution image.

Question: ${question}

Answer with pass (feature is present/correct) or fail (feature is absent/wrong). Do NOT answer uncertain — you must commit to pass or fail based on this higher resolution image.

Return JSON only:
{ "pass": true|false, "detail": "brief explanation of what you see" }`;

  if (constructionSpec) {
    prompt += `\n\nFor reference, the model's construction specification:\n${constructionSpec}`;
  }

  return prompt;
}
