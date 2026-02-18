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
  updateChatContext,
  updateChatItem,
} from "../services/chat.service.js";

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
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const contexts = await listChatContexts(authUser.id);
    res.status(200).json({ contexts });
  } catch (error) {
    sendKnownError(res, error, "Failed to list chat contexts");
  }
});

chatRouter.post("/contexts", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
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
    sendKnownError(res, error, "Failed to create chat context");
  }
});

chatRouter.patch("/contexts/:contextId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  if (!contextId) {
    res.status(400).json({ error: "Invalid context id" });
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
    sendKnownError(res, error, "Failed to update chat context");
  }
});

chatRouter.delete("/contexts/:contextId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  if (!contextId) {
    res.status(400).json({ error: "Invalid context id" });
    return;
  }

  try {
    await deleteChatContext({
      userId: authUser.id,
      contextId,
    });
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, "Failed to delete chat context");
  }
});

chatRouter.get("/contexts/:contextId/items", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  if (!contextId) {
    res.status(400).json({ error: "Invalid context id" });
    return;
  }

  try {
    const items = await listChatItems({
      userId: authUser.id,
      contextId,
    });
    res.status(200).json({ items });
  } catch (error) {
    sendKnownError(res, error, "Failed to list chat items");
  }
});

chatRouter.post("/contexts/:contextId/items", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  if (!contextId) {
    res.status(400).json({ error: "Invalid context id" });
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
    sendKnownError(res, error, "Failed to create chat item");
  }
});

chatRouter.patch("/contexts/:contextId/items/:itemId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  const itemId = parsePathParam(req.params.itemId);
  if (!contextId || !itemId) {
    res.status(400).json({ error: "Invalid context id or item id" });
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
    sendKnownError(res, error, "Failed to update chat item");
  }
});

chatRouter.delete("/contexts/:contextId/items/:itemId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const contextId = parsePathParam(req.params.contextId);
  const itemId = parsePathParam(req.params.itemId);
  if (!contextId || !itemId) {
    res.status(400).json({ error: "Invalid context id or item id" });
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
    sendKnownError(res, error, "Failed to delete chat item");
  }
});
