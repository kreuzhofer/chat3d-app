import { prisma } from "../db/prisma.js";
import { notificationService } from "./notification.service.js";
import { deleteStorageFile } from "./file-storage.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("chat");

type ChatItemRole = "user" | "assistant";

export class ChatError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function toIso(d: Date): string {
  return d.toISOString();
}

export async function listChatContexts(userId: string) {
  const rows = await prisma.chatContext.findMany({
    where: { ownerId: userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    conversationModelId: r.conversationModelId,
    chat3dModelId: r.chat3dModelId,
    ownerId: r.ownerId,
    totalCostUsd: Number(r.totalCostUsd),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  }));
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

  const r = await prisma.chatContext.create({
    data: {
      name,
      conversationModelId: input.conversationModelId ?? null,
      chat3dModelId: input.chat3dModelId ?? null,
      ownerId: input.userId,
    },
  });

  return {
    id: r.id,
    name: r.name,
    conversationModelId: r.conversationModelId,
    chat3dModelId: r.chat3dModelId,
    ownerId: r.ownerId,
    totalCostUsd: Number(r.totalCostUsd),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

export async function getOwnedContext(userId: string, contextId: string) {
  const context = await prisma.chatContext.findFirst({
    where: { id: contextId, ownerId: userId, deletedAt: null },
  });

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

  const r = await prisma.chatContext.update({
    where: { id: input.contextId },
    data: {
      name: input.name?.trim() || undefined,
      conversationModelId: input.conversationModelId ?? undefined,
      chat3dModelId: input.chat3dModelId ?? undefined,
      updatedAt: new Date(),
    },
  });

  return {
    id: r.id,
    name: r.name,
    conversationModelId: r.conversationModelId,
    chat3dModelId: r.chat3dModelId,
    ownerId: r.ownerId,
    totalCostUsd: Number(r.totalCostUsd),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

export async function deleteChatContext(input: { userId: string; contextId: string }) {
  const context = await prisma.chatContext.findFirst({
    where: { id: input.contextId, ownerId: input.userId, deletedAt: null },
  });

  if (!context) {
    throw new ChatError("Chat context not found", 404);
  }

  await prisma.chatContext.update({
    where: { id: input.contextId },
    data: { deletedAt: new Date() },
  });
}

export async function listChatItems(input: { userId: string; contextId: string }) {
  await getOwnedContext(input.userId, input.contextId);

  const rows = await prisma.chatItem.findMany({
    where: { chatContextId: input.contextId, ownerId: input.userId },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    chatContextId: r.chatContextId,
    role: r.role,
    messages: r.messages,
    rating: r.rating,
    ownerId: r.ownerId,
    promptTokens: r.promptTokens ?? 0,
    completionTokens: r.completionTokens ?? 0,
    estimatedCostUsd: Number(r.estimatedCostUsd ?? 0),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  }));
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

  const r = await prisma.chatItem.create({
    data: {
      chatContextId: input.contextId,
      role,
      messages: messages as object[],
      ownerId: input.userId,
      rating: 0,
    },
  });

  const item = {
    id: r.id,
    chatContextId: r.chatContextId,
    role: r.role,
    messages: r.messages,
    rating: r.rating,
    ownerId: r.ownerId,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };

  await notificationService.publishToUser(input.userId, "chat.item.updated", {
    action: "created",
    contextId: input.contextId,
    itemId: item.id,
    role: item.role,
  });

  return item;
}

async function getOwnedItem(userId: string, contextId: string, itemId: string) {
  const item = await prisma.chatItem.findFirst({
    where: { id: itemId, chatContextId: contextId, ownerId: userId },
  });

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
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
}) {
  await getOwnedContext(input.userId, input.contextId);
  const existing = await getOwnedItem(input.userId, input.contextId, input.itemId);

  const nextMessages = input.messages !== undefined ? validateMessages(input.messages) : undefined;
  const nextRating = input.rating !== undefined ? validateRating(input.rating) : undefined;

  const r = await prisma.chatItem.update({
    where: { id: input.itemId },
    data: {
      messages: nextMessages !== undefined ? (nextMessages as object[]) : existing.messages,
      rating: nextRating !== undefined ? nextRating : existing.rating,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      estimatedCostUsd: input.estimatedCostUsd,
      updatedAt: new Date(),
    },
  });

  const item = {
    id: r.id,
    chatContextId: r.chatContextId,
    role: r.role,
    messages: r.messages,
    rating: r.rating,
    ownerId: r.ownerId,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };

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

  const item = await prisma.chatItem.findFirst({
    where: { id: input.itemId, chatContextId: input.contextId, ownerId: input.userId },
  });

  if (!item) {
    throw new ChatError("Chat item not found", 404);
  }

  await prisma.chatItem.delete({ where: { id: input.itemId } });

  // Recalculate context cost to remove the deleted item's contribution
  await recalculateContextCost(input.contextId);

  await notificationService.publishToUser(input.userId, "chat.item.updated", {
    action: "deleted",
    contextId: input.contextId,
    itemId: input.itemId,
  });
}

/**
 * Extract file paths from a chat item's messages JSONB array.
 * Each message can have a `files` array with `{ path: string }` entries.
 */
function extractFilePathsFromMessages(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const paths: string[] = [];
  for (const msg of messages) {
    if (typeof msg === "object" && msg !== null && "files" in msg && Array.isArray((msg as { files: unknown }).files)) {
      for (const file of (msg as { files: unknown[] }).files) {
        if (typeof file === "object" && file !== null && "path" in file && typeof (file as { path: unknown }).path === "string") {
          paths.push((file as { path: string }).path);
        }
      }
    }
  }
  return paths;
}

export async function revertToItem(input: { userId: string; contextId: string; itemId: string }) {
  await getOwnedContext(input.userId, input.contextId);

  const targetItem = await prisma.chatItem.findFirst({
    where: { id: input.itemId, chatContextId: input.contextId, ownerId: input.userId },
  });

  if (!targetItem) {
    throw new ChatError("Chat item not found", 404);
  }

  // Find all items created after the target item
  const itemsToDelete = await prisma.chatItem.findMany({
    where: {
      chatContextId: input.contextId,
      ownerId: input.userId,
      createdAt: { gt: targetItem.createdAt },
    },
    orderBy: { createdAt: "asc" },
  });

  if (itemsToDelete.length === 0) {
    return { deletedCount: 0 };
  }

  // Delete associated files (best-effort, ignore missing)
  for (const item of itemsToDelete) {
    const filePaths = extractFilePathsFromMessages(item.messages);
    for (const filePath of filePaths) {
      try {
        await deleteStorageFile({ relativePath: filePath });
      } catch {
        logger.debug({ filePath, itemId: item.id }, "file already deleted or missing during revert");
      }
    }
  }

  // Bulk delete items
  const deleted = await prisma.chatItem.deleteMany({
    where: {
      id: { in: itemsToDelete.map((i) => i.id) },
    },
  });

  // Recalculate context cost to remove deleted items' contributions
  await recalculateContextCost(input.contextId);

  await notificationService.publishToUser(input.userId, "chat.item.updated", {
    action: "bulk-deleted",
    contextId: input.contextId,
  });

  return { deletedCount: deleted.count };
}

/**
 * Atomically increment a chat context's total_cost_usd.
 * Uses Prisma's `increment` to avoid race conditions.
 * Skips when costUsd <= 0 (no cost to add).
 */
export async function incrementContextCost(contextId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  await prisma.chatContext.update({
    where: { id: contextId },
    data: { totalCostUsd: { increment: costUsd } },
  });
}

/**
 * Recalculate a context's totalCostUsd as the sum of all its items' estimatedCostUsd.
 * This corrects drift caused by interrupted/resumed pipelines or deleted items.
 */
export async function recalculateContextCost(contextId: string): Promise<void> {
  const result = await prisma.chatItem.aggregate({
    where: { chatContextId: contextId },
    _sum: { estimatedCostUsd: true },
  });
  await prisma.chatContext.update({
    where: { id: contextId },
    data: { totalCostUsd: result._sum.estimatedCostUsd ?? 0 },
  });
}
