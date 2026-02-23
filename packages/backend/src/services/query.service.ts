import { query } from "../db/connection.js";
import { notificationService } from "./notification.service.js";
import { sseService } from "./sse.service.js";
import { createChatItem, updateChatItem, ChatError } from "./chat.service.js";
import { FileStorageError, readUserFile, writeUserFile } from "./file-storage.service.js";
import {
  generateBuild123dCode,
  generateConversationText,
  generateConversationTextStream,
  parseConversationResponse,
  LlmServiceError,
  type LlmUsageMetadata,
} from "./llm.service.js";
import { renderBuild123d, RenderingServiceError } from "./rendering.service.js";

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

export type QueryState = "queued" | "conversation" | "codegen" | "rendering" | "retrying" | "completed" | "failed";

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

async function assertAttachmentsAccessible(userId: string, attachments: QueryAttachmentInput[]) {
  for (const attachment of attachments) {
    await readUserFile({
      userId,
      relativePath: attachment.path,
    });
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

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId,
      state: "codegen",
    });

    const codegen = await generateBuild123dCode({
      prompt: `${prompt}${formatAttachmentContext(attachments)}`,
      conversationText,
      conversationHistory,
    });

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId,
      state: "rendering",
    });

    let activeCode = codegen.code;
    let retryCodegen: typeof codegen | null = null;
    let rendered: Awaited<ReturnType<typeof renderBuild123d>>;

    try {
      rendered = await renderBuild123d({
        code: activeCode,
        baseFileName: codegen.baseFileName,
      });
    } catch (renderError) {
      if (!(renderError instanceof RenderingServiceError)) {
        throw renderError;
      }

      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId,
        state: "retrying",
        detail: "Retrying with error feedback",
      });

      const errorRecoveryContext = [
        conversationText,
        "",
        "## Error Recovery",
        "The previously generated code failed to render. Please fix the code based on the error below.",
        "",
        "### Failing Code",
        "```python",
        activeCode,
        "```",
        "",
        "### Error Message",
        renderError.message,
        "",
        "Generate corrected code that fixes this error. Do NOT repeat the same mistake.",
      ].join("\n");

      retryCodegen = await generateBuild123dCode({
        prompt: `${prompt}${formatAttachmentContext(attachments)}`,
        conversationText: errorRecoveryContext,
      });

      activeCode = retryCodegen.code;

      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId,
        state: "rendering",
      });

      rendered = await renderBuild123d({
        code: activeCode,
        baseFileName: retryCodegen.baseFileName,
      });
    }

    const generatedFiles: Array<{ path: string; filename: string }> = [];
    for (const file of rendered.files) {
      const extension = mapExtension(file.filename);
      const relativePath = `modelcreator/${assistantItemId}.${extension}`;
      await writeUserFile({
        userId: input.userId,
        relativePath,
        contentBase64: file.contentBase64,
      });
      generatedFiles.push({
        path: relativePath,
        filename: file.filename,
      });
    }

    const artifact = summarizeArtifacts(generatedFiles);
    const usageRecords = [conversation.usage, codegen.usage];
    if (retryCodegen) {
      usageRecords.push(retryCodegen.usage);
    }
    const usage = summarizeUsage(usageRecords);

    const assistantMessages = [
      {
        itemType: "message",
        text: conversationText,
        state: "completed",
        stateMessage: "",
      },
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
        files: generatedFiles,
      },
      {
        itemType: "meta",
        text: "Generation diagnostics",
        state: "completed",
        stateMessage: "",
        usage,
        artifact,
        llm: {
          conversationModel: conversation.model.id,
          codegenModel: (retryCodegen ?? codegen).model.id,
          conversationUsage: conversation.usage,
          codegenUsage: (retryCodegen ?? codegen).usage,
        },
        files: generatedFiles,
      },
    ];

    await updateChatItem({
      userId: input.userId,
      contextId: input.contextId,
      itemId: assistantItemId,
      messages: assistantMessages,
    });

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId,
      state: "completed",
    });
  } catch (error) {
    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId,
      state: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });

    await updateChatItem({
      userId: input.userId,
      contextId: input.contextId,
      itemId: assistantItemId,
      messages: [
        {
          itemType: "errormessage",
          text: error instanceof Error ? error.message : "Query failed",
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

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "codegen",
    });

    const codegen = await generateBuild123dCode({
      prompt: `${prompt}${formatAttachmentContext(attachments)}`,
      conversationText,
      conversationHistory,
    });

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "rendering",
    });

    let activeCode = codegen.code;
    let retryCodegen: typeof codegen | null = null;
    let rendered: Awaited<ReturnType<typeof renderBuild123d>>;

    try {
      rendered = await renderBuild123d({
        code: activeCode,
        baseFileName: codegen.baseFileName,
      });
    } catch (renderError) {
      if (!(renderError instanceof RenderingServiceError)) {
        throw renderError;
      }

      // Error recovery: feed error + failing code back to codegen LLM for one corrective retry
      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId: assistantItem.id,
        state: "retrying",
        detail: "Retrying with error feedback",
      });

      const errorRecoveryContext = [
        conversationText,
        "",
        "## Error Recovery",
        "The previously generated code failed to render. Please fix the code based on the error below.",
        "",
        "### Failing Code",
        "```python",
        activeCode,
        "```",
        "",
        "### Error Message",
        renderError.message,
        "",
        "Generate corrected code that fixes this error. Do NOT repeat the same mistake.",
      ].join("\n");

      retryCodegen = await generateBuild123dCode({
        prompt: `${prompt}${formatAttachmentContext(attachments)}`,
        conversationText: errorRecoveryContext,
      });

      activeCode = retryCodegen.code;

      await publishQueryState({
        userId: input.userId,
        contextId: input.contextId,
        assistantItemId: assistantItem.id,
        state: "rendering",
      });

      // Second render attempt — if this also fails, the error propagates to the outer catch
      rendered = await renderBuild123d({
        code: activeCode,
        baseFileName: retryCodegen.baseFileName,
      });
    }

    const generatedFiles: Array<{ path: string; filename: string }> = [];
    for (const file of rendered.files) {
      const extension = mapExtension(file.filename);
      const relativePath = `modelcreator/${assistantItem.id}.${extension}`;
      await writeUserFile({
        userId: input.userId,
        relativePath,
        contentBase64: file.contentBase64,
      });
      generatedFiles.push({
        path: relativePath,
        filename: file.filename,
      });
    }

    const artifact = summarizeArtifacts(generatedFiles);
    const usageRecords = [conversation.usage, codegen.usage];
    if (retryCodegen) {
      usageRecords.push(retryCodegen.usage);
    }
    const usage = summarizeUsage(usageRecords);

    const assistantMessages = [
      {
        itemType: "message",
        text: conversationText,
        state: "completed",
        stateMessage: "",
      },
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
        files: generatedFiles,
      },
      {
        itemType: "meta",
        text: "Generation diagnostics",
        state: "completed",
        stateMessage: "",
        usage,
        artifact,
        llm: {
          conversationModel: conversation.model.id,
          codegenModel: (retryCodegen ?? codegen).model.id,
          conversationUsage: conversation.usage,
          codegenUsage: (retryCodegen ?? codegen).usage,
        },
        files: generatedFiles,
      },
    ];

    const finalizedAssistantItem = await updateChatItem({
      userId: input.userId,
      contextId: input.contextId,
      itemId: assistantItem.id,
      messages: assistantMessages,
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
      generatedFiles,
      llm: {
        conversationModel: conversation.model.id,
        codegenModel: (retryCodegen ?? codegen).model.id,
      },
      artifact,
      usage,
      renderer: rendered.renderer,
    };
  } catch (error) {
    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });

    await updateChatItem({
      userId: input.userId,
      contextId: input.contextId,
      itemId: assistantItem.id,
      messages: [
        {
          itemType: "errormessage",
          text: error instanceof Error ? error.message : "Query failed",
          state: "error",
          stateMessage: "",
        },
      ],
    });

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
