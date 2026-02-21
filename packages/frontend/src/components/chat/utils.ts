/**
 * Shared utility functions for chat sub-components.
 * Extracted from ChatPage.tsx per design-debt-resolution spec.
 */

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function fileExtension(path: string): string {
  const normalized = path.toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}

export function uniqueFilesByPath(
  files: Array<{ path: string; filename: string }>,
): Array<{ path: string; filename: string }> {
  const unique = new Map<string, { path: string; filename: string }>();
  for (const file of files) {
    if (!file.path) {
      continue;
    }
    if (!unique.has(file.path)) {
      unique.set(file.path, file);
    }
  }
  return [...unique.values()];
}

export function formatEstimatedCostUsd(value: number): string {
  return value.toFixed(6);
}
