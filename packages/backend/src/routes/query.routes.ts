import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { QueryServiceError, initiateQuery, executeQueryPipeline, resolvePromptForRegeneration, cancelPipeline } from "../services/query.service.js";

export const queryRouter = Router();

queryRouter.use(requireAuth);

function sendKnownError(
  res: Parameters<typeof queryRouter.post>[1] extends (req: infer _Req, res: infer Res) => unknown ? Res : never,
  error: unknown,
) {
  if (error instanceof QueryServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: "Query request failed", detail: String(error) });
}

queryRouter.post("/submit", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const contextId = typeof req.body?.contextId === "string" ? req.body.contextId : "";
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
  if (!contextId || !prompt) {
    res.status(400).json({ error: "contextId and prompt are required" });
    return;
  }

  try {
    const initiated = await initiateQuery({
      userId: authUser.id,
      contextId,
      prompt,
      attachments: req.body?.attachments,
    });

    // Return immediately so the frontend can start listening for SSE events
    res.status(202).json({
      contextId: initiated.contextId,
      userItemId: initiated.userItem.id,
      assistantItem: initiated.assistantItem,
      generatedFiles: [],
      llm: { conversationModel: "", codegenModel: "" },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      renderer: "pending",
    });

    // Fire pipeline in background — progress is communicated via SSE
    void executeQueryPipeline({
      userId: authUser.id,
      contextId: initiated.contextId,
      prompt: initiated.prompt,
      attachments: initiated.attachments,
      context: initiated.context,
      userItemId: initiated.userItem.id,
      assistantItemId: initiated.assistantItem.id,
      stream: true,
      isFirstPrompt: initiated.isFirstPrompt,
    });
  } catch (error) {
    sendKnownError(res, error);
  }
});

queryRouter.post("/regenerate", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const contextId = typeof req.body?.contextId === "string" ? req.body.contextId : "";
  const assistantItemId = typeof req.body?.assistantItemId === "string" ? req.body.assistantItemId : "";
  if (!contextId || !assistantItemId) {
    res.status(400).json({ error: "contextId and assistantItemId are required" });
    return;
  }

  try {
    // Resolve the original prompt from the assistant item's preceding user message
    const prompt = await resolvePromptForRegeneration({
      userId: authUser.id,
      contextId,
      assistantItemId,
    });

    // Create new chat items (same pattern as /submit)
    const initiated = await initiateQuery({
      userId: authUser.id,
      contextId,
      prompt,
    });

    // Return immediately so the frontend can start listening for SSE events
    res.status(202).json({
      contextId: initiated.contextId,
      userItemId: initiated.userItem.id,
      assistantItem: initiated.assistantItem,
      generatedFiles: [],
      llm: { conversationModel: "", codegenModel: "" },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      renderer: "pending",
    });

    // Fire pipeline in background — progress is communicated via SSE
    void executeQueryPipeline({
      userId: authUser.id,
      contextId: initiated.contextId,
      prompt: initiated.prompt,
      attachments: initiated.attachments,
      context: initiated.context,
      userItemId: initiated.userItem.id,
      assistantItemId: initiated.assistantItem.id,
      stream: true,
      isFirstPrompt: false,
    });
  } catch (error) {
    sendKnownError(res, error);
  }
});

queryRouter.post("/stop", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const assistantItemId = typeof req.body?.assistantItemId === "string" ? req.body.assistantItemId : "";
  if (!assistantItemId) {
    res.status(400).json({ error: "assistantItemId is required" });
    return;
  }

  const wasRunning = cancelPipeline(assistantItemId, authUser.id);
  res.status(200).json({ ok: true, wasRunning });
});
