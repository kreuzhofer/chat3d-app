import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { QueryServiceError, submitQuery } from "../services/query.service.js";

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
    const result = await submitQuery({
      userId: authUser.id,
      contextId,
      prompt,
    });
    res.status(202).json(result);
  } catch (error) {
    sendKnownError(res, error);
  }
});
