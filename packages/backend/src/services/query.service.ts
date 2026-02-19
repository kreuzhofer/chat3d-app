import { query } from "../db/connection.js";
import { notificationService } from "./notification.service.js";
import { createChatItem, updateChatItem, ChatError } from "./chat.service.js";
import { FileStorageError, readUserFile, writeUserFile } from "./file-storage.service.js";
import {
  generateBuild123dCode,
  generateConversationText,
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

type QueryState = "queued" | "conversation" | "codegen" | "rendering" | "completed" | "failed";

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

export async function submitQuery(input: {
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

    const conversation = await generateConversationText({
      prompt: `${prompt}${formatAttachmentContext(attachments)}`,
      contextName: context.name,
    });

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "codegen",
    });

    const codegen = await generateBuild123dCode({
      prompt: `${prompt}${formatAttachmentContext(attachments)}`,
      conversationText: conversation.text,
    });

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "rendering",
    });

    const rendered = await renderBuild123d({
      code: codegen.code,
      baseFileName: codegen.baseFileName,
    });

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
    const usage = summarizeUsage([conversation.usage, codegen.usage]);

    const assistantMessages = [
      {
        itemType: "message",
        text: conversation.text,
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
          codegenModel: codegen.model.id,
          conversationUsage: conversation.usage,
          codegenUsage: codegen.usage,
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
        codegenModel: codegen.model.id,
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
