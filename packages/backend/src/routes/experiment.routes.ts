/**
 * Experiment Routes — Admin-only endpoints for LLM model comparison experiments.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  createExperiment,
  updateExperiment,
  deleteExperiment,
  getExperiment,
  getExperimentStatus,
  listExperiments,
  previewPromptSelection,
  rerunExperiment,
  deleteExperimentRun,
  retryExperimentRun,
  retryFailedRuns,
  ExperimentError,
} from "../services/experiment.service.js";
import { startExperiment, cancelExperiment } from "../services/experiment-execution.service.js";
import { getExperimentComparison, getPerPromptComparison, getRunExamples } from "../services/experiment-comparison.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("experiment-routes");

export const experimentRouter = Router();
experimentRouter.use(requireAuth, requireRole("admin"));

// ── Error handler ───────────────────────────────────────────────────

function handleError(err: unknown, res: Response) {
  if (err instanceof ExperimentError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    logger.error({ err }, "experiment route error");
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── CRUD endpoints ──────────────────────────────────────────────────

experimentRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { name, categoryIds, promptCount, promptSeed, testedPurpose, modelIds, fewShotCounts } = req.body;
    const experiment = await createExperiment({
      name,
      categoryIds,
      promptCount,
      promptSeed,
      testedPurpose,
      modelIds,
      fewShotCounts,
      createdBy: req.authUser!.id,
    });
    res.status(201).json(experiment);
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { status, categoryId, limit, offset } = req.query;
    const result = await listExperiments({
      status: status as string | undefined,
      categoryId: categoryId as string | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.get("/preview-prompts", async (req: Request, res: Response) => {
  try {
    const { categoryIds, count, seed } = req.query;
    if (!categoryIds || !count) {
      res.status(400).json({ error: "categoryIds and count are required" });
      return;
    }
    const ids = (categoryIds as string).split(",").filter(Boolean);
    const prompts = await previewPromptSelection(
      ids,
      Number(count),
      seed ? Number(seed) : 42,
    );
    res.json(prompts);
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const experiment = await getExperiment(req.params.id);
    res.json(experiment);
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { name, categoryIds, promptCount, promptSeed, modelIds, fewShotCounts } = req.body;
    const experiment = await updateExperiment(req.params.id, { name, categoryIds, promptCount, promptSeed, modelIds, fewShotCounts });
    res.json(experiment);
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await deleteExperiment(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

// ── Execution endpoints ─────────────────────────────────────────────

experimentRouter.post("/:id/start", async (req: Request, res: Response) => {
  try {
    await startExperiment(req.params.id, req.authUser!.id);
    res.status(202).json({ ok: true, message: "Experiment started" });
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    await cancelExperiment(req.params.id);
    res.json({ ok: true, message: "Experiment cancelled" });
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.post("/:id/rerun", async (req: Request, res: Response) => {
  try {
    await rerunExperiment(req.params.id);
    res.json({ ok: true, message: "Experiment reset for re-run" });
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.get("/:id/status", async (req: Request, res: Response) => {
  try {
    const status = await getExperimentStatus(req.params.id);
    res.json(status);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Comparison endpoints ────────────────────────────────────────────

experimentRouter.get("/:id/comparison", async (req: Request, res: Response) => {
  try {
    const comparison = await getExperimentComparison(req.params.id);
    res.json(comparison);
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.get("/:id/prompts", async (req: Request, res: Response) => {
  try {
    const comparison = await getPerPromptComparison(req.params.id);
    res.json(comparison);
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.get("/:id/runs/:runId/examples", async (req: Request, res: Response) => {
  try {
    const examples = await getRunExamples(req.params.id, req.params.runId);
    res.json(examples);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Run management endpoints ──────────────────────────────────────

experimentRouter.delete("/:id/runs/:runId", async (req: Request, res: Response) => {
  try {
    await deleteExperimentRun(req.params.id, req.params.runId);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.post("/:id/runs/:runId/retry", async (req: Request, res: Response) => {
  try {
    await retryExperimentRun(req.params.id, req.params.runId);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

experimentRouter.post("/:id/retry-failed", async (req: Request, res: Response) => {
  try {
    await retryFailedRuns(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});
