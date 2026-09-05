/**
 * Visual Evaluation System Prompt Builder
 *
 * Picks the instrument for an evaluation and renders it with the example's
 * specimen (see `visual-eval-instrument.service.ts`). Production has two
 * instruments — the legacy monolith, and the eval-plan scaffold used when the
 * prompt carries a plan. An experiment run may supply its own instrument
 * template instead, so the judge's instructions can be varied and measured
 * over a fixed example set without a source change (issue #35).
 */
import type { EvalPlan } from "../utils/eval-plan.js";
import { buildSpecimen, renderInstrument } from "./visual-eval-instrument.service.js";
import {
  LEGACY_INSTRUMENT_TEMPLATE,
  EVAL_PLAN_INSTRUMENT_TEMPLATE,
} from "./visual-eval-instrument-templates.js";

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
  /**
   * Instrument override (issue #35): a template over the specimen slots,
   * validated with `validateInstrumentTemplate` where it enters the system.
   * Unset means production's instrument for this example.
   */
  instrumentTemplate?: string;
}

export function buildEvaluationSystemPrompt(opts: BuildEvalPromptOptions): string {
  const template = opts.instrumentTemplate
    ?? (opts.evalPlan?.systemPrompt ? EVAL_PLAN_INSTRUMENT_TEMPLATE : LEGACY_INSTRUMENT_TEMPLATE);
  return renderInstrument(template, buildSpecimen(opts));
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
