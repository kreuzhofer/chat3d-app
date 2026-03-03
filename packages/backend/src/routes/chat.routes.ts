import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  ChatError,
  createChatContext,
  createChatItem,
  deleteChatContext,
  deleteChatItem,
  listChatContexts,
  listChatItems,
  revertToItem,
  updateChatContext,
  updateChatItem,
} from "../services/chat.service.js";
import { markStalePendingItems } from "../services/query.service.js";

export const chatRouter = Router();

chatRouter.use(requireAuth);

function parsePathParam(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value;
}

function sendKnownError(
  res: Parameters<typeof chatRouter.get>[1] extends (req: infer _Req, res: infer Res) => unknown ? Res : never,
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof ChatError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: fallbackMessage, detail: String(error) });
}

chatRouter.get("/contexts", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  try {
    const contexts = await listChatContexts(authUser.id);
    res.status(200).json({ contexts });
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedListContexts"));
  }
});

chatRouter.post("/contexts", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name : "";

  try {
    const context = await createChatContext({
      userId: authUser.id,
      name,
      conversationModelId:
        typeof req.body?.conversationModelId === "string" ? req.body.conversationModelId : undefined,
      chat3dModelId: typeof req.body?.chat3dModelId === "string" ? req.body.chat3dModelId : undefined,
    });
    res.status(201).json(context);
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedCreateContext"));
  }
});

chatRouter.patch("/contexts/:contextId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  if (!contextId) {
    res.status(400).json({ error: req.t("errors:chat.invalidContextId") });
    return;
  }

  try {
    const context = await updateChatContext({
      userId: authUser.id,
      contextId,
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      conversationModelId:
        typeof req.body?.conversationModelId === "string" ? req.body.conversationModelId : undefined,
      chat3dModelId: typeof req.body?.chat3dModelId === "string" ? req.body.chat3dModelId : undefined,
    });
    res.status(200).json(context);
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedUpdateContext"));
  }
});

chatRouter.delete("/contexts/:contextId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  if (!contextId) {
    res.status(400).json({ error: req.t("errors:chat.invalidContextId") });
    return;
  }

  try {
    await deleteChatContext({
      userId: authUser.id,
      contextId,
    });
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedDeleteContext"));
  }
});

chatRouter.get("/contexts/:contextId/items", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  if (!contextId) {
    res.status(400).json({ error: req.t("errors:chat.invalidContextId") });
    return;
  }

  try {
    await markStalePendingItems(contextId, authUser.id);

    const items = await listChatItems({
      userId: authUser.id,
      contextId,
    });
    res.status(200).json({ items });
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedListItems"));
  }
});

chatRouter.post("/contexts/:contextId/items", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  if (!contextId) {
    res.status(400).json({ error: req.t("errors:chat.invalidContextId") });
    return;
  }

  try {
    const item = await createChatItem({
      userId: authUser.id,
      contextId,
      role: req.body?.role,
      messages: req.body?.messages,
    });
    res.status(201).json(item);
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedCreateItem"));
  }
});

chatRouter.patch("/contexts/:contextId/items/:itemId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  const itemId = parsePathParam(req.params.itemId);
  if (!contextId || !itemId) {
    res.status(400).json({ error: req.t("errors:chat.invalidItemId") });
    return;
  }

  try {
    const item = await updateChatItem({
      userId: authUser.id,
      contextId,
      itemId,
      messages: req.body?.messages,
      rating: req.body?.rating,
    });
    res.status(200).json(item);
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedUpdateItem"));
  }
});

chatRouter.delete("/contexts/:contextId/items/:itemId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  const itemId = parsePathParam(req.params.itemId);
  if (!contextId || !itemId) {
    res.status(400).json({ error: req.t("errors:chat.invalidItemId") });
    return;
  }

  try {
    await deleteChatItem({
      userId: authUser.id,
      contextId,
      itemId,
    });
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedDeleteItem"));
  }
});

chatRouter.post("/contexts/:contextId/revert-to/:itemId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  const itemId = parsePathParam(req.params.itemId);
  if (!contextId || !itemId) {
    res.status(400).json({ error: req.t("errors:chat.invalidItemId") });
    return;
  }

  try {
    const result = await revertToItem({
      userId: authUser.id,
      contextId,
      itemId,
    });
    res.status(200).json({ ok: true, deletedCount: result.deletedCount });
  } catch (error) {
    sendKnownError(res, error, req.t("errors:chat.failedRevertToItem"));
  }
});
