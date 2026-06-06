import { z } from "zod";

export const ChecklistVisibilityEnum = z.enum(["visual", "code", "both"]);
export type ChecklistVisibility = z.infer<typeof ChecklistVisibilityEnum>;

export const ChecklistVerdictEnum = z.enum(["PASS", "FAIL", "UNCERTAIN"]);
export type ChecklistVerdict = z.infer<typeof ChecklistVerdictEnum>;

export const ComponentChecklistItemSchema = z.object({
  item: z.string().min(1),
  visibility: ChecklistVisibilityEnum,
});
export type ComponentChecklistItem = z.infer<typeof ComponentChecklistItemSchema>;

export const ComponentChecklistSchema = z.array(ComponentChecklistItemSchema);

export function parseComponentChecklist(input: unknown): ComponentChecklistItem[] | null {
  const r = ComponentChecklistSchema.safeParse(input);
  return r.success ? r.data : null;
}

export interface ChecklistItemResult {
  index: number;
  item: string;
  visibility: ChecklistVisibility;
  verdict: ChecklistVerdict;
  reasoning: string;
}

export interface ComponentVerificationResult {
  results: ChecklistItemResult[];
  passedCount: number;
  failedCount: number;
  uncertainCount: number;
}
