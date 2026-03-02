import { generateText, NoOutputGeneratedError, streamText } from "ai";
import { ProviderQuotaExhaustedError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { withLlmRetry } from "../utils/llm-retry.js";
import { prisma } from "../db/prisma.js";
import { notificationService } from "./notification.service.js";
import { sseService } from "./sse.service.js";
import { createChatItem, updateChatItem, updateChatContext as updateChatContextService, ChatError } from "./chat.service.js";
import { FileStorageError, readStorageFile, writeStorageFile } from "./file-storage.service.js";
import {
  generateConversationText,
  generateConversationTextStream,
  parseConversationResponse,
  extractExecutableCode,
  findMostRecentCode,
  formatConversationHistory,
  LlmServiceError,
  type LlmUsageMetadata,
} from "./llm.service.js";
import { renderBuild123d, RenderingServiceError } from "./rendering.service.js";
import {
  classifyRenderError,
  buildEscalatedGuidance,
  renderWithInfraRetry,
  type ClassifiedRenderError,
  type RenderErrorContext,
} from "../utils/render-errors.js";
import {
  renderModelScreenshots,
  type RenderedScreenshot,
} from "./stl-rendering-client.service.js";
import { evaluateModel } from "./visual-eval.service.js";
import { pushNotificationService } from "./push-notification.service.js";
import { getActiveSystemPrompt } from "./workbench-seeder.service.js";
import { findSimilarExamples } from "./workbench-embeddings.service.js";
import {
  buildInitialPrompt,
  buildFixPrompt,
  buildModificationPrompt,
  wrapInTemplate,
  stripTemplateBoilerplate,
  MAX_FIX_ITERATIONS,
  AUTO_APPROVE_THRESHOLD,
} from "./workbench-codegen.service.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
  calculateCostUsd,
  type LlmModelConfig,
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

export type QueryState = "queued" | "conversation" | "codegen" | "rendering" | "evaluating" | "fixing" | "retrying" | "completed" | "failed" | "cancelled";

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
  totalTokens: number;
  estimatedCostUsd: number;
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
    where: { id: contextId, ownerId: userId },
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

function summarizeUsage(usageRecords: LlmUsageMetadata[]): QueryUsageSummary {
  return usageRecords.reduce<QueryUsageSummary>(
    (summary, usage) => ({
      inputTokens: summary.inputTokens + usage.inputTokens,
      outputTokens: summary.outputTokens + usage.outputTokens,
      totalTokens: summary.totalTokens + usage.totalTokens,
      estimatedCostUsd: Number((summary.estimatedCostUsd + usage.estimatedCostUsd).toFixed(8)),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    },
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
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
 * Resume pipelines for assistant items that were pending when the server last
 * shut down. Only items updated within the last `maxAgeMinutes` are resumed —
 * older items are assumed to be stuck for other reasons.
 *
 * Called once on server startup, after Prisma is connected.
 */
export async function resumeStalePipelines(maxAgeMinutes = 5): Promise<void> {
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

      const context = await prisma.chatContext.findFirst({
        where: { id: item.chatContextId, ownerId: item.ownerId },
        select: { id: true, name: true },
      });
      if (!context) {
        queryLogger.warn({ assistantItemId: item.id }, "context not found for stale item — skipping");
        continue;
      }

      queryLogger.info({ assistantItemId: item.id, contextId: item.chatContextId }, "re-firing pipeline for stale item");

      void executeQueryPipeline({
        userId: item.ownerId,
        contextId: item.chatContextId,
        prompt,
        attachments: [],
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
  try {
    const cfg = await getModelForPurpose("conversation");
    const providerModel = createProviderModelFromConfig(cfg);

    const truncatedPrompt = input.prompt.slice(0, 500);
    const result = await generateText({
      model: providerModel,
      prompt: `Summarize the following user request as a short chat title (maximum 5 words, no quotes, no punctuation at the end):\n\n"${truncatedPrompt}"`,
      maxTokens: 30,
    });

    const name = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 80);
    if (!name) {
      queryLogger.warn({ contextId: input.contextId }, "chat naming returned empty result");
      return;
    }

    await updateChatContextService({
      userId: input.userId,
      contextId: input.contextId,
      name,
    });

    await notificationService.publishToUser(input.userId, "chat.context.renamed", {
      contextId: input.contextId,
      name,
    });

    queryLogger.info({ contextId: input.contextId, name }, "auto-named chat context");
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
  await assertAttachmentsAccessible(input.userId, attachments);

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
  const { prompt, attachments } = input;
  const context = input.context;
  const assistantItemId = input.assistantItemId;

  const pipelineController = registerPipeline(assistantItemId, input.userId);
  const pipelineSignal = pipelineController.signal;

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

    const conversationPrompt = `${prompt}${formatAttachmentContext(attachments)}`;

    // Fetch conversation history for iterative refinement (Req 10)
    // Exclude the current user+assistant items we just created by fetching before they exist in context
    // The items we just created are already in the DB, so we exclude them by fetching items
    // created before the current user item. We use the item IDs to filter.
    const conversationHistory = await buildConversationContext(
      input.contextId,
      input.userId,
      5,
      [input.userItemId, assistantItemId],
    );

    checkAborted();

    const conversation = input.stream && onToken
      ? await generateConversationTextStream({
          prompt: conversationPrompt,
          contextName: context.name,
          onToken,
          conversationHistory,
          abortSignal: pipelineSignal,
        })
      : await generateConversationText({
          prompt: conversationPrompt,
          contextName: context.name,
          conversationHistory,
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

    // Parse conversation response to determine if codegen is needed
    const parsed = parseConversationResponse(conversation.text);
    const conversationText = parsed.text;
    queryLogger.info({ needsCodegen: parsed.needsCodegen, textLength: conversationText.length, textPreview: conversationText.slice(0, 120) }, "conversation LLM response parsed (streaming pipeline)");

    // If the conversation is chat-only (no 3D model requested), skip codegen/rendering
    if (!parsed.needsCodegen) {
      const chatOnlyMessages = [
        {
          itemType: "message",
          text: conversationText,
          state: "completed",
          stateMessage: "",
        },
      ];

      await updateChatItem({
        userId: input.userId,
        contextId: input.contextId,
        itemId: assistantItemId,
        messages: chatOnlyMessages,
      });

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

    // ── Workbench-style iteration loop: codegen → render → VLM eval → fix ──

    let epSystemPromptContent = "";
    try {
      const spRow = await getActiveSystemPrompt();
      epSystemPromptContent = spRow.content;
      queryLogger.info({ promptLength: epSystemPromptContent.length }, "loaded active system prompt");
    } catch (err) { queryLogger.warn({ err: err instanceof Error ? err.message : String(err) }, "no active system prompt found, using empty"); }

    let epFewShots: Array<{ prompt: string; code: string }> = [];
    try {
      epFewShots = (await findSimilarExamples(prompt, 6)).map(({ prompt: p, code }) => ({ prompt: p, code }));
      queryLogger.info({ fewShotCount: epFewShots.length }, "loaded few-shot examples");
    } catch (err) { queryLogger.warn({ err: err instanceof Error ? err.message : String(err) }, "few-shot retrieval failed in executeQueryPipeline"); }

    const epCodegenConfig = await getModelForPurpose("chat_codegen");
    const epCodegenModel = createProviderModelFromConfig(epCodegenConfig);
    const epExtraOpts = buildGenerateOptions(epCodegenConfig);
    queryLogger.info({ model: epCodegenConfig.label, provider: epCodegenConfig.provider, modelName: epCodegenConfig.modelName, maxOutputTokens: epCodegenConfig.maxOutputTokens, thinkingEffort: epCodegenConfig.thinkingEffort, supportsThinking: epCodegenConfig.supportsThinking }, "resolved chat codegen model");

    // Detect modification scenario: check if conversation history has previous Build123d code
    const epBaselineCode = findMostRecentCode(conversationHistory);
    const epConvHistoryText = formatConversationHistory(conversationHistory);
    const epIsModification = !!epBaselineCode;
    if (epIsModification) {
      queryLogger.info({ baselineCodeLength: epBaselineCode!.length }, "modification scenario detected — will use baseline code for iteration 1");
    }

    let epTotalPromptTokens = 0;
    let epTotalCompletionTokens = 0;
    let epTotalCostUsd = 0;
    let epCurrentCode = "";
    let epRenderError: string | null = null;
    let epRenderErrorCtx: RenderErrorContext | null = null;
    const epErrorHistory: ClassifiedRenderError[] = [];
    interface EpEvalState { score: number; issues: string[]; suggestions: string[]; vlmModel: string; }
    let epEvalState: EpEvalState | null = null;
    let epBest: { code: string; score: number | null; evalState: EpEvalState | null; renderedFiles: Array<{ filename: string; contentBase64: string }>; screenshots: RenderedScreenshot[]; iteration: number } | null = null;

    for (let iteration = 1; iteration <= MAX_FIX_ITERATIONS; iteration++) {
      checkAborted();
      const isFirst = iteration === 1;
      await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: isFirst ? "codegen" : "fixing", detail: isFirst ? "Generating code..." : `Improving model (attempt ${iteration}/${MAX_FIX_ITERATIONS})...` });
      await persistPhase(isFirst ? "Generating code..." : `Improving model (attempt ${iteration}/${MAX_FIX_ITERATIONS})...`);

      const cgPrompt = isFirst
        ? (epIsModification
            ? buildModificationPrompt(epSystemPromptContent, epFewShots, prompt, epBaselineCode!, conversationText, epConvHistoryText || undefined)
            : buildInitialPrompt(epSystemPromptContent, epFewShots, prompt))
        : buildFixPrompt(epSystemPromptContent, epFewShots, prompt, epCurrentCode, iteration - 1, epRenderError, epEvalState?.issues ?? null, epEvalState?.suggestions ?? null, epRenderErrorCtx);

      queryLogger.info({ iteration, maxIterations: MAX_FIX_ITERATIONS, isFirst, promptLength: cgPrompt.length }, "codegen iteration starting");
      const epUseFallbackStream = epCodegenConfig.provider === "bedrock" && epCodegenConfig.supportsThinking && epCodegenConfig.thinkingEffort;
      const epLlmSemaphore = getLlmSemaphore(epCodegenConfig.provider, epCodegenConfig.maxConcurrent);
      const cgResult = await epLlmSemaphore.run(
        () => withLlmRetry(
          async () => {
            if (epUseFallbackStream) {
              // Bedrock's synchronous API does not support thinking — use streaming via fullStream
              // so we can track both reasoning and text progress.
              const stream = streamText({ model: epCodegenModel, prompt: cgPrompt, ...epExtraOpts });
              let text = "";
              let reasoningChars = 0;
              let lastUpdateLen = 0;
              let phase: "thinking" | "generating" = "thinking";
              const stateLabel = isFirst ? "codegen" : "fixing" as const;

              for await (const part of stream.fullStream) {
                if (part.type === "reasoning-delta") {
                  reasoningChars += part.text.length;
                  if (reasoningChars - lastUpdateLen >= 500) {
                    lastUpdateLen = reasoningChars;
                    const detail = isFirst
                      ? `Thinking... (${reasoningChars} chars)`
                      : `Thinking (attempt ${iteration}/${MAX_FIX_ITERATIONS})... (${reasoningChars} chars)`;
                    void publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: stateLabel, detail });
                    queryLogger.debug({ iteration, reasoningChars }, "codegen thinking progress");
                  }
                } else if (part.type === "text-delta") {
                  if (phase === "thinking") {
                    phase = "generating";
                    lastUpdateLen = 0;
                    queryLogger.info({ iteration, totalReasoningChars: reasoningChars }, "codegen thinking complete, generating code");
                  }
                  text += part.text;
                  if (text.length - lastUpdateLen >= 500) {
                    lastUpdateLen = text.length;
                    const detail = isFirst
                      ? `Generating code... (${text.length} chars)`
                      : `Writing code (attempt ${iteration}/${MAX_FIX_ITERATIONS})... (${text.length} chars)`;
                    void publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: stateLabel, detail });
                    queryLogger.debug({ iteration, chars: text.length }, "codegen text progress");
                  }
                }
              }
              queryLogger.info({ iteration, reasoningChars, textChars: text.length }, "codegen streaming complete");
              let finalResult;
              try {
                finalResult = await stream;
              } catch (err) {
                if (err instanceof NoOutputGeneratedError) {
                  throw new LlmServiceError("LLM returned empty output (no text generated)", 502);
                }
                throw err;
              }
              return { text, reasoningText: finalResult.reasoningText, reasoning: finalResult.reasoning, usage: finalResult.usage };
            }
            return generateText({ model: epCodegenModel, prompt: cgPrompt, ...epExtraOpts });
          },
          { provider: epCodegenConfig.provider },
        ),
        {
          onQueuePositionChange: (position, total) => {
            void publishQueryState({
              userId: input.userId, contextId: input.contextId, assistantItemId,
              state: "queued",
              detail: `Waiting for LLM slot (${position}/${total} in queue)`,
            });
          },
        },
      );
      if (cgResult.reasoningText) {
        queryLogger.info(
          { iteration, provider: epCodegenConfig.provider, model: epCodegenConfig.modelName, reasoningLength: cgResult.reasoningText.length },
          "chat codegen thinking output received",
        );
        queryLogger.trace(
          { iteration, reasoning: cgResult.reasoningText },
          "chat codegen thinking output content",
        );
      } else {
        queryLogger.debug(
          { iteration, provider: epCodegenConfig.provider, model: epCodegenConfig.modelName, reasoningBlocks: cgResult.reasoning?.length ?? 0 },
          "no thinking output in chat codegen response",
        );
      }
      epCurrentCode = stripTemplateBoilerplate(extractExecutableCode(cgResult.text));
      const cgPT = cgResult.usage?.inputTokens ?? 0;
      const cgCT = cgResult.usage?.outputTokens ?? 0;
      epTotalPromptTokens += cgPT;
      epTotalCompletionTokens += cgCT;
      epTotalCostUsd += calculateCostUsd(epCodegenConfig, cgPT, cgCT);
      queryLogger.info({ iteration, codeLength: epCurrentCode.length, inputTokens: cgPT, outputTokens: cgCT }, "codegen iteration completed");

      epRenderError = null;
      epRenderErrorCtx = null;
      epEvalState = null;

      checkAborted();
      await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: "rendering", detail: "Rendering 3D model..." });
      await persistPhase("Rendering 3D model...");

      const epBaseFileName = `chat-${assistantItemId.slice(0, 8)}-iter${iteration}`;
      const epExecCode = wrapInTemplate(epCurrentCode, epBaseFileName);
      let epRenderedFiles: Awaited<ReturnType<typeof renderBuild123d>>["files"] = [];

      const epRenderOutcome = await renderWithInfraRetry(
        () => renderBuild123d(
          { code: epExecCode, baseFileName: epBaseFileName },
          {
            onQueuePositionChange: (position, total) => {
              void publishQueryState({
                userId: input.userId, contextId: input.contextId, assistantItemId,
                state: "queued",
                detail: `Waiting for rendering slot (${position}/${total} in queue)`,
              });
            },
          },
        ),
        {
          onRetry: (attempt, classified) => {
            queryLogger.info({ attempt, category: classified.category, iteration }, "infrastructure retry for Build123d");
          },
        },
      );

      if (epRenderOutcome.ok) {
        epRenderedFiles = epRenderOutcome.result.files;
        queryLogger.info({ iteration, fileCount: epRenderedFiles.length }, "render succeeded");
      } else {
        const classified = epRenderOutcome.error;
        epErrorHistory.push(classified);
        epRenderError = classified.rawMessage;
        const escalation = buildEscalatedGuidance(classified, epErrorHistory.slice(0, -1));
        epRenderErrorCtx = { classified, escalationGuidance: escalation };
        queryLogger.warn({ iteration, renderError: epRenderError, category: classified.category }, "render failed");
        if (iteration >= MAX_FIX_ITERATIONS) break;
        continue;
      }

      // Screenshots + VLM eval
      let epScreenshots: RenderedScreenshot[] = [];
      let epScreenshotFailed = false;
      const epStl = epRenderedFiles.find((f) => f.filename.toLowerCase().endsWith(".stl"));
      if (epStl) {
        try {
          epScreenshots = (await renderModelScreenshots(
            { modelData: epStl.contentBase64, format: "stl", width: 512, height: 512 },
            {
              onQueuePositionChange: (position, total) => {
                void publishQueryState({
                  userId: input.userId, contextId: input.contextId, assistantItemId,
                  state: "queued",
                  detail: `Waiting for screenshot slot (${position}/${total} in queue)`,
                });
              },
            },
          )).images;
        } catch (err) {
          queryLogger.warn({ iteration, err: err instanceof Error ? err.message : String(err) }, "screenshot service failed after retries — not a code issue");
          epScreenshotFailed = true;
        }
      }

      checkAborted();
      if (epScreenshots.length > 0) {
        await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: "evaluating", detail: `Evaluating quality (attempt ${iteration}/${MAX_FIX_ITERATIONS})...` });
        await persistPhase(`Evaluating quality (attempt ${iteration}/${MAX_FIX_ITERATIONS})...`);
        try {
          const evr = await evaluateModel({ userPrompt: prompt, categoryName: "chat", complexity: 5, images: epScreenshots.filter((s) => s.angle !== "isometric").map((s) => ({ angle: s.angle, base64: s.base64 })) });
          epTotalPromptTokens += evr.promptTokens;
          epTotalCompletionTokens += evr.completionTokens;
          epTotalCostUsd += calculateCostUsd(await getModelForPurpose("vlm_eval"), evr.promptTokens, evr.completionTokens);
          epEvalState = { score: evr.score, issues: evr.issues, suggestions: evr.suggestions, vlmModel: evr.vlmModel };
          queryLogger.info({ iteration, score: evr.score, issueCount: evr.issues.length, vlmModel: evr.vlmModel }, "VLM evaluation completed");
        } catch (err) { queryLogger.warn({ iteration, err: err instanceof Error ? err.message : String(err) }, "VLM evaluation failed, skipping"); }
      }

      const epScore = epEvalState?.score ?? null;
      if (!epBest || (epScore !== null && (epBest.score === null || epScore > epBest.score))) {
        epBest = { code: epCurrentCode, score: epScore, evalState: epEvalState, renderedFiles: epRenderedFiles.map((f) => ({ filename: f.filename, contentBase64: f.contentBase64 })), screenshots: [...epScreenshots], iteration };
      }

      // If screenshot service failed (not a code issue), stop the loop immediately.
      // The code rendered fine — retrying with AI regeneration is wasteful.
      if (epScreenshotFailed) {
        queryLogger.info({ iteration }, "screenshot service failed — stopping fix loop (render was successful)");
        break;
      }

      const epApproved = epScore !== null && epScore >= AUTO_APPROVE_THRESHOLD;
      if ((epApproved && (epEvalState?.issues ?? []).length === 0) || iteration >= MAX_FIX_ITERATIONS) break;
    }

    // Persist only the best iteration's files to disk.
    const epFinalFiles: Array<{ path: string; filename: string }> = [];
    const epFinalCode = epBest?.code ?? epCurrentCode;

    // Save rendered model files (STL, STEP, 3MF)
    for (const file of epBest?.renderedFiles ?? []) {
      const ext = mapExtension(file.filename);
      const rp = `chat/${input.contextId}/${assistantItemId}.${ext}`;
      await writeStorageFile({ relativePath: rp, contentBase64: file.contentBase64 });
      epFinalFiles.push({ path: rp, filename: file.filename });
    }

    // Save the best code as .b123d file for future workbench routing
    if (epFinalCode?.trim()) {
      const codeRelPath = `chat/${input.contextId}/${assistantItemId}.b123d`;
      await writeStorageFile({ relativePath: codeRelPath, contentBase64: Buffer.from(epFinalCode, "utf-8").toString("base64") });
      epFinalFiles.push({ path: codeRelPath, filename: `${assistantItemId}.b123d` });
    }

    // Save preview screenshots as PNGs for future workbench routing
    const epScreenshotFiles: Array<{ path: string; filename: string }> = [];
    for (const ss of epBest?.screenshots ?? []) {
      const ssPath = `chat/${input.contextId}/${assistantItemId}-screenshot-${ss.angle}.png`;
      await writeStorageFile({ relativePath: ssPath, contentBase64: ss.base64 });
      epScreenshotFiles.push({ path: ssPath, filename: `${assistantItemId}-screenshot-${ss.angle}.png` });
    }

    const epFinalEval = epBest?.evalState ?? epEvalState;
    queryLogger.info({
      bestIteration: epBest?.iteration ?? null,
      bestScore: epBest?.score ?? null,
      finalFileCount: epFinalFiles.length,
      totalPromptTokens: epTotalPromptTokens,
      totalCompletionTokens: epTotalCompletionTokens,
      totalCostUsd: Number(epTotalCostUsd.toFixed(6)),
      lastRenderError: epRenderError,
    }, "iteration loop completed");
    const epArtifact = summarizeArtifacts(epFinalFiles);
    const epUsage: QueryUsageSummary = {
      inputTokens: epTotalPromptTokens,
      outputTokens: epTotalCompletionTokens,
      totalTokens: epTotalPromptTokens + epTotalCompletionTokens,
      estimatedCostUsd: Number(epTotalCostUsd.toFixed(8)),
    };

    const epAllFailed = epFinalFiles.length === 0;
    const epAssistantMessages = [
      { itemType: "message", text: conversationText, state: "completed", stateMessage: "" },
      ...(epFinalFiles.length > 0 ? [{
        itemType: "3dmodel",
        text: epArtifact.previewStatus === "ready" ? "Generated 3D preview." : `Preview unavailable in-browser. ${epArtifact.detail}`,
        attachment: epArtifact.previewFilePath ?? "",
        state: "completed",
        stateMessage: "",
        artifact: epArtifact,
        files: [...epFinalFiles, ...epScreenshotFiles],
        previews: epScreenshotFiles,
      }] : []),
      ...(epFinalCode?.trim() ? [{ itemType: "code", text: epFinalCode, state: "completed", stateMessage: "" }] : []),
      // Show error segment when all iterations failed to produce a renderable model
      ...(epAllFailed ? [{
        itemType: "errormessage",
        text: epRenderError ?? "All code generation attempts failed to produce a valid 3D model.",
        state: "error",
        stateMessage: "",
      }] : []),
      {
        itemType: "meta",
        text: "Generation diagnostics",
        state: "completed",
        stateMessage: "",
        usage: epUsage,
        artifact: epArtifact,
        llm: { conversationModel: "pipeline", codegenModel: epCodegenConfig.label, vlmModel: epFinalEval?.vlmModel ?? null, evalScore: epFinalEval?.score ?? null, iterations: epBest?.iteration ?? 1 },
        files: epFinalFiles,
      },
    ];

    await updateChatItem({
      userId: input.userId,
      contextId: input.contextId,
      itemId: assistantItemId,
      messages: epAssistantMessages,
      promptTokens: epTotalPromptTokens,
      completionTokens: epTotalCompletionTokens,
      estimatedCostUsd: Number(epTotalCostUsd.toFixed(8)),
    });

    await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: "completed" });

    // Best-effort push notification — never blocks or fails the pipeline
    void pushNotificationService.sendToUser(input.userId, {
      title: "Your 3D model is ready!",
      body: "Come back to Chat3D to see your generated model.",
      tag: `query-${assistantItemId}`,
      url: `/chat/${input.contextId}`,
    }).catch(() => {/* ignore push errors */});
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
    });

    // Best-effort push notification for failure
    void pushNotificationService.sendToUser(input.userId, {
      title: "Model generation encountered an issue",
      body: "Open Chat3D to see what happened.",
      tag: `query-${assistantItemId}`,
      url: `/chat/${input.contextId}`,
    }).catch(() => {/* ignore push errors */});
  } finally {
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
