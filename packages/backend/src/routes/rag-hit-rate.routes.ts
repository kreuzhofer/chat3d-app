/**
 * RAG Hit-Rate Routes — Admin-only endpoints for per-source and per-snippet retrieval stats.
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("rag-hit-rate-routes");

export const ragHitRateRouter = Router();
ragHitRateRouter.use(requireAuth, requireRole("admin"));

/**
 * GET /api/admin/rag-hit-rate
 * Optional query param: categoryId (filter to one category)
 * Returns per-source counts and used/total ratios.
 */
ragHitRateRouter.get("/", async (req: Request, res: Response) => {
  try {
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : null;
    const rows = await prisma.$queryRaw<Array<{
      source: string; total: bigint; used: bigint;
    }>>`
      SELECT r.source,
             COUNT(*)::bigint AS total,
             SUM(CASE WHEN r.used THEN 1 ELSE 0 END)::bigint AS used
      FROM rag_retrieval_events r
      JOIN workbench_examples e ON e.id = r.workbench_example_id
      JOIN workbench_example_prompts p ON p.id = e.prompt_id
      WHERE (${categoryId}::uuid IS NULL OR p.category_id = ${categoryId}::uuid)
      GROUP BY r.source
      ORDER BY r.source
    `;
    const result = rows.map((r) => ({
      source: r.source,
      total: Number(r.total),
      used: Number(r.used),
      hitRate: Number(r.total) > 0 ? Number(r.used) / Number(r.total) : 0,
    }));
    res.json({ bySource: result, categoryId });
  } catch (err) {
    logger.error({ err }, "rag hit rate query failed");
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /api/admin/rag-hit-rate/snippets
 * Returns the most-frequently-retrieved snippets and their per-snippet hit rate.
 * Optional query param: limit (max 200, default 50)
 */
ragHitRateRouter.get("/snippets", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const rows = await prisma.$queryRaw<Array<{
      source: string; snippet_ref: string | null; summary: string;
      total: bigint; used: bigint;
    }>>`
      SELECT r.source, r.snippet_ref,
             MIN(r.snippet_summary) AS summary,
             COUNT(*)::bigint AS total,
             SUM(CASE WHEN r.used THEN 1 ELSE 0 END)::bigint AS used
      FROM rag_retrieval_events r
      WHERE r.snippet_ref IS NOT NULL
      GROUP BY r.source, r.snippet_ref
      HAVING COUNT(*) > 1
      ORDER BY total DESC
      LIMIT ${limit}::int
    `;
    res.json(rows.map((r) => ({
      source: r.source,
      snippetRef: r.snippet_ref,
      summary: r.summary,
      total: Number(r.total),
      used: Number(r.used),
      hitRate: Number(r.total) > 0 ? Number(r.used) / Number(r.total) : 0,
    })));
  } catch (err) {
    logger.error({ err }, "rag hit rate snippets query failed");
    res.status(500).json({ error: "internal_error" });
  }
});
