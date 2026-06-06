/**
 * Decomposition response parser for the multi-agent pipeline (Task 6).
 *
 * Extracted from agent-multi.service.ts to keep that file under the 500-line cap.
 */

import { parseComponentChecklist, type ComponentChecklistItem } from "../utils/component-checklist.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface DecomposedComponent {
  name: string;
  description: string;
  componentChecklist?: ComponentChecklistItem[];
}

export interface DecompositionResult {
  components: DecomposedComponent[];
  assemblyNotes: string;
  promptTokens?: number;
  completionTokens?: number;
}

// ── Constants ──────────────────────────────────────────────────────────

export const DECOMPOSE_CHECKLIST_ADDENDUM = `
For each component, also emit a "componentChecklist" — 3–6 short verification items that this component ALONE (before assembly) must satisfy. Each item should be checkable against just this component's geometry, not the assembled whole. Annotate each item with "visibility": "visual" | "code" | "both" using the same rules as the top-level verificationChecklist (visual = visible from rendered views; code = checkable in source; both = both). Include items that catch failures specific to this component's role (e.g. "is hollow", "has N standoffs", "wall thickness X mm"). Do NOT include items that depend on the relationship between components (those belong in assemblyNotes).
`.trim();

// ── Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a raw JSON string returned by the decomposition LLM into a
 * DecompositionResult. Exported for unit testing.
 */
export function parseDecompositionResponse(rawText: string): DecompositionResult {
  const cleanText = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  const parsed = JSON.parse(cleanText) as { components: unknown[]; assemblyNotes: unknown };

  if (!Array.isArray(parsed.components) || parsed.components.length < 1) {
    throw new Error("Decomposition produced no components");
  }

  const components: DecomposedComponent[] = (parsed.components as any[]).map((c: any) => {
    let name = String(c.name ?? "").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    if (/^\d/.test(name)) name = "_" + name;
    const description = String(c.description ?? "").trim();
    const checklistRaw = parseComponentChecklist(c.componentChecklist);
    return {
      name,
      description,
      ...(checklistRaw !== null ? { componentChecklist: checklistRaw } : {}),
    };
  });

  return {
    components,
    assemblyNotes: String(parsed.assemblyNotes ?? ""),
  };
}
