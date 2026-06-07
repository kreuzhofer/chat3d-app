import type { ComponentChecklistItem } from "./component-checklist.js";

/**
 * Merge a top-level verificationChecklist (from the parent prompt) with the
 * decomposition's assemblyChecklist. De-dupe by item text (case-insensitive,
 * trimmed). Top-level items win on duplicates.
 *
 * Used by the assembler in Phase 2: deps.componentChecklist = this merged list.
 */
export function mergeAssemblyChecklist(
  topLevel: ComponentChecklistItem[],
  assemblyChecklist: ComponentChecklistItem[] | undefined,
): ComponentChecklistItem[] {
  if (!assemblyChecklist || assemblyChecklist.length === 0) return [...topLevel];

  const seen = new Set<string>();
  const result: ComponentChecklistItem[] = [];

  for (const item of topLevel) {
    const key = item.item.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  for (const item of assemblyChecklist) {
    const key = item.item.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Storage prefix for per-component artifacts.
 * `workbench/{categoryId}/{exampleId}/components/{componentName}` (without extension).
 *
 * Files appended at runtime: .py, .stl, .3mf, .front.png, .back.png, ...
 */
export function componentStoragePrefix(
  categoryId: string,
  exampleId: string,
  componentName: string,
): string {
  return `workbench/${categoryId}/${exampleId}/components/${componentName}`;
}
