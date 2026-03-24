import { trackedGenerateText } from "./tracked-llm.service.js";
import { runWithUsageContext } from "./usage-tracking.service.js";
import { ProviderQuotaExhaustedError } from "../utils/llm-errors.js";
import { prisma } from "../db/prisma.js";
import { notificationService } from "./notification.service.js";
import { sseService } from "./sse.service.js";
import { createChatItem, updateChatItem, updateChatContext as updateChatContextService, deleteChatItem, incrementContextCost, recalculateContextCost } from "./chat.service.js";
import { moveStorageFile, readStorageFile, writeStorageFile, deleteStorageFile } from "./file-storage.service.js";
import {
  generateConversationText,
  generateConversationTextStream,
  parseConversationResponse,
  findMostRecentCode,
  type LlmUsageMetadata,
} from "./llm.service.js";
import {
  renderModelScreenshots,
  type RenderedScreenshot,
} from "./stl-rendering-client.service.js";
import { pushNotificationService } from "./push-notification.service.js";
import { flattenForEval } from "../utils/code-flatten.js";
import {
  getConversationHistoryMaxPairs,
  isSpecGenerationEnabled,
  getAgentMaxSteps,
  getAutoApproveThreshold,
  getCodeEvalWeight,
  getPipelineTimeoutMs,
} from "./generation-settings.service.js";
import { runFullEvaluation } from "./eval-orchestrator.service.js";
import { generateSpec, formatDisambiguationResponse } from "./spec-generation.service.js";
import { updateProjectCode, updateProjectFiles, getProjectCode } from "./code-project.service.js";
import { runAgentCodegen, runMultiAgentCodegen } from "./agent-codegen.service.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  calculateCostUsd,
} from "./llm-config.service.js";
import { createLogger } from "../utils/logger.js";

const queryLogger = createLogger("query");

interface ChatContextRow {
  id: string;
  name: string;
}

interface OwnedAssistantItemRow {
  id: string;
  created_at: string;
  role: "assistant";
}

interface UserPromptRow {
  messages: unknown;
}

export type QueryState = "queued" | "conversation" | "codegen" | "rendering" | "validating" | "evaluating" | "fixing" | "retrying" | "agent" | "completed" | "failed" | "cancelled";

export interface StreamTokenEvent {
  type: "stream-token";
  contextId: string;
  assistantItemId: string;
  token: string;
  done: boolean;
}

export interface QueryStateEvent {
  type: "query-state";
  contextId: string;
  assistantItemId: string;
  state: QueryState;
  detail?: string;
}

export interface QueryAttachmentInput {
  path: string;
  filename: string;
  mimeType: string;
  kind: "file" | "image";
}

interface QueryUsageSummary {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

interface QueryArtifactSummary {
  previewStatus: "ready" | "downgraded";
  detail: string;
  previewFilePath: string | null;
}

export class QueryServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

// ── Pipeline cancellation ──

export class PipelineCancelledError extends Error {
  constructor() { super("Pipeline cancelled by user"); }
}

/** In-memory registry of running query pipelines. Key: assistantItemId. */
const runningPipelines = new Map<string, { controller: AbortController; userId: string }>();

function registerPipeline(assistantItemId: string, userId: string): AbortController {
  const existing = runningPipelines.get(assistantItemId);
  if (existing) existing.controller.abort();
  const controller = new AbortController();
  runningPipelines.set(assistantItemId, { controller, userId });
  return controller;
}

function unregisterPipeline(assistantItemId: string): void {
  runningPipelines.delete(assistantItemId);
}

/**
 * Cancel a running pipeline. Returns true if a pipeline was found and aborted.
 * Verifies that the requesting user owns the pipeline.
 */
export function cancelPipeline(assistantItemId: string, userId: string): boolean {
  const entry = runningPipelines.get(assistantItemId);
  if (!entry) return false;
  if (entry.userId !== userId) return false;
  entry.controller.abort();
  return true;
}

/**
 * Cancel any running pipeline in the given context for the given user.
 * Used before starting a new pipeline to ensure only one runs per context.
 */
function cancelPipelinesInContext(contextId: string, userId: string): void {
  for (const [itemId, entry] of runningPipelines) {
    if (entry.userId === userId) {
      // We don't store contextId in the map, so we abort all pipelines for this user.
      // In practice, a user runs at most one pipeline at a time.
      entry.controller.abort();
      queryLogger.info({ assistantItemId: itemId, contextId }, "cancelled existing pipeline before starting new one");
    }
  }
}

/**
 * Mark stale pending assistant items as failed in the database.
 * Called when loading items for a context — any pending item that isn't
 * actively running (not in runningPipelines) is considered orphaned.
 */
export async function markStalePendingItems(contextId: string, userId: string): Promise<number> {
  const pendingItems = await prisma.chatItem.findMany({
    where: {
      chatContextId: contextId,
      ownerId: userId,
      role: "assistant",
    },
    select: { id: true, messages: true },
  });

  let markedCount = 0;
  for (const item of pendingItems) {
    if (!Array.isArray(item.messages)) continue;
    const msgs = item.messages as Array<Record<string, unknown>>;
    const hasPending = msgs.some((seg) => seg.state === "pending");
    if (!hasPending) continue;

    // If this item has an active in-memory pipeline, skip it
    if (runningPipelines.has(item.id)) continue;

    // Mark as failed — update all pending segments
    const updatedMessages = msgs.map((seg) =>
      seg.state === "pending"
        ? { ...seg, state: "failed", stateMessage: "Pipeline interrupted by server restart" }
        : seg,
    );

    await prisma.chatItem.update({
      where: { id: item.id },
      data: { messages: updatedMessages as object[] },
    });
    markedCount++;
    queryLogger.info({ assistantItemId: item.id, contextId }, "marked stale pending item as failed");
  }

  return markedCount;
}

// --- Conversation history for iterative refinement (Req 10) ---

export interface ConversationHistoryEntry {
  role: "user" | "assistant";
  text: string;
  code?: string;
  sequencePosition: number;
}

interface ChatItemHistoryRow {
  id: string;
  role: "user" | "assistant";
  messages: unknown;
  created_at: string;
}

/**
 * Extract the text content from a chat item's messages JSONB array.
 * Looks for the first segment with itemType "message" and returns its text.
 */
function extractTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (const segment of messages) {
    if (
      segment &&
      typeof segment === "object" &&
      "itemType" in segment &&
      "text" in segment &&
      (segment as Record<string, unknown>).itemType === "message" &&
      typeof (segment as Record<string, unknown>).text === "string"
    ) {
      return ((segment as Record<string, unknown>).text as string).trim();
    }
  }
  return "";
}

/**
 * Extract Build123d code from an assistant chat item's messages JSONB array.
 * Looks for segments with itemType "3dmodel" or "code" that contain code content.
 */
function extractCodeFromMessages(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const segment of messages) {
    if (!segment || typeof segment !== "object") continue;
    const rec = segment as Record<string, unknown>;

    // Check for code in 3dmodel segments — these contain the generated files
    if (rec.itemType === "3dmodel" && Array.isArray(rec.files)) {
      // The code itself is in the codegen result, but we can look for it
      // in the artifact or associated code segment
      continue;
    }

    // Check for explicit code segments
    if (rec.itemType === "code" && typeof rec.text === "string" && rec.text.trim().length > 0) {
      return rec.text.trim();
    }
  }

  // Fallback: look for code blocks in the meta segment's associated data
  // or in the conversation text that contains code fences
  for (const segment of messages) {
    if (!segment || typeof segment !== "object") continue;
    const rec = segment as Record<string, unknown>;

    if (rec.itemType === "meta" && rec.llm && typeof rec.llm === "object") {
      // The meta segment doesn't directly contain code, but the codegen result
      // is stored alongside the 3dmodel segment
      continue;
    }
  }

  return undefined;
}

/**
 * Fetch the last N chat items for a context and build a ConversationHistoryEntry array.
 * Returns at most `maxPairs` exchange pairs (user prompt + assistant response).
 */
export async function buildConversationContext(
  contextId: string,
  userId: string,
  maxPairs: number = 5,
  excludeIds: string[] = [],
): Promise<ConversationHistoryEntry[]> {
  // Fetch the last (maxPairs * 2) items ordered by created_at DESC, then reverse
  // to get chronological order. We fetch more than needed to handle gaps.
  const limit = maxPairs * 2 + 2; // small buffer for edge cases
  const rows = await prisma.chatItem.findMany({
    where: {
      chatContextId: contextId,
      ownerId: userId,
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    select: { id: true, role: true, messages: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Reverse to chronological order
  const items = rows.reverse().map((r) => ({
    id: r.id,
    role: r.role as "user" | "assistant",
    messages: r.messages,
    created_at: r.createdAt.toISOString(),
  }));

  // Build entries from all items
  const entries: ConversationHistoryEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = extractTextFromMessages(item.messages);
    if (!text) continue;

    const entry: ConversationHistoryEntry = {
      role: item.role,
      text,
      sequencePosition: i + 1,
    };

    if (item.role === "assistant") {
      const code = extractCodeFromMessages(item.messages);
      if (code) {
        entry.code = code;
      }
    }

    entries.push(entry);
  }

  return capConversationEntries(entries, maxPairs);
}

/**
 * Cap conversation entries to at most `maxPairs` exchange pairs.
 * Returns the last `maxPairs * 2` entries if the input exceeds that limit.
 * Exported for testability (Property 17).
 */
export function capConversationEntries(
  entries: ConversationHistoryEntry[],
  maxPairs: number = 5,
): ConversationHistoryEntry[] {
  if (entries.length <= maxPairs * 2) {
    return entries;
  }
  return entries.slice(-maxPairs * 2);
}

async function ensureOwnedContext(userId: string, contextId: string): Promise<ChatContextRow> {
  const context = await prisma.chatContext.findFirst({
    where: { id: contextId, ownerId: userId, deletedAt: null },
    select: { id: true, name: true },
  });

  if (!context) {
    throw new QueryServiceError("Chat context not found", 404);
  }

  return context;
}

async function publishQueryState(input: {
  userId: string;
  contextId: string;
  assistantItemId?: string;
  state: QueryState;
  detail?: string;
}) {
  await notificationService.publishToUser(input.userId, "chat.query.state", {
    contextId: input.contextId,
    assistantItemId: input.assistantItemId ?? null,
    state: input.state,
    detail: input.detail ?? null,
  });
}

function mapExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step";
  if (lower.endsWith(".3mf")) return "3mf";
  if (lower.endsWith(".b123d")) return "b123d";
  return "bin";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toAttachmentKind(value: unknown): "file" | "image" {
  return value === "image" ? "image" : "file";
}

function sanitizeAttachmentFilename(value: string, fallbackPath: string): string {
  const base = value.trim();
  if (base !== "") {
    return base;
  }
  const normalized = fallbackPath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "attachment.bin";
}

function normalizeQueryAttachments(value: unknown): QueryAttachmentInput[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new QueryServiceError("attachments must be an array", 400);
  }

  const normalized: QueryAttachmentInput[] = [];
  const seenPaths = new Set<string>();
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      throw new QueryServiceError("attachments must contain objects", 400);
    }

    const path = asString(record.path).trim();
    if (path === "") {
      throw new QueryServiceError("attachment.path is required", 400);
    }
    if (seenPaths.has(path)) {
      continue;
    }

    normalized.push({
      path,
      filename: sanitizeAttachmentFilename(asString(record.filename), path),
      mimeType: asString(record.mimeType).trim() || "application/octet-stream",
      kind: toAttachmentKind(record.kind),
    });
    seenPaths.add(path);
  }

  return normalized;
}

function formatAttachmentContext(attachments: QueryAttachmentInput[]): string {
  if (attachments.length === 0) {
    return "";
  }

  const lines = attachments.map((attachment) => {
    const kind = attachment.kind === "image" ? "image" : "file";
    return `- ${kind}: ${attachment.filename} (${attachment.mimeType})`;
  });

  return `\n\nAttached user files:\n${lines.join("\n")}`;
}

async function assertAttachmentsAccessible(_userId: string, attachments: QueryAttachmentInput[]) {
  for (const attachment of attachments) {
    await readStorageFile({ relativePath: attachment.path });
  }
}

// --- Image collection for multimodal LLM calls ---

/** A base64-encoded image ready to be sent to a vision-capable LLM. */
export interface CollectedImage {
  base64: string;
  mimeType: string;
  filename: string;
}

/**
 * Extract image attachment storage paths from a chat item's JSONB messages array.
 * Returns paths for segments with `itemType: "attachment"` and `attachmentKind: "image"`.
 */
function extractImageRefsFromMessages(messages: unknown): Array<{ path: string; filename: string; mimeType: string }> {
  if (!Array.isArray(messages)) return [];
  const refs: Array<{ path: string; filename: string; mimeType: string }> = [];
  for (const segment of messages) {
    if (!segment || typeof segment !== "object") continue;
    const rec = segment as Record<string, unknown>;
    if (rec.itemType !== "attachment" || rec.attachmentKind !== "image") continue;
    const path = typeof rec.attachment === "string" ? rec.attachment : "";
    if (!path) continue;
    refs.push({
      path,
      filename: typeof rec.filename === "string" ? rec.filename : path.split("/").pop() || "image",
      mimeType: typeof rec.mimeType === "string" ? rec.mimeType : "image/png",
    });
  }
  return refs;
}

/**
 * Read image files from storage and return as base64-encoded CollectedImage[].
 * Silently skips files that cannot be read (e.g. deleted).
 */
async function readImagesFromStorage(
  refs: Array<{ path: string; filename: string; mimeType: string }>,
): Promise<CollectedImage[]> {
  const images: CollectedImage[] = [];
  for (const ref of refs) {
    try {
      const buffer = await readStorageFile({ relativePath: ref.path });
      images.push({
        base64: buffer.toString("base64"),
        mimeType: ref.mimeType,
        filename: ref.filename,
      });
    } catch (err) {
      queryLogger.warn({ err: err instanceof Error ? err.message : String(err), path: ref.path }, "skipping unreadable image attachment");
    }
  }
  return images;
}

/**
 * Collect all images for a pipeline run: current-turn attachments + images from previous turns.
 * Deduplicates by storage path. Returns images ordered: historical first, then current turn.
 */
async function collectAllImages(
  contextId: string,
  userId: string,
  currentAttachments: QueryAttachmentInput[],
  excludeItemIds: string[],
): Promise<CollectedImage[]> {
  // Gather image refs from current turn
  const currentImageRefs = currentAttachments
    .filter((a) => a.kind === "image")
    .map((a) => ({ path: a.path, filename: a.filename, mimeType: a.mimeType }));

  // Gather image refs from previous user items in this context
  const previousItems = await prisma.chatItem.findMany({
    where: {
      chatContextId: contextId,
      ownerId: userId,
      role: "user",
      ...(excludeItemIds.length > 0 ? { id: { notIn: excludeItemIds } } : {}),
    },
    select: { messages: true },
    orderBy: { createdAt: "asc" },
  });

  const historicalRefs: Array<{ path: string; filename: string; mimeType: string }> = [];
  for (const item of previousItems) {
    historicalRefs.push(...extractImageRefsFromMessages(item.messages));
  }

  // Deduplicate by path (historical first, then current)
  const seen = new Set<string>();
  const allRefs: Array<{ path: string; filename: string; mimeType: string }> = [];
  for (const ref of [...historicalRefs, ...currentImageRefs]) {
    if (!seen.has(ref.path)) {
      seen.add(ref.path);
      allRefs.push(ref);
    }
  }

  if (allRefs.length === 0) return [];

  queryLogger.info({ totalImages: allRefs.length, historical: historicalRefs.length, current: currentImageRefs.length }, "collected images for pipeline");
  return readImagesFromStorage(allRefs);
}

/**
 * Move attachments from tmp/ to chat/{contextId}/ and update paths in-place.
 * Files already in chat/ are left as-is.
 */
async function relocateTempAttachments(
  contextId: string,
  attachments: QueryAttachmentInput[],
): Promise<void> {
  for (const attachment of attachments) {
    if (!attachment.path.startsWith("tmp/")) continue;
    const ext = attachment.path.includes(".") ? attachment.path.substring(attachment.path.lastIndexOf(".")) : "";
    const uniqueId = crypto.randomUUID();
    const newPath = `chat/${contextId}/${contextId}-${uniqueId}${ext}`;
    try {
      await moveStorageFile({ fromPath: attachment.path, toPath: newPath });
      attachment.path = newPath;
    } catch (err) {
      queryLogger.warn({ err: err instanceof Error ? err.message : String(err), from: attachment.path, to: newPath }, "failed to relocate temp attachment");
    }
  }
}

function summarizeUsage(usageRecords: LlmUsageMetadata[]): QueryUsageSummary {
  return usageRecords.reduce<QueryUsageSummary>(
    (summary, usage) => ({
      inputTokens: summary.inputTokens + usage.inputTokens,
      outputTokens: summary.outputTokens + usage.outputTokens,
      reasoningTokens: summary.reasoningTokens + usage.reasoningTokens,
      totalTokens: summary.totalTokens + usage.totalTokens,
      estimatedCostUsd: Number((summary.estimatedCostUsd + usage.estimatedCostUsd).toFixed(8)),
      durationMs: 0,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      durationMs: 0,
    },
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Extract attachment metadata from a user chat item's JSONB messages array.
 * Used by `resumeStalePipelines` to reconstruct the attachments parameter.
 */
function extractAttachmentsFromMessages(messages: unknown): QueryAttachmentInput[] {
  if (!Array.isArray(messages)) return [];
  const attachments: QueryAttachmentInput[] = [];
  for (const segment of messages) {
    if (!segment || typeof segment !== "object") continue;
    const rec = segment as Record<string, unknown>;
    if (rec.itemType !== "attachment") continue;
    const path = typeof rec.attachment === "string" ? rec.attachment : "";
    if (!path) continue;
    attachments.push({
      path,
      filename: typeof rec.filename === "string" ? rec.filename : path.split("/").pop() || "file",
      mimeType: typeof rec.mimeType === "string" ? rec.mimeType : "application/octet-stream",
      kind: rec.attachmentKind === "image" ? "image" : "file",
    });
  }
  return attachments;
}

function extractPromptFromMessages(messages: unknown): string | null {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (const entry of messages) {
    const candidate = asRecord(entry);
    if (!candidate) {
      continue;
    }

    const itemType = typeof candidate.itemType === "string" ? candidate.itemType : "";
    const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
    if (itemType === "message" && text.length > 0) {
      return text;
    }
  }

  return null;
}

export async function resolvePromptForRegeneration(input: {
  userId: string;
  contextId: string;
  assistantItemId: string;
}): Promise<string> {
  const assistantItem = await prisma.chatItem.findFirst({
    where: {
      id: input.assistantItemId,
      chatContextId: input.contextId,
      ownerId: input.userId,
      role: "assistant",
    },
    select: { id: true, createdAt: true, role: true },
  });

  if (!assistantItem) {
    throw new QueryServiceError("Assistant item not found", 404);
  }

  const promptRow = await prisma.chatItem.findFirst({
    where: {
      chatContextId: input.contextId,
      ownerId: input.userId,
      role: "user",
      createdAt: { lte: assistantItem.createdAt },
    },
    select: { messages: true },
    orderBy: { createdAt: "desc" },
  });

  const prompt = extractPromptFromMessages(promptRow?.messages);
  if (!prompt) {
    throw new QueryServiceError("Unable to resolve original prompt for regeneration", 400);
  }

  return prompt;
}

/**
 * Delete the old assistant item (and its generated files), then create a fresh
 * assistant item to be filled by the pipeline. Returns everything needed by
 * `executeQueryPipeline`.
 */
export async function initiateRegeneration(input: {
  userId: string;
  contextId: string;
  assistantItemId: string;
}) {
  // 1. Cancel any running pipeline in the context
  cancelPipelinesInContext(input.contextId, input.userId);

  // 2. Resolve the assistant item and its preceding user item
  const assistantItem = await prisma.chatItem.findFirst({
    where: {
      id: input.assistantItemId,
      chatContextId: input.contextId,
      ownerId: input.userId,
      role: "assistant",
    },
    select: { id: true, createdAt: true, messages: true },
  });

  if (!assistantItem) {
    throw new QueryServiceError("Assistant item not found", 404);
  }

  const userItem = await prisma.chatItem.findFirst({
    where: {
      chatContextId: input.contextId,
      ownerId: input.userId,
      role: "user",
      createdAt: { lte: assistantItem.createdAt },
    },
    select: { id: true, messages: true },
    orderBy: { createdAt: "desc" },
  });

  const prompt = extractPromptFromMessages(userItem?.messages);
  if (!prompt || !userItem) {
    throw new QueryServiceError("Unable to resolve original prompt for regeneration", 400);
  }

  const attachments = extractAttachmentsFromMessages(userItem.messages);

  // 3. Delete generated files from the old assistant item
  if (Array.isArray(assistantItem.messages)) {
    for (const segment of assistantItem.messages as Array<Record<string, unknown>>) {
      const files = segment?.files;
      if (!Array.isArray(files)) continue;
      for (const file of files as Array<Record<string, unknown>>) {
        const filePath = typeof file.path === "string" ? file.path : "";
        if (!filePath) continue;
        try {
          await deleteStorageFile({ relativePath: filePath });
        } catch {
          // File may already be gone — ignore
        }
      }
    }
  }

  // 4. Delete the old assistant item
  await deleteChatItem({ userId: input.userId, contextId: input.contextId, itemId: input.assistantItemId });

  // 5. Create a new assistant item with pending placeholder
  const newAssistantItem = await createChatItem({
    userId: input.userId,
    contextId: input.contextId,
    role: "assistant",
    messages: [{ itemType: "message", text: "Working on your request...", state: "pending", stateMessage: "" }],
  });

  // 6. Load chat context
  const context = await ensureOwnedContext(input.userId, input.contextId);

  return {
    contextId: input.contextId,
    userItemId: userItem.id,
    assistantItem: newAssistantItem,
    prompt,
    attachments,
    context,
  };
}

/**
 * Resume pipelines for assistant items that were pending when the server last
 * shut down. Only items updated within the last `maxAgeMinutes` are resumed —
 * older items are assumed to be stuck for other reasons.
 *
 * Called once on server startup, after Prisma is connected.
 */
export async function resumeStalePipelines(maxAgeMinutes = 15): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  // Find assistant items whose messages JSONB contains a segment with state "pending"
  // and were updated recently enough to be worth resuming.
  const staleItems = await prisma.chatItem.findMany({
    where: {
      role: "assistant",
      updatedAt: { gte: cutoff },
    },
    select: {
      id: true,
      chatContextId: true,
      ownerId: true,
      messages: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 20, // Safety cap
  });

  // Filter to items that actually have a pending segment (Prisma can't query inside JSONB arrays)
  const pendingItems = staleItems.filter((item) => {
    if (!Array.isArray(item.messages)) return false;
    return (item.messages as Array<Record<string, unknown>>).some(
      (seg) => seg.state === "pending",
    );
  });

  if (pendingItems.length === 0) {
    queryLogger.info("no stale pending pipelines to resume");
    return;
  }

  queryLogger.info({ count: pendingItems.length }, "resuming stale pending pipelines");

  for (const item of pendingItems) {
    try {
      // Resolve original prompt from the preceding user message
      const userRow = await prisma.chatItem.findFirst({
        where: {
          chatContextId: item.chatContextId,
          ownerId: item.ownerId,
          role: "user",
          createdAt: { lte: item.createdAt },
        },
        select: { id: true, messages: true },
        orderBy: { createdAt: "desc" },
      });

      const prompt = extractPromptFromMessages(userRow?.messages);
      if (!prompt || !userRow) {
        queryLogger.warn({ assistantItemId: item.id }, "cannot resolve prompt for stale item — skipping");
        continue;
      }

      // Reconstruct attachments from the user item's persisted messages JSONB
      // so that images and files are available to the resumed pipeline.
      const attachments = extractAttachmentsFromMessages(userRow.messages);

      const context = await prisma.chatContext.findFirst({
        where: { id: item.chatContextId, ownerId: item.ownerId },
        select: { id: true, name: true },
      });
      if (!context) {
        queryLogger.warn({ assistantItemId: item.id }, "context not found for stale item — skipping");
        continue;
      }

      queryLogger.info(
        { assistantItemId: item.id, contextId: item.chatContextId, attachmentCount: attachments.length },
        "re-firing pipeline for stale item",
      );

      void executeQueryPipeline({
        userId: item.ownerId,
        contextId: item.chatContextId,
        prompt,
        attachments,
        context,
        userItemId: userRow.id,
        assistantItemId: item.id,
        stream: true,
        isFirstPrompt: false,
      });
    } catch (err) {
      queryLogger.error({ err, assistantItemId: item.id }, "failed to resume stale pipeline");
    }
  }
}

function selectPreviewFile(files: Array<{ path: string; filename: string }>) {
  const priority = [".3mf", ".stl"];
  for (const extension of priority) {
    const matched = files.find((file) => file.path.toLowerCase().endsWith(extension));
    if (matched) {
      return matched;
    }
  }
  return null;
}

function summarizeArtifacts(generatedFiles: Array<{ path: string; filename: string }>): QueryArtifactSummary {
  const previewFile = selectPreviewFile(generatedFiles);
  if (previewFile) {
    return {
      previewStatus: "ready",
      detail: "Preview-ready STL/3MF artifact available.",
      previewFilePath: previewFile.path,
    };
  }

  const hasStep = generatedFiles.some((file) => {
    const lower = file.path.toLowerCase();
    return lower.endsWith(".step") || lower.endsWith(".stp");
  });

  if (hasStep) {
    return {
      previewStatus: "downgraded",
      detail: "Renderer produced STEP only. Download STEP or regenerate asking for STL/3MF export.",
      previewFilePath: null,
    };
  }

  return {
    previewStatus: "downgraded",
    detail: "No preview-ready artifact produced. Regenerate and ask for STL/3MF output.",
    previewFilePath: null,
  };
}

/**
 * Generate a short (max 5 words) chat name from the user's first prompt.
 * Fire-and-forget — failures are logged but do not affect the query pipeline.
 */
async function generateChatName(input: {
  userId: string;
  contextId: string;
  prompt: string;
}): Promise<void> {
  return runWithUsageContext(
    { userId: input.userId, chatContextId: input.contextId },
    () => generateChatNameInner(input),
  );
}

async function generateChatNameInner(input: {
  userId: string;
  contextId: string;
  prompt: string;
}): Promise<void> {
  try {
    const cfg = await getModelForPurpose("conversation");
    const providerModel = createProviderModelFromConfig(cfg);

    const truncatedPrompt = input.prompt.slice(0, 500);
    const result = await trackedGenerateText(
      {
        model: providerModel,
        prompt: `Summarize the following user request as a short chat title (maximum 5 words, no quotes, no punctuation at the end):\n\n"${truncatedPrompt}"`,
        maxOutputTokens: 30,
      },
      {
        purpose: "chat_naming",
        providerName: cfg.provider,
        modelId: cfg.id,
        modelName: cfg.modelName,
        modelConfig: cfg,
      },
    );

    const name = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 80);
    if (!name) {
      queryLogger.warn({ contextId: input.contextId }, "chat naming returned empty result");
      return;
    }

    // Track naming cost on the context
    const namingPT = result.usage?.inputTokens ?? 0;
    const namingCT = result.usage?.outputTokens ?? 0;
    const namingRT = (result.usage as Record<string, unknown>)?.reasoningTokens as number ?? 0;
    const namingCost = calculateCostUsd(cfg, namingPT, namingCT, namingRT);
    await incrementContextCost(input.contextId, namingCost);

    await updateChatContextService({
      userId: input.userId,
      contextId: input.contextId,
      name,
    });

    await notificationService.publishToUser(input.userId, "chat.context.renamed", {
      contextId: input.contextId,
      name,
    });

    queryLogger.info({ contextId: input.contextId, name, namingCost }, "auto-named chat context");
  } catch (err) {
    queryLogger.warn(
      { err: err instanceof Error ? err : String(err), contextId: input.contextId },
      "failed to auto-name chat context",
    );
  }
}

/**
 * Create user and assistant chat items for a query, returning the IDs immediately.
 * The actual pipeline (conversation → codegen → rendering) runs separately.
 */
export async function initiateQuery(input: {
  userId: string;
  contextId: string;
  prompt: string;
  attachments?: unknown;
}) {
  const prompt = input.prompt.trim();
  if (prompt === "") {
    throw new QueryServiceError("prompt is required", 400);
  }
  const attachments = normalizeQueryAttachments(input.attachments);

  const context = await ensureOwnedContext(input.userId, input.contextId);
  // Move files from tmp/ to chat/{contextId}/ and update attachment paths
  await relocateTempAttachments(input.contextId, attachments);
  await assertAttachmentsAccessible(input.userId, attachments);

  // Cancel any running pipeline in this context before starting a new one
  cancelPipelinesInContext(input.contextId, input.userId);

  // Detect first prompt before creating items
  const itemCount = await prisma.chatItem.count({
    where: { chatContextId: input.contextId, ownerId: input.userId },
  });
  const isFirstPrompt = itemCount === 0;

  const userMessages = [
    { itemType: "message", text: prompt, state: "completed", stateMessage: "" },
    ...attachments.map((attachment) => ({
      itemType: "attachment",
      text: `${attachment.kind === "image" ? "Image" : "File"} attached: ${attachment.filename}`,
      attachment: attachment.path,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      attachmentKind: attachment.kind,
      state: "completed",
      stateMessage: "",
      files: [{ path: attachment.path, filename: attachment.filename }],
    })),
  ];

  const userItem = await createChatItem({
    userId: input.userId,
    contextId: input.contextId,
    role: "user",
    messages: userMessages,
  });

  const assistantItem = await createChatItem({
    userId: input.userId,
    contextId: input.contextId,
    role: "assistant",
    messages: [{ itemType: "message", text: "Working on your request...", state: "pending", stateMessage: "" }],
  });

  return {
    contextId: input.contextId,
    userItem,
    assistantItem,
    prompt,
    attachments,
    context,
    isFirstPrompt,
  };
}

/**
 * Run the full query pipeline (conversation → codegen → rendering).
 * Publishes progress via SSE. Called after initiateQuery returns.
 */
export async function executeQueryPipeline(input: {
  userId: string;
  contextId: string;
  prompt: string;
  attachments: QueryAttachmentInput[];
  context: ChatContextRow;
  userItemId: string;
  assistantItemId: string;
  stream?: boolean;
  isFirstPrompt?: boolean;
}) {
  return runWithUsageContext(
    { userId: input.userId, chatContextId: input.contextId, chatItemId: input.assistantItemId },
    () => executeQueryPipelineInner(input),
  );
}

async function executeQueryPipelineInner(input: {
  userId: string;
  contextId: string;
  prompt: string;
  attachments: QueryAttachmentInput[];
  context: ChatContextRow;
  userItemId: string;
  assistantItemId: string;
  stream?: boolean;
  isFirstPrompt?: boolean;
}) {
  const { prompt, attachments } = input;
  const context = input.context;
  const assistantItemId = input.assistantItemId;

  const pipelineController = registerPipeline(assistantItemId, input.userId);
  const pipelineSignal = pipelineController.signal;

  // Pipeline timeout — abort after configured duration
  const chatTimeoutMs = await getPipelineTimeoutMs("chat");
  const pipelineTimeout = setTimeout(() => pipelineController.abort(), chatTimeoutMs);

  function checkAborted() {
    if (pipelineSignal.aborted) throw new PipelineCancelledError();
  }

  // Track partial conversation text for persistence on cancellation
  let accumulatedConversationText = "";

  // Auto-name the chat from the first prompt (fire-and-forget)
  if (input.isFirstPrompt) {
    void generateChatName({
      userId: input.userId,
      contextId: input.contextId,
      prompt: input.prompt,
    });
  }

  await publishQueryState({
    userId: input.userId,
    contextId: input.contextId,
    assistantItemId,
    state: "queued",
  });

  // Pipeline-wide cost accumulators — hoisted above try so they're accessible in the catch block
  let epTotalPromptTokens = 0;
  let epTotalCompletionTokens = 0;
  let epTotalReasoningTokens = 0;
  let epTotalCostUsd = 0;
  const epStartTime = Date.now();

  try {
    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId,
      state: "conversation",
    });

    // Buffer to strip the leading intent tag ([CHAT_ONLY] / [CODEGEN_NEEDED]) from streamed tokens.
    // Once the tag is consumed, remaining tokens pass through directly.
    let tagBuffer = "";
    let tagStripped = false;

    const emitToken = (t: string) => {
      accumulatedConversationText += t;
      sseService.publishStreamToken(input.userId, {
        contextId: input.contextId,
        assistantItemId,
        token: t,
        done: false,
      });
    };

    const onToken = input.stream
      ? (token: string) => {
          if (!tagStripped) {
            tagBuffer += token;
            // Check if we've accumulated enough to detect and strip the tag
            const chatMatch = tagBuffer.match(/^\[CHAT_ONLY\]\s*/);
            const codegenMatch = tagBuffer.match(/^\[CODEGEN_NEEDED\]\s*/);
            const match = chatMatch || codegenMatch;
            if (match) {
              tagStripped = true;
              const remainder = tagBuffer.slice(match[0].length);
              if (remainder) emitToken(remainder);
              return;
            }
            // If buffer doesn't start with '[', it's not a tag — flush everything
            if (!tagBuffer.startsWith("[")) {
              tagStripped = true;
              emitToken(tagBuffer);
              return;
            }
            // Still accumulating — wait for more tokens (max reasonable tag length ~20 chars)
            if (tagBuffer.length > 20) {
              // Tag too long, not a valid tag — flush buffer
              tagStripped = true;
              emitToken(tagBuffer);
            }
            return;
          }
          emitToken(token);
        }
      : undefined;

    /** Persist the running cost on the item so partial costs survive crashes/restarts. */
    const persistItemCost = () =>
      prisma.chatItem.update({
        where: { id: assistantItemId },
        data: {
          estimatedCostUsd: Number(epTotalCostUsd.toFixed(8)),
          promptTokens: epTotalPromptTokens,
          completionTokens: epTotalCompletionTokens,
        },
      });

    const conversationPrompt = `${prompt}${formatAttachmentContext(attachments)}`;

    // Fetch dynamic generation settings for the chat pipeline
    const chatMaxPairs = await getConversationHistoryMaxPairs();

    // Fetch conversation history for iterative refinement (Req 10)
    // Exclude the current user+assistant items we just created by fetching before they exist in context
    // The items we just created are already in the DB, so we exclude them by fetching items
    // created before the current user item. We use the item IDs to filter.
    const conversationHistory = await buildConversationContext(
      input.contextId,
      input.userId,
      chatMaxPairs,
      [input.userItemId, assistantItemId],
    );

    // Collect images from current turn + all previous turns for multimodal LLM calls
    const pipelineImages = await collectAllImages(
      input.contextId,
      input.userId,
      attachments,
      [input.userItemId, assistantItemId],
    );

    checkAborted();

    const conversation = input.stream && onToken
      ? await generateConversationTextStream({
          prompt: conversationPrompt,
          contextName: context.name,
          onToken,
          conversationHistory,
          images: pipelineImages.length > 0 ? pipelineImages : undefined,
          abortSignal: pipelineSignal,
        })
      : await generateConversationText({
          prompt: conversationPrompt,
          contextName: context.name,
          conversationHistory,
          images: pipelineImages.length > 0 ? pipelineImages : undefined,
          abortSignal: pipelineSignal,
        });

    if (input.stream) {
      sseService.publishStreamToken(input.userId, {
        contextId: input.contextId,
        assistantItemId,
        token: "",
        done: true,
      });
    }

    // Add conversation LLM cost to pipeline accumulators and persist immediately
    epTotalPromptTokens += conversation.usage.inputTokens;
    epTotalCompletionTokens += conversation.usage.outputTokens;
    epTotalReasoningTokens += conversation.usage.reasoningTokens;
    epTotalCostUsd += conversation.usage.estimatedCostUsd;
    await incrementContextCost(input.contextId, conversation.usage.estimatedCostUsd);
    await persistItemCost();

    // Parse conversation response to determine if codegen is needed
    const parsed = parseConversationResponse(conversation.text);
    const conversationText = parsed.text;
    queryLogger.info({ needsCodegen: parsed.needsCodegen, textLength: conversationText.length, textPreview: conversationText.slice(0, 120) }, "conversation LLM response parsed (streaming pipeline)");

    // If the conversation is chat-only (no 3D model requested), skip codegen/rendering
    if (!parsed.needsCodegen) {
      const chatOnlyCost = Number(epTotalCostUsd.toFixed(8));
      const chatOnlyMessages = [
        {
          itemType: "message",
          text: conversationText,
          state: "completed",
          stateMessage: "",
        },
        {
          itemType: "meta",
          text: "Chat diagnostics",
          state: "completed",
          stateMessage: "",
          usage: {
            inputTokens: epTotalPromptTokens,
            outputTokens: epTotalCompletionTokens,
            reasoningTokens: epTotalReasoningTokens,
            totalTokens: epTotalPromptTokens + epTotalCompletionTokens,
            estimatedCostUsd: chatOnlyCost,
            durationMs: Date.now() - epStartTime,
          },
        },
      ];

      await updateChatItem({
        userId: input.userId,
        contextId: input.contextId,
        itemId: assistantItemId,
        messages: chatOnlyMessages,
        promptTokens: epTotalPromptTokens,
        completionTokens: epTotalCompletionTokens,
        estimatedCostUsd: chatOnlyCost,
      });

      // Note: context cost was already persisted after the conversation call above

      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId,
        state: "completed",
      });

      return;
    }

    // Helper: persist the current pipeline phase to the DB so it survives page reloads.
    // Writes conversation text + a stateMessage describing the active phase.
    const persistPhase = (stateMessage: string) =>
      updateChatItem({
        userId: input.userId,
        contextId: input.contextId,
        itemId: assistantItemId,
        messages: [{ itemType: "message", text: conversationText, state: "pending", stateMessage }],
      });

    await persistPhase("Generating 3D model...");

    checkAborted();

    // ── Spec generation (disambiguation check) ──
    let epVerificationChecklist: string[] = [];
    let epCodeAssertions: import("./spec-generation.service.js").CodeAssertion[] = [];
    let epSpecInterpretation: string | undefined;
    let epSpecComplexity: "simple" | "medium" | "complex" | undefined;
    const specEnabled = await isSpecGenerationEnabled("chat");
    if (specEnabled) {
      await persistPhase("Analyzing request...");
      checkAborted();

      const specResult = await generateSpec(prompt);
      epTotalPromptTokens += specResult.promptTokens;
      epTotalCompletionTokens += specResult.completionTokens;
      // Track spec cost
      try {
        const specCfg = await getModelForPurpose("spec_generation").catch(() => getModelForPurpose("conversation"));
        const specCost = calculateCostUsd(specCfg, specResult.promptTokens, specResult.completionTokens);
        epTotalCostUsd += specCost;
        await incrementContextCost(input.contextId, specCost);
        await persistItemCost();
      } catch { /* spec cost tracking is best-effort */ }

      // Skip disambiguation for modification scenarios — the existing model provides context
      const hasBaseline = !!(await getProjectCode(input.contextId) ?? findMostRecentCode(conversationHistory));
      if (specResult.disambiguationNeeded && !hasBaseline) {
        queryLogger.info({ questions: specResult.disambiguationQuestions }, "prompt needs disambiguation — responding with questions");

        const questionText = formatDisambiguationResponse(conversationText, specResult);
        const disambigCost = Number(epTotalCostUsd.toFixed(8));

        await updateChatItem({
          userId: input.userId,
          contextId: input.contextId,
          itemId: assistantItemId,
          messages: [
            { itemType: "message", text: questionText, state: "completed", stateMessage: "" },
            {
              itemType: "meta",
              text: "Chat diagnostics",
              state: "completed",
              stateMessage: "",
              usage: {
                inputTokens: epTotalPromptTokens,
                outputTokens: epTotalCompletionTokens,
                reasoningTokens: epTotalReasoningTokens,
                totalTokens: epTotalPromptTokens + epTotalCompletionTokens,
                estimatedCostUsd: disambigCost,
                durationMs: Date.now() - epStartTime,
              },
            },
          ],
          promptTokens: epTotalPromptTokens,
          completionTokens: epTotalCompletionTokens,
          estimatedCostUsd: disambigCost,
        });

        await publishQueryState({
          userId: input.userId,
          contextId: input.contextId,
          assistantItemId,
          state: "completed",
        });

        return; // No codegen — wait for user's clarifying answer
      }

      epVerificationChecklist = specResult.verificationChecklist;
      epCodeAssertions = specResult.codeAssertions;
      epSpecInterpretation = specResult.interpretation;
      epSpecComplexity = specResult.complexity;

      queryLogger.info({ interpretation: specResult.interpretation.slice(0, 100), checklistCount: epVerificationChecklist.length, complexity: specResult.complexity }, "spec generated");
    }

    // ── Agent codegen ──
    const agentModelConfig = await getModelForPurpose("agent_codegen");
    queryLogger.info({ model: agentModelConfig.label, provider: agentModelConfig.provider }, "resolved agent_codegen model");

    {
      // Detect modification scenario
      const agBaselineCode = await getProjectCode(input.contextId) ?? findMostRecentCode(conversationHistory);
      const agIsModification = !!agBaselineCode;
      if (agIsModification) {
        queryLogger.info({ baselineCodeLength: agBaselineCode!.length }, "agent: modification scenario detected");
      }

      const [agMaxSteps, agEvalThreshold] = await Promise.all([
        getAgentMaxSteps("chat"),
        getAutoApproveThreshold("chat"),
      ]);
      const useMultiAgent = epSpecComplexity === "complex" && !agIsModification;
      const agMode = useMultiAgent ? "multi-agent" : "single-agent";
      const agDetail = useMultiAgent
        ? "Orchestrating multi-agent build for complex model..."
        : "Agent is working on your model...";
      await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: "codegen", detail: agDetail });
      await persistPhase(agDetail);
      queryLogger.info({ mode: agMode, complexity: epSpecComplexity }, "agent mode selected");

      const agentInput: Parameters<typeof runAgentCodegen>[0] = {
        promptText: prompt,
        interpretation: epSpecInterpretation,
        isModification: agIsModification,
        baselineCode: agBaselineCode ?? undefined,
        baseFileName: assistantItemId,
        maxSteps: agMaxSteps,
        modelConfig: agentModelConfig,
        complexity: epSpecComplexity,
        signal: pipelineSignal,
        onProgress: (state, detail) => {
          void publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: state as QueryState, detail });
        },
        evalThreshold: agEvalThreshold,
        codeAssertions: epCodeAssertions,
        specInterpretation: epSpecInterpretation,
      };

      const agResult = useMultiAgent
        ? await runMultiAgentCodegen(agentInput)
        : await runAgentCodegen(agentInput);

      // Track usage
      epTotalPromptTokens += agResult.usage.promptTokens;
      epTotalCompletionTokens += agResult.usage.completionTokens;
      epTotalReasoningTokens += agResult.usage.reasoningTokens;
      epTotalCostUsd += agResult.usage.totalCostUsd;
      await incrementContextCost(input.contextId, agResult.usage.totalCostUsd);
      await persistItemCost();

      // Take screenshots if render succeeded
      let agScreenshots: RenderedScreenshot[] = [];
      if (agResult.renderSuccess && agResult.renderedFiles.length > 0) {
        await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: "evaluating", detail: "Taking screenshots..." });
        try {
          const stlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
          const threemfFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".3mf"));
          const screenshotSource = stlFile ?? threemfFile;
          if (screenshotSource) {
            const ssResult = await renderModelScreenshots({
              modelData: screenshotSource.contentBase64,
              format: stlFile ? "stl" : "3mf",
            });
            agScreenshots = ssResult.images;
          }
        } catch (err) {
          queryLogger.warn({ err: err instanceof Error ? err.message : String(err) }, "agent: screenshot service failed (non-fatal)");
        }
      }

      // Persist files to storage
      const agFinalFiles: Array<{ path: string; filename: string }> = [];
      const agFinalCode = agResult.code;

      for (const file of agResult.renderedFiles) {
        const ext = mapExtension(file.filename);
        const rp = `chat/${input.contextId}/artifacts/${assistantItemId}.${ext}`;
        await writeStorageFile({ relativePath: rp, contentBase64: file.contentBase64 });
        agFinalFiles.push({ path: rp, filename: file.filename });
      }

      if (agFinalCode?.trim()) {
        const codeRelPath = `chat/${input.contextId}/code/${assistantItemId}.b123d`;
        await writeStorageFile({ relativePath: codeRelPath, contentBase64: Buffer.from(agFinalCode, "utf-8").toString("base64") });
        agFinalFiles.push({ path: codeRelPath, filename: `${assistantItemId}.b123d` });
      }

      const agScreenshotFiles: Array<{ path: string; filename: string }> = [];
      for (const ss of agScreenshots) {
        const ssPath = `chat/${input.contextId}/artifacts/${assistantItemId}-screenshot-${ss.angle}.png`;
        await writeStorageFile({ relativePath: ssPath, contentBase64: ss.base64 });
        agScreenshotFiles.push({ path: ssPath, filename: `${assistantItemId}-screenshot-${ss.angle}.png` });
      }

      // Persist project code tracking (multi-file for agent, single-file fallback)
      if (agFinalCode?.trim()) {
        try {
          if (agResult.files.length > 1) {
            await updateProjectFiles(input.contextId, agResult.files, assistantItemId);
          } else {
            await updateProjectCode(input.contextId, agFinalCode, assistantItemId);
          }
        } catch (err) {
          queryLogger.warn({ err: err instanceof Error ? err.message : String(err) }, "agent: failed to update project code (non-fatal)");
        }
      }

      // Post-loop code evaluation (runs VLM + code eval + assertions in parallel)
      // The agent uses VLM-only during its iteration loop; this adds code-level verification
      let postLoopEval: { compositeScore: number; visualScore: number | null; codeScore: number | null; assertionPassRate: number | null; source: string; vlmModel: string | null; codeReviewModel: string | null } | null = null;
      // Flatten multi-file project into single code string for eval
      const agAllCode = agResult.files.length > 1
        ? flattenForEval(agResult.files)
        : (agFinalCode ?? "");
      if (agAllCode.trim() && (agScreenshots.length > 0 || epCodeAssertions.length > 0)) {
        try {
          const chatCodeEvalWeight = await getCodeEvalWeight("chat");
          const postVlmImages = agScreenshots
            .filter(s => s.angle !== "isometric")
            .map(s => ({ angle: s.angle, base64: s.base64 }));
          const stlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));

          const fullEval = await runFullEvaluation({
            code: agAllCode,
            userPrompt: prompt,
            specInterpretation: epSpecInterpretation,
            codeAssertions: epCodeAssertions,
            images: postVlmImages,
            categoryName: "chat",
            complexity: 5,
            verificationChecklist: epVerificationChecklist,
            stlBase64: stlFile?.contentBase64,
            modelFormat: "stl",
            codeEvalWeight: chatCodeEvalWeight,
          });

          postLoopEval = {
            compositeScore: fullEval.compositeScore,
            visualScore: fullEval.visualScore,
            codeScore: fullEval.codeScore,
            assertionPassRate: fullEval.assertionPassRate,
            source: fullEval.source,
            vlmModel: fullEval.vlmModel,
            codeReviewModel: fullEval.codeReviewModel,
          };

          epTotalPromptTokens += fullEval.totalPromptTokens;
          epTotalCompletionTokens += fullEval.totalCompletionTokens;

          queryLogger.info(
            { compositeScore: fullEval.compositeScore, visualScore: fullEval.visualScore, codeScore: fullEval.codeScore, source: fullEval.source },
            "post-loop full evaluation completed",
          );
        } catch (err) {
          queryLogger.warn({ err: err instanceof Error ? err.message : String(err) }, "post-loop evaluation failed (non-fatal)");
        }
      }

      // Build assistant messages
      const agArtifact = summarizeArtifacts(agFinalFiles);
      const agUsage: QueryUsageSummary = {
        inputTokens: epTotalPromptTokens,
        outputTokens: epTotalCompletionTokens,
        reasoningTokens: epTotalReasoningTokens,
        totalTokens: epTotalPromptTokens + epTotalCompletionTokens,
        estimatedCostUsd: Number(epTotalCostUsd.toFixed(8)),
        durationMs: Date.now() - epStartTime,
      };

      const agAllFailed = agFinalFiles.length === 0;
      const agAssistantMessages = [
        { itemType: "message", text: conversationText, state: "completed", stateMessage: "" },
        ...(agFinalFiles.length > 0 ? [{
          itemType: "3dmodel",
          text: agArtifact.previewStatus === "ready" ? "Generated 3D preview." : `Preview unavailable in-browser. ${agArtifact.detail}`,
          attachment: agArtifact.previewFilePath ?? "",
          state: "completed",
          stateMessage: "",
          artifact: agArtifact,
          files: [...agFinalFiles, ...agScreenshotFiles],
          previews: agScreenshotFiles,
        }] : []),
        ...(agFinalCode?.trim() ? [{ itemType: "code", text: agFinalCode, state: "completed", stateMessage: "" }] : []),
        ...(agAllFailed ? [{
          itemType: "errormessage",
          text: "Agent codegen failed to produce a valid 3D model.",
          state: "error",
          stateMessage: "",
        }] : []),
        {
          itemType: "meta",
          text: "Generation diagnostics",
          state: "completed",
          stateMessage: "",
          usage: agUsage,
          artifact: agArtifact,
          llm: {
            conversationModel: "pipeline",
            codegenModel: agentModelConfig.label,
            vlmModel: postLoopEval?.vlmModel ?? agResult.evalResult?.vlmModel ?? null,
            evalScore: postLoopEval?.compositeScore ?? agResult.evalResult?.score ?? null,
            iterations: agResult.stepCount,
            ...(postLoopEval ? {
              codeReviewModel: postLoopEval.codeReviewModel,
              visualScore: postLoopEval.visualScore,
              codeScore: postLoopEval.codeScore,
              assertionPassRate: postLoopEval.assertionPassRate,
              evalSource: postLoopEval.source,
            } : {}),
          },
          files: agFinalFiles,
        },
      ];

      await updateChatItem({
        userId: input.userId,
        contextId: input.contextId,
        itemId: assistantItemId,
        messages: agAssistantMessages,
        promptTokens: epTotalPromptTokens,
        completionTokens: epTotalCompletionTokens,
        estimatedCostUsd: Number(epTotalCostUsd.toFixed(8)),
      });

      await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: "completed" });

      // Track generation count and mark onboarding complete on first generation
      void prisma.$executeRaw`
        UPDATE users
        SET generation_count = generation_count + 1,
            onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
        WHERE id = ${input.userId}::uuid
      `.catch(() => {/* non-critical */});

      void pushNotificationService.sendToUser(input.userId, {
        title: "Your 3D model is ready!",
        body: "Come back to Chat3D to see your generated model.",
        tag: `query-${assistantItemId}`,
        url: `/chat/${input.contextId}`,
      }).catch(() => {/* ignore push errors */});

      queryLogger.info(
        { steps: agResult.stepCount, submitted: agResult.submitted, renderSuccess: agResult.renderSuccess, fileCount: agFinalFiles.length, cost: Number(epTotalCostUsd.toFixed(6)) },
        "agent codegen pipeline completed",
      );

    }
  } catch (error) {
    // Handle cancellation: either our own PipelineCancelledError (from checkAborted()
    // at stage boundaries) or an AbortError thrown by the Vercel AI SDK when the
    // abort signal fires during an in-flight LLM call.
    if (error instanceof PipelineCancelledError || pipelineSignal.aborted) {
      queryLogger.info({ assistantItemId }, "query pipeline cancelled by user");

      const textToSave = accumulatedConversationText.trim() || "Generation was stopped.";
      await updateChatItem({
        userId: input.userId,
        contextId: input.contextId,
        itemId: assistantItemId,
        messages: [
          {
            itemType: "message",
            text: textToSave,
            state: "cancelled",
            stateMessage: "Stopped by user",
          },
        ],
        promptTokens: epTotalPromptTokens,
        completionTokens: epTotalCompletionTokens,
        estimatedCostUsd: Number(epTotalCostUsd.toFixed(8)),
      });

      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId,
        state: "cancelled",
      });

      return;
    }

    queryLogger.error({ err: error }, "query pipeline failed");
    const isQuota = error instanceof ProviderQuotaExhaustedError;
    const errorMessage = isQuota
      ? "LLM provider credits exhausted. Please check your API billing or switch to a different provider in Admin → Providers."
      : (error instanceof Error ? error.message : String(error));

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId,
      state: "failed",
      detail: errorMessage,
    });

    await updateChatItem({
      userId: input.userId,
      contextId: input.contextId,
      itemId: assistantItemId,
      messages: [
        {
          itemType: "errormessage",
          text: errorMessage,
          state: "error",
          stateMessage: "",
        },
      ],
      promptTokens: epTotalPromptTokens,
      completionTokens: epTotalCompletionTokens,
      estimatedCostUsd: Number(epTotalCostUsd.toFixed(8)),
    });

    // Best-effort push notification for failure
    void pushNotificationService.sendToUser(input.userId, {
      title: "Model generation encountered an issue",
      body: "Open Chat3D to see what happened.",
      tag: `query-${assistantItemId}`,
      url: `/chat/${input.contextId}`,
    }).catch(() => {/* ignore push errors */});
  } finally {
    clearTimeout(pipelineTimeout);
    // Recalculate context cost from item totals to correct any drift
    // from interrupted/resumed pipelines or double-counted increments.
    try {
      await recalculateContextCost(input.contextId);
    } catch (e) {
      queryLogger.warn({ err: e, contextId: input.contextId }, "failed to recalculate context cost");
    }
    unregisterPipeline(assistantItemId);
  }
}

// NOTE: submitQuery and regenerateQuery were removed. The /regenerate route now uses
// resolvePromptForRegeneration + initiateQuery + executeQueryPipeline directly,
// eliminating the duplicated codegen loop that previously existed here.
//
// This leaves executeQueryPipeline as the single codegen pipeline for both
// /submit and /regenerate flows.

// --- end of module ---
