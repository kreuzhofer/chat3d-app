/**
 * Fixed inputs for the judge's system prompt, one per production path and
 * option combination. The goldens next to this file were rendered from the
 * builder as it stood before the instrument/specimen split (issue #35); the
 * split must reproduce them byte for byte.
 */
import type { BuildEvalPromptOptions } from "../../services/visual-eval-prompt.service.js";

const base: BuildEvalPromptOptions = {
  userPrompt: 'A wall bracket with two "keyhole" slots and a 45° gusset',
  categoryName: "Brackets",
  complexity: 4,
  checklist: [],
  hasZoomTool: false,
  providedAngles: [],
  constructionSpec: "",
  evalPreamble: "",
  evalPlan: null,
};

const full = {
  checklist: ["Does the bracket have two keyhole slots?", "Is the gusset at 45°?", "Are both mounting faces flat?"],
  providedAngles: ["front", "top", "ortho_45"],
  constructionSpec: "- L-shaped body 80×60×3 mm\n- two keyhole slots on the long leg\n\n- triangular gusset between the legs",
  evalPreamble: "You are calibrated to be strict about missing features.",
};

const plan = {
  systemPrompt: "Inspect the long leg for two keyhole slots.\n\nConfirm the gusset spans both legs.",
  inspectionPlan: { angles: ["front", "top", "ortho_45"] as ["front", "top", "ortho_45"], focus: { front: "the slots" } },
  suggestedCodeWeight: 0.4,
};

export const JUDGE_PROMPT_FIXTURES: Record<string, BuildEvalPromptOptions> = {
  "legacy-bare": { ...base },
  "legacy-full": { ...base, ...full },
  "legacy-zoom": { ...base, ...full, hasZoomTool: true },
  "legacy-blank-items": { ...base, checklist: ["", "  ", "Is the gusset at 45°?"] },
  "dynamic-bare": { ...base, evalPlan: plan },
  "dynamic-full": { ...base, ...full, evalPlan: plan },
  "dynamic-zoom": { ...base, ...full, evalPlan: plan, hasZoomTool: true },
};
