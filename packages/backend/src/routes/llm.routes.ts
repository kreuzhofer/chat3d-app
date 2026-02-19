import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listLlmModels } from "../services/llm.service.js";

export const llmRouter = Router();

llmRouter.use(requireAuth);

llmRouter.get("/models", (_req, res) => {
  res.status(200).json({
    models: listLlmModels(),
  });
});
