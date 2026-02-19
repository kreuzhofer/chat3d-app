import { query } from "../db/connection.js";
import { notificationService } from "./notification.service.js";

type ChatItemRole = "user" | "assistant";

interface ChatContextRow {
  id: string;
  name: string;
  conversation_model_id: string | null;
  chat_3d_model_id: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface ChatItemRow {
  id: string;
  chat_context_id: string;
  role: ChatItemRole;
  messages: unknown;
  rating: number;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export class ChatError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function mapContext(row: ChatContextRow) {
  return {
    id: row.id,
    name: row.name,
    conversationModelId: row.conversation_model_id,
    chat3dModelId: row.chat_3d_model_id,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: ChatItemRow) {
  return {
    id: row.id,
    chatContextId: row.chat_context_id,
    role: row.role,
    messages: row.messages,
    rating: row.rating,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listChatContexts(userId: string) {
  const result = await query<ChatContextRow>(
    `
    SELECT id, name, conversation_model_id, chat_3d_model_id, owner_id, created_at::text, updated_at::text
    FROM chat_contexts
    WHERE owner_id = $1
    ORDER BY updated_at DESC;
    `,
    [userId],
  );

  return result.rows.map(mapContext);
}

export async function createChatContext(input: {
  userId: string;
  name: string;
  conversationModelId?: string;
  chat3dModelId?: string;
}) {
  const name = input.name.trim();
  if (name === "") {
    throw new ChatError("name is required", 400);
  }

  const result = await query<ChatContextRow>(
    `
    INSERT INTO chat_contexts (name, conversation_model_id, chat_3d_model_id, owner_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, conversation_model_id, chat_3d_model_id, owner_id, created_at::text, updated_at::text;
    `,
    [name, input.conversationModelId ?? null, input.chat3dModelId ?? null, input.userId],
  );

  return mapContext(result.rows[0]);
}

async function getOwnedContext(userId: string, contextId: string): Promise<ChatContextRow> {
  const result = await query<ChatContextRow>(
    `
    SELECT id, name, conversation_model_id, chat_3d_model_id, owner_id, created_at::text, updated_at::text
    FROM chat_contexts
    WHERE id = $1
      AND owner_id = $2;
    `,
    [contextId, userId],
  );

  const context = result.rows[0];
  if (!context) {
    throw new ChatError("Chat context not found", 404);
  }

  return context;
}

export async function updateChatContext(input: {
  userId: string;
  contextId: string;
  name?: string;
  conversationModelId?: string | null;
  chat3dModelId?: string | null;
}) {
  await getOwnedContext(input.userId, input.contextId);

  const updateResult = await query<ChatContextRow>(
    `
    UPDATE chat_contexts
    SET name = COALESCE($3, name),
        conversation_model_id = COALESCE($4, conversation_model_id),
        chat_3d_model_id = COALESCE($5, chat_3d_model_id),
        updated_at = NOW()
    WHERE id = $1
      AND owner_id = $2
    RETURNING id, name, conversation_model_id, chat_3d_model_id, owner_id, created_at::text, updated_at::text;
    `,
    [
      input.contextId,
      input.userId,
      input.name?.trim() || null,
      input.conversationModelId ?? null,
      input.chat3dModelId ?? null,
    ],
  );

  return mapContext(updateResult.rows[0]);
}

export async function deleteChatContext(input: { userId: string; contextId: string }) {
  const result = await query<{ id: string }>(
    `
    DELETE FROM chat_contexts
    WHERE id = $1
      AND owner_id = $2
    RETURNING id;
    `,
    [input.contextId, input.userId],
  );

  if (!result.rows[0]) {
    throw new ChatError("Chat context not found", 404);
  }
}

export async function listChatItems(input: { userId: string; contextId: string }) {
  await getOwnedContext(input.userId, input.contextId);

  const result = await query<ChatItemRow>(
    `
    SELECT i.id,
           i.chat_context_id,
           i.role,
           i.messages,
           i.rating,
           i.owner_id,
           i.created_at::text,
           i.updated_at::text
    FROM chat_items i
    WHERE i.chat_context_id = $1
      AND i.owner_id = $2
    ORDER BY i.created_at ASC;
    `,
    [input.contextId, input.userId],
  );

  return result.rows.map(mapItem);
}

function validateRole(value: unknown): ChatItemRole {
  if (value === "user" || value === "assistant") {
    return value;
  }
  throw new ChatError("role must be 'user' or 'assistant'", 400);
}

function validateMessages(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new ChatError("messages must be an array", 400);
  }
  return value;
}

function validateRating(value: unknown): number {
  if (!Number.isInteger(value) || ![-1, 0, 1].includes(value as number)) {
    throw new ChatError("rating must be -1, 0, or 1", 400);
  }
  return value as number;
}

export async function createChatItem(input: {
  userId: string;
  contextId: string;
  role: unknown;
  messages: unknown;
}) {
  await getOwnedContext(input.userId, input.contextId);
  const role = validateRole(input.role);
  const messages = validateMessages(input.messages);

  const result = await query<ChatItemRow>(
    `
    INSERT INTO chat_items (chat_context_id, role, messages, owner_id, rating)
    VALUES ($1, $2, $3::jsonb, $4, 0)
    RETURNING id, chat_context_id, role, messages, rating, owner_id, created_at::text, updated_at::text;
    `,
    [input.contextId, role, JSON.stringify(messages), input.userId],
  );

  const item = mapItem(result.rows[0]);

  await notificationService.publishToUser(input.userId, "chat.item.updated", {
    action: "created",
    contextId: input.contextId,
    itemId: item.id,
    role: item.role,
  });

  return item;
}

async function getOwnedItem(userId: string, contextId: string, itemId: string): Promise<ChatItemRow> {
  const result = await query<ChatItemRow>(
    `
    SELECT id, chat_context_id, role, messages, rating, owner_id, created_at::text, updated_at::text
    FROM chat_items
    WHERE id = $1
      AND chat_context_id = $2
      AND owner_id = $3;
    `,
    [itemId, contextId, userId],
  );

  const item = result.rows[0];
  if (!item) {
    throw new ChatError("Chat item not found", 404);
  }
  return item;
}

export async function updateChatItem(input: {
  userId: string;
  contextId: string;
  itemId: string;
  messages?: unknown;
  rating?: unknown;
}) {
  await getOwnedContext(input.userId, input.contextId);
  const existing = await getOwnedItem(input.userId, input.contextId, input.itemId);

  const nextMessages = input.messages !== undefined ? validateMessages(input.messages) : existing.messages;
  const nextRating = input.rating !== undefined ? validateRating(input.rating) : existing.rating;

  const result = await query<ChatItemRow>(
    `
    UPDATE chat_items
    SET messages = $4::jsonb,
        rating = $5,
        updated_at = NOW()
    WHERE id = $1
      AND chat_context_id = $2
      AND owner_id = $3
    RETURNING id, chat_context_id, role, messages, rating, owner_id, created_at::text, updated_at::text;
    `,
    [input.itemId, input.contextId, input.userId, JSON.stringify(nextMessages), nextRating],
  );

  const item = mapItem(result.rows[0]);

  await notificationService.publishToUser(input.userId, "chat.item.updated", {
    action: "updated",
    contextId: input.contextId,
    itemId: item.id,
    role: item.role,
  });

  return item;
}

export async function deleteChatItem(input: { userId: string; contextId: string; itemId: string }) {
  await getOwnedContext(input.userId, input.contextId);

  const result = await query<{ id: string }>(
    `
    DELETE FROM chat_items
    WHERE id = $1
      AND chat_context_id = $2
      AND owner_id = $3
    RETURNING id;
    `,
    [input.itemId, input.contextId, input.userId],
  );

  if (!result.rows[0]) {
    throw new ChatError("Chat item not found", 404);
  }

  await notificationService.publishToUser(input.userId, "chat.item.updated", {
    action: "deleted",
    contextId: input.contextId,
    itemId: input.itemId,
  });
}
