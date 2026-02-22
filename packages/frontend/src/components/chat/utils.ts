/**
 * Shared utility functions for chat sub-components.
 * Extracted from ChatPage.tsx per design-debt-resolution spec.
 */

import type { ChatTimelineItem } from "../../features/chat/chat-adapters";

/** Model version for WorkbenchPane history tab (Req 12) */
export interface ModelVersionEntry {
  assistantItemId: string;
  sequenceNumber: number;
  timestamp: string;
  promptSummary: string;
  previewFilePath: string | null;
  files: Array<{ path: string; filename: string }>;
}

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


const PROMPT_SUMMARY_MAX_LENGTH = 80;

/**
 * Truncate a string to a maximum length, appending "…" if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength).trimEnd() + "…";
}

/**
 * Build ModelVersionEntry list from timeline items.
 * Only includes assistant items that have 3D artifacts (STL/3MF files).
 * The promptSummary is derived from the preceding user item's text.
 */
export function buildModelVersionEntries(
  timelineItems: ChatTimelineItem[],
): ModelVersionEntry[] {
  const entries: ModelVersionEntry[] = [];
  let sequenceNumber = 0;

  for (let i = 0; i < timelineItems.length; i++) {
    const item = timelineItems[i];
    if (item.role !== "assistant") {
      continue;
    }

    const allFiles = uniqueFilesByPath(
      item.segments.flatMap((segment) => segment.files),
    );
    const previewFile =
      allFiles.find((file) => [".3mf", ".stl"].includes(fileExtension(file.path))) ?? null;

    // Only include assistant items that have 3D artifacts
    if (!previewFile && allFiles.length === 0) {
      continue;
    }

    sequenceNumber++;

    // Find the preceding user item for prompt summary
    let promptSummary = "";
    for (let j = i - 1; j >= 0; j--) {
      if (timelineItems[j].role === "user") {
        const userText = timelineItems[j].segments
          .filter((seg) => seg.kind === "message")
          .map((seg) => seg.text)
          .join(" ")
          .trim();
        promptSummary = truncateText(userText, PROMPT_SUMMARY_MAX_LENGTH);
        break;
      }
    }

    entries.push({
      assistantItemId: item.id,
      sequenceNumber,
      timestamp: item.createdAt,
      promptSummary: promptSummary || "No prompt available",
      previewFilePath: previewFile?.path ?? null,
      files: allFiles,
    });
  }

  return entries;
}
