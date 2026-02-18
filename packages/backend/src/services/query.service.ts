import { query } from "../db/connection.js";
import { notificationService } from "./notification.service.js";
import { createChatItem, updateChatItem, ChatError } from "./chat.service.js";
import { writeUserFile } from "./file-storage.service.js";
import { generateBuild123dCode, generateConversationText, LlmServiceError } from "./llm.service.js";
import { renderBuild123d, RenderingServiceError } from "./rendering.service.js";

interface ChatContextRow {
  id: string;
  name: string;
}

type QueryState = "queued" | "conversation" | "codegen" | "rendering" | "completed" | "failed";

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

export async function submitQuery(input: {
  userId: string;
  contextId: string;
  prompt: string;
}) {
  const prompt = input.prompt.trim();
  if (prompt === "") {
    throw new QueryServiceError("prompt is required", 400);
  }

  const context = await ensureOwnedContext(input.userId, input.contextId);

  const userItem = await createChatItem({
    userId: input.userId,
    contextId: input.contextId,
    role: "user",
    messages: [{ itemType: "message", text: prompt, state: "completed", stateMessage: "" }],
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
      prompt,
      contextName: context.name,
    });

    await publishQueryState({
      userId: input.userId,
      contextId: input.contextId,
      assistantItemId: assistantItem.id,
      state: "codegen",
    });

    const codegen = await generateBuild123dCode({
      prompt,
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

    const assistantMessages = [
      {
        itemType: "message",
        text: conversation.text,
        state: "completed",
        stateMessage: "",
      },
      {
        itemType: "meta",
        text: "Generated files",
        state: "completed",
        stateMessage: "",
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
    throw new QueryServiceError("Failed to process query", 500);
  }
}
