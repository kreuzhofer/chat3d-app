/**
 * Visual Evaluation System Prompt Builder
 *
 * Renders the instrument with the example's specimen (see
 * `visual-eval-instrument.service.ts`). Production has one instrument; an
 * experiment run may supply its own template instead, so the judge's
 * instructions can be varied and measured over a fixed example set without a
 * source change (issue #35).
 */
import { buildSpecimen, renderInstrument, renderSlots, type SpecimenInput } from "./visual-eval-instrument.service.js";
import {
  PRODUCTION_INSTRUMENT_TEMPLATE,
  FOLLOW_UP_INSTRUMENT_TEMPLATE,
} from "./visual-eval-instrument-templates.js";

export interface BuildEvalPromptOptions extends SpecimenInput {
  /**
   * Instrument override (issue #35): a template over the specimen slots,
   * validated with `validateInstrumentTemplate` where it enters the system.
   * Unset means production's instrument.
   */
  instrumentTemplate?: string;
}

export function buildEvaluationSystemPrompt(opts: BuildEvalPromptOptions): string {
  const template = opts.instrumentTemplate ?? PRODUCTION_INSTRUMENT_TEMPLATE;
  return renderInstrument(template, buildSpecimen(opts));
}

// ── Follow-up prompt for uncertain items ─────────────────────────────

/**
 * The zoom follow-up's system prompt for one uncertain checklist item. Sent
 * with ONE high-resolution image and ONE specific question.
 */
export function buildUncertainFollowUpPrompt(
  question: string,
  constructionSpec?: string,
): string {
  return renderSlots(FOLLOW_UP_INSTRUMENT_TEMPLATE, {
    question,
    construction_spec_reference: constructionSpec
      ? `For reference, the model's construction specification:\n${constructionSpec}`
      : "",
  });
}
