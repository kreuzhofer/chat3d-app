/**
 * EvalPlan: the per-prompt evaluation directive emitted by the spec LLM and
 * consumed by the VLM prompt builder, image selector, and composite weight
 * resolver. Stored as JSONB on workbench_example_prompts.eval_plan.
 */
import { z } from "zod";

export const RENDER_ANGLE_NAMES = [
  "front", "back", "left", "right",
  "top", "bottom", "ortho_45", "ortho_45_bottom",
  "isometric", "isometric_back",
] as const;

export type RenderAngleName = (typeof RENDER_ANGLE_NAMES)[number];

const AngleEnum = z.enum(RENDER_ANGLE_NAMES);

export const EvalPlanSchema = z
  .object({
    systemPrompt: z.string().min(1, "systemPrompt must be non-empty"),
    inspectionPlan: z.object({
      angles: z.array(AngleEnum).min(1, "angles must be non-empty"),
      focus: z.record(z.string(), z.string()).optional(),
    }),
    suggestedCodeWeight: z.number().min(0).max(1),
  })
  .superRefine((plan, ctx) => {
    if (!plan.inspectionPlan.focus) return;
    const angleSet = new Set<string>(plan.inspectionPlan.angles);
    for (const key of Object.keys(plan.inspectionPlan.focus)) {
      if (!angleSet.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inspectionPlan", "focus", key],
          message: `focus key "${key}" is not listed in inspectionPlan.angles`,
        });
      }
    }
  });

export type EvalPlan = z.infer<typeof EvalPlanSchema>;

/**
 * Best-effort parse. Returns the validated plan or null on any failure.
 * Used at boundaries (JSON parsing from LLM response, DB row → object).
 */
export function parseEvalPlan(input: unknown): EvalPlan | null {
  const result = EvalPlanSchema.safeParse(input);
  return result.success ? result.data : null;
}
