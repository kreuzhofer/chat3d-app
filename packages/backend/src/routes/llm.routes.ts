import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listLlmModels } from "../services/llm.service.js";

export const llmRouter = Router();

llmRouter.use(requireAuth);

llmRouter.get("/models", async (_req, res, next) => {
  try {
    const models = await listLlmModels();
    res.status(200).json({ models });
  } catch (err) {
    next(err);
  }
});
