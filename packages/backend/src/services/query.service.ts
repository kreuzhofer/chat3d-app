import { generateText } from "ai";
import { ProviderQuotaExhaustedError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { withLlmRetry } from "../utils/llm-retry.js";
import { query } from "../db/connection.js";
import { notificationService } from "./notification.service.js";
import { sseService } from "./sse.service.js";
import { createChatItem, updateChatItem, ChatError } from "./chat.service.js";
import { FileStorageError, readStorageFile, writeStorageFile } from "./file-storage.service.js";
import {
  generateConversationText,
  generateConversationTextStream,
  parseConversationResponse,
  extractExecutableCode,
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
import { getActiveSystemPrompt } from "./workbench-seeder.service.js";
import { findSimilarExamples } from "./workbench-embeddings.service.js";
import {
  buildInitialPrompt,
  buildFixPrompt,
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

export type QueryState = "queued" | "conversation" | "codegen" | "rendering" | "evaluating" | "fixing" | "retrying" | "completed" | "failed";

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
  const result = await query<ChatItemHistoryRow>(
    `
    SELECT id, role, messages, created_at::text
    FROM chat_items
    WHERE chat_context_id = $1
      AND owner_id = $2
      AND id != ALL($3::uuid[])
    ORDER BY created_at DESC
    LIMIT $4;
    `,
    [contextId, userId, excludeIds, limit],
  );

  // Reverse to chronological order
  const items = result.rows.reverse();

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
  const result = await query<ChatContextRow>(
    `
    SELECT id, name
    FROM chat_contexts
    WHERE id = $1
      AND owner_id = $2;
    `,
    [contextId, userId],
  );

  const context = result.rows[0];
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

async function resolvePromptForRegeneration(input: {
  userId: string;
  contextId: string;
  assistantItemId: string;
}): Promise<string> {
  const assistantItemResult = await query<OwnedAssistantItemRow>(
    `
    SELECT id, created_at::text, role
    FROM chat_items
    WHERE id = $1
      AND chat_context_id = $2
      AND owner_id = $3
      AND role = 'assistant'
    LIMIT 1;
    `,
    [input.assistantItemId, input.contextId, input.userId],
  );

  const assistantItem = assistantItemResult.rows[0];
  if (!assistantItem) {
    throw new QueryServiceError("Assistant item not found", 404);
  }

  const promptResult = await query<UserPromptRow>(
    `
    SELECT messages
    FROM chat_items
    WHERE chat_context_id = $1
      AND owner_id = $2
      AND role = 'user'
      AND created_at <= $3::timestamptz
    ORDER BY created_at DESC
    LIMIT 1;
    `,
    [input.contextId, input.userId, assistantItem.created_at],
  );

  const prompt = extractPromptFromMessages(promptResult.rows[0]?.messages);
  if (!prompt) {
    throw new QueryServiceError("Unable to resolve original prompt for regeneration", 400);
  }

  return prompt;
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
}) {
  const { prompt, attachments } = input;
  const context = input.context;
  const assistantItemId = input.assistantItemId;

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
              if (remainder) {
                sseService.publishStreamToken(input.userId, {
                  contextId: input.contextId,
                  assistantItemId,
                  token: remainder,
                  done: false,
                });
              }
              return;
            }
            // If buffer doesn't start with '[', it's not a tag — flush everything
            if (!tagBuffer.startsWith("[")) {
              tagStripped = true;
              sseService.publishStreamToken(input.userId, {
                contextId: input.contextId,
                assistantItemId,
                token: tagBuffer,
                done: false,
              });
              return;
            }
            // Still accumulating — wait for more tokens (max reasonable tag length ~20 chars)
            if (tagBuffer.length > 20) {
              // Tag too long, not a valid tag — flush buffer
              tagStripped = true;
              sseService.publishStreamToken(input.userId, {
                contextId: input.contextId,
                assistantItemId,
                token: tagBuffer,
                done: false,
              });
            }
            return;
          }
          sseService.publishStreamToken(input.userId, {
            contextId: input.contextId,
            assistantItemId,
            token,
            done: false,
          });
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

    const conversation = input.stream && onToken
      ? await generateConversationTextStream({
          prompt: conversationPrompt,
          contextName: context.name,
          onToken,
          conversationHistory,
        })
      : await generateConversationText({
          prompt: conversationPrompt,
          contextName: context.name,
          conversationHistory,
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
    queryLogger.info({ model: epCodegenConfig.label, provider: epCodegenConfig.provider, modelName: epCodegenConfig.modelName, maxOutputTokens: epCodegenConfig.maxOutputTokens }, "resolved chat codegen model");

    let epTotalPromptTokens = 0;
    let epTotalCompletionTokens = 0;
    let epTotalCostUsd = 0;
    let epCurrentCode = "";
    let epRenderError: string | null = null;
    let epRenderErrorCtx: RenderErrorContext | null = null;
    const epErrorHistory: ClassifiedRenderError[] = [];
    interface EpEvalState { score: number; issues: string[]; suggestions: string[]; vlmModel: string; }
    let epEvalState: EpEvalState | null = null;
    let epBest: { code: string; score: number | null; evalState: EpEvalState | null; generatedFiles: Array<{ path: string; filename: string }>; screenshots: RenderedScreenshot[]; iteration: number } | null = null;

    for (let iteration = 1; iteration <= MAX_FIX_ITERATIONS; iteration++) {
      const isFirst = iteration === 1;
      await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: isFirst ? "codegen" : "fixing", detail: isFirst ? "Generating code..." : `Improving model (attempt ${iteration}/${MAX_FIX_ITERATIONS})...` });

      const cgPrompt = isFirst
        ? buildInitialPrompt(epSystemPromptContent, epFewShots, prompt)
        : buildFixPrompt(epSystemPromptContent, epFewShots, prompt, epCurrentCode, iteration - 1, epRenderError, epEvalState?.issues ?? null, epEvalState?.suggestions ?? null, epRenderErrorCtx);

      queryLogger.info({ iteration, maxIterations: MAX_FIX_ITERATIONS, isFirst, promptLength: cgPrompt.length }, "codegen iteration starting");
      const epLlmSemaphore = getLlmSemaphore(epCodegenConfig.provider, epCodegenConfig.maxConcurrent);
      const cgResult = await epLlmSemaphore.run(
        () => withLlmRetry(
          () => generateText({ model: epCodegenModel, prompt: cgPrompt, ...epExtraOpts }),
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

      await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: "rendering", detail: "Rendering 3D model..." });

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

      if (epScreenshots.length > 0) {
        await publishQueryState({ userId: input.userId, contextId: input.contextId, assistantItemId, state: "evaluating", detail: `Evaluating quality (attempt ${iteration}/${MAX_FIX_ITERATIONS})...` });
        try {
          const evr = await evaluateModel({ userPrompt: prompt, categoryName: "chat", complexity: 5, images: epScreenshots.map((s) => s.base64) });
          epTotalPromptTokens += evr.promptTokens;
          epTotalCompletionTokens += evr.completionTokens;
          epTotalCostUsd += calculateCostUsd(await getModelForPurpose("vlm_eval"), evr.promptTokens, evr.completionTokens);
          epEvalState = { score: evr.score, issues: evr.issues, suggestions: evr.suggestions, vlmModel: evr.vlmModel };
          queryLogger.info({ iteration, score: evr.score, issueCount: evr.issues.length, vlmModel: evr.vlmModel }, "VLM evaluation completed");
        } catch (err) { queryLogger.warn({ iteration, err: err instanceof Error ? err.message : String(err) }, "VLM evaluation failed, skipping"); }
      }

      const epIterFiles: Array<{ path: string; filename: string }> = [];
      for (const file of epRenderedFiles) {
        const ext = mapExtension(file.filename);
        const rp = `chat/${input.contextId}/${assistantItemId}.${ext}`;
        await writeStorageFile({ relativePath: rp, contentBase64: file.contentBase64 });
        epIterFiles.push({ path: rp, filename: file.filename });
      }

      const epScore = epEvalState?.score ?? null;
      if (!epBest || (epScore !== null && (epBest.score === null || epScore > epBest.score))) {
        epBest = { code: epCurrentCode, score: epScore, evalState: epEvalState, generatedFiles: epIterFiles, screenshots: [...epScreenshots], iteration };
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

    const epFinalFiles = [...(epBest?.generatedFiles ?? [])];
    const epFinalCode = epBest?.code ?? epCurrentCode;

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
  } catch (error) {
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
  }
}

export async function submitQuery(input: {
  userId: string;
  contextId: string;
  prompt: string;
  attachments?: unknown;
  stream?: boolean;
}) {
  const prompt = input.prompt.trim();
  if (prompt === "") {
    throw new QueryServiceError("prompt is required", 400);
  }
  const attachments = normalizeQueryAttachments(input.attachments);

  const context = await ensureOwnedContext(input.userId, input.contextId);
  await assertAttachmentsAccessible(input.userId, attachments);

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

  await publishQueryState({
    userId: input.userId,
    contextId: input.contextId,
    assistantItemId: assistantItem.id,
    state: "queued",
  });

  try {
    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "conversation",
    });

    // Buffer to strip the leading intent tag ([CHAT_ONLY] / [CODEGEN_NEEDED]) from streamed tokens.
    let regenTagBuffer = "";
    let regenTagStripped = false;

    const onToken = input.stream
      ? (token: string) => {
          if (!regenTagStripped) {
            regenTagBuffer += token;
            const chatMatch = regenTagBuffer.match(/^\[CHAT_ONLY\]\s*/);
            const codegenMatch = regenTagBuffer.match(/^\[CODEGEN_NEEDED\]\s*/);
            const match = chatMatch || codegenMatch;
            if (match) {
              regenTagStripped = true;
              const remainder = regenTagBuffer.slice(match[0].length);
              if (remainder) {
                sseService.publishStreamToken(input.userId, {
                  contextId: input.contextId,
                  assistantItemId: assistantItem.id,
                  token: remainder,
                  done: false,
                });
              }
              return;
            }
            if (!regenTagBuffer.startsWith("[")) {
              regenTagStripped = true;
              sseService.publishStreamToken(input.userId, {
                contextId: input.contextId,
                assistantItemId: assistantItem.id,
                token: regenTagBuffer,
                done: false,
              });
              return;
            }
            if (regenTagBuffer.length > 20) {
              regenTagStripped = true;
              sseService.publishStreamToken(input.userId, {
                contextId: input.contextId,
                assistantItemId: assistantItem.id,
                token: regenTagBuffer,
                done: false,
              });
            }
            return;
          }
          sseService.publishStreamToken(input.userId, {
            contextId: input.contextId,
            assistantItemId: assistantItem.id,
            token,
            done: false,
          });
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
      [userItem.id, assistantItem.id],
    );

    const conversation = input.stream && onToken
      ? await generateConversationTextStream({
          prompt: conversationPrompt,
          contextName: context.name,
          onToken,
          conversationHistory,
        })
      : await generateConversationText({
          prompt: conversationPrompt,
          contextName: context.name,
          conversationHistory,
        });

    if (input.stream) {
      sseService.publishStreamToken(input.userId, {
        contextId: input.contextId,
        assistantItemId: assistantItem.id,
        token: "",
        done: true,
      });
    }

    // Parse conversation response to determine if codegen is needed
    const parsed = parseConversationResponse(conversation.text);
    const conversationText = parsed.text;
    queryLogger.info({ needsCodegen: parsed.needsCodegen, textLength: conversationText.length, textPreview: conversationText.slice(0, 120) }, "conversation LLM response parsed (legacy pipeline)");

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

      const finalizedAssistantItem = await updateChatItem({
        userId: input.userId,
        contextId: input.contextId,
        itemId: assistantItem.id,
        messages: chatOnlyMessages,
      });

      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId: assistantItem.id,
        state: "completed",
      });

      return {
        contextId: input.contextId,
        userItemId: userItem.id,
        assistantItem: finalizedAssistantItem,
        generatedFiles: [],
        llm: {
          conversationModel: conversation.model.id,
          codegenModel: "",
        },
        usage: summarizeUsage([conversation.usage]),
        renderer: "none",
      };
    }

    // ── Workbench-style iteration loop: codegen → render → VLM eval → fix ──

    // Load workbench assets (fail-open for few-shot examples)
    let systemPromptContent = "";
    try {
      const systemPromptRow = await getActiveSystemPrompt();
      systemPromptContent = systemPromptRow.content;
    } catch {
      queryLogger.warn("no active system prompt found, using empty");
    }

    let fewShotExamples: Array<{ prompt: string; code: string }> = [];
    try {
      fewShotExamples = (await findSimilarExamples(prompt, 6)).map(({ prompt: p, code }) => ({ prompt: p, code }));
      queryLogger.info({ count: fewShotExamples.length }, "few-shot examples loaded for chat codegen");
    } catch {
      queryLogger.warn("few-shot example retrieval failed, proceeding without");
    }

    // Resolve codegen model from DB config
    const codegenConfig = await getModelForPurpose("chat_codegen");
    const codegenProviderModel = createProviderModelFromConfig(codegenConfig);
    const codegenExtraOpts = buildGenerateOptions(codegenConfig);

    // Track token usage across all LLM calls in the iteration loop
    let totalPromptTokens = conversation.usage.inputTokens;
    let totalCompletionTokens = conversation.usage.outputTokens;
    let totalCostUsd = conversation.usage.estimatedCostUsd;

    let currentCode = "";
    let renderError: string | null = null;
    let renderErrorCtx: RenderErrorContext | null = null;
    const errorHistory: ClassifiedRenderError[] = [];
    interface EvalState { score: number; issues: string[]; suggestions: string[]; vlmModel: string; }
    let evalState: EvalState | null = null;

    // Track best result across iterations (never regress)
    let bestResult: {
      code: string;
      score: number | null;
      evalState: EvalState | null;
      generatedFiles: Array<{ path: string; filename: string }>;
      iteration: number;
    } | null = null;

    for (let iteration = 1; iteration <= MAX_FIX_ITERATIONS; iteration++) {
      const isFirstIteration = iteration === 1;

      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId: assistantItem.id,
        state: isFirstIteration ? "codegen" : "fixing",
        detail: isFirstIteration
          ? "Generating code..."
          : `Improving model (attempt ${iteration}/${MAX_FIX_ITERATIONS}, score: ${evalState?.score ?? "?"}/10)...`,
      });

      // Build prompt using workbench functions
      const codegenPrompt = isFirstIteration
        ? buildInitialPrompt(systemPromptContent, fewShotExamples, prompt)
        : buildFixPrompt(
            systemPromptContent,
            fewShotExamples,
            prompt,
            currentCode,
            iteration - 1,
            renderError,
            evalState?.issues ?? null,
            evalState?.suggestions ?? null,
            renderErrorCtx,
          );

      // Generate code via codegen LLM (wrapped with per-provider semaphore + retry)
      const codegenSemaphore = getLlmSemaphore(codegenConfig.provider, codegenConfig.maxConcurrent);
      const codegenResult = await codegenSemaphore.run(
        () => withLlmRetry(
          () => generateText({ model: codegenProviderModel, prompt: codegenPrompt, ...codegenExtraOpts }),
          { provider: codegenConfig.provider },
        ),
        {
          onQueuePositionChange: (position, total) => {
            void publishQueryState({
              userId: input.userId, contextId: input.contextId, assistantItemId: assistantItem.id,
              state: "queued",
              detail: `Waiting for LLM slot (${position}/${total} in queue)`,
            });
          },
        },
      );

      const rawCode = extractExecutableCode(codegenResult.text);
      currentCode = stripTemplateBoilerplate(rawCode);

      const codePromptTokens = codegenResult.usage?.inputTokens ?? 0;
      const codeCompletionTokens = codegenResult.usage?.outputTokens ?? 0;
      totalPromptTokens += codePromptTokens;
      totalCompletionTokens += codeCompletionTokens;
      totalCostUsd += calculateCostUsd(codegenConfig, codePromptTokens, codeCompletionTokens);

      // Reset per-iteration state
      renderError = null;
      renderErrorCtx = null;
      evalState = null;

      // Render with Build123d (infrastructure retry handles service hiccups)
      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId: assistantItem.id,
        state: "rendering",
        detail: "Rendering 3D model...",
      });

      const baseFileName = `chat-${assistantItem.id.slice(0, 8)}-iter${iteration}`;
      const executableCode = wrapInTemplate(currentCode, baseFileName);
      let renderedFiles: Awaited<ReturnType<typeof renderBuild123d>>["files"] = [];

      const renderOutcome = await renderWithInfraRetry(
        () => renderBuild123d(
          { code: executableCode, baseFileName },
          {
            onQueuePositionChange: (position, total) => {
              void publishQueryState({
                userId: input.userId, contextId: input.contextId, assistantItemId: assistantItem.id,
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

      if (renderOutcome.ok) {
        renderedFiles = renderOutcome.result.files;
      } else {
        const classified = renderOutcome.error;
        errorHistory.push(classified);
        renderError = classified.rawMessage;
        const escalation = buildEscalatedGuidance(classified, errorHistory.slice(0, -1));
        renderErrorCtx = { classified, escalationGuidance: escalation };
        queryLogger.warn({ iteration, renderError, category: classified.category }, "render failed in iteration loop");

        if (iteration >= MAX_FIX_ITERATIONS) break;
        continue; // try fix on next iteration
      }

      // Take STL screenshots for VLM evaluation
      let screenshots: RenderedScreenshot[] = [];
      const stlFile = renderedFiles.find((f) => f.filename.toLowerCase().endsWith(".stl"));
      if (stlFile) {
        try {
          const screenshotResult = await renderModelScreenshots(
            { modelData: stlFile.contentBase64, format: "stl", width: 512, height: 512 },
            {
              onQueuePositionChange: (position, total) => {
                void publishQueryState({
                  userId: input.userId, contextId: input.contextId, assistantItemId: assistantItem.id,
                  state: "queued",
                  detail: `Waiting for screenshot slot (${position}/${total} in queue)`,
                });
              },
            },
          );
          screenshots = screenshotResult.images;
        } catch {
          queryLogger.warn({ iteration }, "screenshot failed, skipping VLM eval");
        }
      }

      // VLM evaluate
      if (screenshots.length > 0) {
        await publishQueryState({
          userId: input.userId,
          contextId: input.contextId,
          assistantItemId: assistantItem.id,
          state: "evaluating",
          detail: `Evaluating quality (attempt ${iteration}/${MAX_FIX_ITERATIONS})...`,
        });

        try {
          const evalResult = await evaluateModel({
            userPrompt: prompt,
            categoryName: "chat",
            complexity: 5,
            images: screenshots.map((s) => s.base64),
          });

          totalPromptTokens += evalResult.promptTokens;
          totalCompletionTokens += evalResult.completionTokens;
          totalCostUsd += calculateCostUsd(
            await getModelForPurpose("vlm_eval"),
            evalResult.promptTokens,
            evalResult.completionTokens,
          );

          evalState = {
            score: evalResult.score,
            issues: evalResult.issues,
            suggestions: evalResult.suggestions,
            vlmModel: evalResult.vlmModel,
          };

          queryLogger.info({ iteration, score: evalResult.score, issues: evalResult.issues.length }, "VLM eval result");
        } catch {
          queryLogger.warn({ iteration }, "VLM eval failed, treating as unscored");
        }
      }

      // Store generated files for this iteration
      const iterationFiles: Array<{ path: string; filename: string }> = [];
      for (const file of renderedFiles) {
        const extension = mapExtension(file.filename);
        const relativePath = `chat/${input.contextId}/${assistantItem.id}.${extension}`;
        await writeStorageFile({ relativePath, contentBase64: file.contentBase64 });
        iterationFiles.push({ path: relativePath, filename: file.filename });
      }

      // Track best result (never regress)
      const score = evalState?.score ?? null;
      if (bestResult === null || (score !== null && (bestResult.score === null || score > bestResult.score))) {
        bestResult = {
          code: currentCode,
          score,
          evalState,
          generatedFiles: iterationFiles,
          iteration,
        };
      }

      // Stop if: score meets threshold with no issues, or last iteration
      const approved = score !== null && score >= AUTO_APPROVE_THRESHOLD;
      const hasIssues = (evalState?.issues ?? []).length > 0;
      if ((approved && !hasIssues) || iteration >= MAX_FIX_ITERATIONS) {
        break;
      }
    }

    // Use best result across all iterations
    const finalFiles = bestResult?.generatedFiles ?? [];
    const finalEval = bestResult?.evalState ?? evalState;

    const artifact = summarizeArtifacts(finalFiles);
    const usage: QueryUsageSummary = {
      inputTokens: totalPromptTokens,
      outputTokens: totalCompletionTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      estimatedCostUsd: Number(totalCostUsd.toFixed(8)),
    };

    const assistantMessages = [
      {
        itemType: "message",
        text: conversationText,
        state: "completed",
        stateMessage: "",
      },
      ...(finalFiles.length > 0
        ? [
            {
              itemType: "3dmodel",
              text:
                artifact.previewStatus === "ready"
                  ? "Generated 3D preview."
                  : `Preview unavailable in-browser. ${artifact.detail}`,
              attachment: artifact.previewFilePath ?? "",
              state: "completed",
              stateMessage: "",
              artifact,
              files: finalFiles,
            },
          ]
        : []),
      {
        itemType: "meta",
        text: "Generation diagnostics",
        state: "completed",
        stateMessage: "",
        usage,
        artifact,
        llm: {
          conversationModel: conversation.model.id,
          codegenModel: codegenConfig.label,
          vlmModel: finalEval?.vlmModel ?? null,
          evalScore: finalEval?.score ?? null,
          iterations: bestResult?.iteration ?? 1,
        },
        files: finalFiles,
      },
    ];

    const finalizedAssistantItem = await updateChatItem({
      userId: input.userId,
      contextId: input.contextId,
      itemId: assistantItem.id,
      messages: assistantMessages,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      estimatedCostUsd: Number(totalCostUsd.toFixed(8)),
    });

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "completed",
    });

    return {
      contextId: input.contextId,
      userItemId: userItem.id,
      assistantItem: finalizedAssistantItem,
      generatedFiles: finalFiles,
      llm: {
        conversationModel: conversation.model.id,
        codegenModel: codegenConfig.label,
      },
      artifact,
      usage,
      renderer: "build123d",
    };
  } catch (error) {
    const isQuota = error instanceof ProviderQuotaExhaustedError;
    const errorMessage = isQuota
      ? "LLM provider credits exhausted. Please check your API billing or switch to a different provider in Admin → Providers."
      : (error instanceof Error ? error.message : String(error));

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "failed",
      detail: errorMessage,
    });

    await updateChatItem({
      userId: input.userId,
      contextId: input.contextId,
      itemId: assistantItem.id,
      messages: [
        {
          itemType: "errormessage",
          text: errorMessage,
          state: "error",
          stateMessage: "",
        },
      ],
    });

    if (error instanceof ProviderQuotaExhaustedError) {
      throw new QueryServiceError(errorMessage, 429);
    }
    if (error instanceof QueryServiceError || error instanceof ChatError || error instanceof LlmServiceError) {
      throw error;
    }
    if (error instanceof RenderingServiceError) {
      throw new QueryServiceError(error.message, error.statusCode);
    }
    if (error instanceof FileStorageError) {
      throw new QueryServiceError(error.message, error.statusCode);
    }
    throw new QueryServiceError("Failed to process query", 500);
  }
}

export async function regenerateQuery(input: {
  userId: string;
  contextId: string;
  assistantItemId: string;
}) {
  const prompt = await resolvePromptForRegeneration({
    userId: input.userId,
    contextId: input.contextId,
    assistantItemId: input.assistantItemId,
  });

  return submitQuery({
    userId: input.userId,
    contextId: input.contextId,
    prompt,
  });
}
