/**
 * Fixed inputs for the judge's system prompt, one per specimen shape. The
 * goldens next to this file pin the production instrument byte for byte
 * (ADR 0003): a change to the instrument re-pins them deliberately, and
 * changes the Instrument id of every evaluation that follows.
 */
import type { BuildEvalPromptOptions } from "../../services/visual-eval-prompt.service.js";

const base: BuildEvalPromptOptions = {
  userPrompt: 'A wall bracket with two "keyhole" slots and a 45° gusset',
  categoryName: "Brackets",
  complexity: 4,
  checklist: [],
  constructionSpec: "",
};

const full = {
  checklist: ["Does the bracket have two keyhole slots?", "Is the gusset at 45°?", "Are both mounting faces flat?"],
  constructionSpec: "- L-shaped body 80×60×3 mm\n- two keyhole slots on the long leg\n\n- triangular gusset between the legs",
};

export const JUDGE_PROMPT_FIXTURES: Record<string, BuildEvalPromptOptions> = {
  "production-bare": { ...base },
  "production-full": { ...base, ...full },
  "production-blank-items": { ...base, checklist: ["", "  ", "Is the gusset at 45°?"] },
};

/** Fixed inputs for the zoom follow-up's prompt. */
export const FOLLOW_UP_FIXTURES: Record<string, { question: string; constructionSpec?: string }> = {
  "follow-up-bare": { question: "Is the gusset at 45°?" },
  "follow-up-spec": { question: "Is the gusset at 45°?", constructionSpec: full.constructionSpec },
};
