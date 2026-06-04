import { Router } from "express";
import { listExamplesByRenderErrorCategory } from "../../services/render-error-analytics.service.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("admin-render-errors-routes");
export const renderErrorsRouter = Router();

renderErrorsRouter.get("/examples", async (req, res) => {
  const categoryId = String(req.query.categoryId ?? "");
  const errorCategory = String(req.query.errorCategory ?? "");
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

  if (!categoryId || !errorCategory) {
    return res.status(400).json({ error: "categoryId and errorCategory query params are required" });
  }

  try {
    const result = await listExamplesByRenderErrorCategory({ categoryId, errorCategory, limit, offset });
    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Invalid errorCategory")) {
      return res.status(400).json({ error: msg });
    }
    logger.error({ err: msg }, "render-errors listing failed");
    return res.status(500).json({ error: "Failed to list render-error examples" });
  }
});
