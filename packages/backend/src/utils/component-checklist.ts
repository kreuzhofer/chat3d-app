import { z } from "zod";

export const ChecklistVisibilityEnum = z.enum(["visual", "code", "both"]);
export type ChecklistVisibility = z.infer<typeof ChecklistVisibilityEnum>;

export const AssemblyVisibilityEnum = z.enum(["visible", "occluded"]);
export type AssemblyVisibility = z.infer<typeof AssemblyVisibilityEnum>;

export const ChecklistVerdictEnum = z.enum(["PASS", "FAIL", "UNCERTAIN"]);
export type ChecklistVerdict = z.infer<typeof ChecklistVerdictEnum>;

export const ComponentChecklistItemSchema = z.object({
  item: z.string().min(1),
  visibility: ChecklistVisibilityEnum,
  /** Source component name (assembler-aggregated checklists only). */
  componentName: z.string().min(1).optional(),
  /** Whether the feature is visible in the assembled render (Phase 1 — Codex F6 fix). */
  assemblyVisibility: AssemblyVisibilityEnum.optional(),
});
export type ComponentChecklistItem = z.infer<typeof ComponentChecklistItemSchema>;

export const ComponentChecklistSchema = z.array(ComponentChecklistItemSchema);

/**
 * Parse a component checklist. All-or-nothing: if any item is invalid (bad visibility,
 * missing field, etc.) the whole array is rejected and null is returned.
 *
 * This is deliberate — Task 6 design treats the checklist as a single object emitted by
 * the decomposition LLM. Partial-valid scenarios are rare and easier to detect as "no
 * checklist" than as "silently truncated checklist". If the all-or-nothing rejection rate
 * proves high in practice, switch to per-item filtering here without changing callers.
 */
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

/**
 * Accumulated stats from single-agent evaluate_checklist tool calls.
 * Owned by the workbench-codegen pipeline accumulator; never set on AgentCodegenResult.
 */
export interface PreSubmitVerificationStats {
  callCount: number;
  totalPassed: number;
  totalFailed: number;
  totalUncertain: number;
}

/**
 * Snapshot of a sub-agent's checklist evaluation captured via onChecklistEvaluated.
 * Shared by Tasks 8 (assembler metadata) and 9 (workbench_examples DB persistence).
 */
export interface SubAgentVerificationSnapshot {
  passedCount: number;
  failedCount: number;
  uncertainCount: number;
  failedItems: { item: string; reasoning: string }[];
}
