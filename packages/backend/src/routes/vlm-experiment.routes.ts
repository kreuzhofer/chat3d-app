/**
 * VLM Experiment Routes — Admin-only endpoints for VLM comparison experiments.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  getVlmExperiment,
  listVlmExperiments,
  updateVlmExperiment,
  deleteVlmExperiment,
  rerunVlmExperiment,
  previewExampleSelection,
  getVlmExperimentStatus,
  resetVlmExperimentRun,
} from "../services/vlm-experiment.service.js";
import { createVlmExperiment } from "../services/vlm-experiment-create.service.js";
import { startVlmExperiment, cancelVlmExperiment } from "../services/vlm-experiment-execution.service.js";
import {
  getVlmComparison,
  getVlmPerExampleComparison,
  getVlmInterRaterAgreement,
} from "../services/vlm-experiment-comparison.service.js";
import { ExperimentError } from "../services/experiment.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("vlm-experiment-routes");

export const vlmExperimentRouter = Router();
vlmExperimentRouter.use(requireAuth, requireRole("admin"));

function handleError(err: unknown, res: Response) {
  if (err instanceof ExperimentError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    logger.error({ err }, "VLM experiment route error");
    res.status(500).json({ error: "Internal server error" });
  }
}

// ── CRUD ────────────────────────────────────────────────────────────

vlmExperimentRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { name, categoryIds, exampleCount, exampleSeed, modelIds, judgePromptVariants } = req.body;
    const experiment = await createVlmExperiment({
      name, categoryIds, exampleCount, exampleSeed, modelIds, judgePromptVariants,
      createdBy: req.authUser!.id,
    });
    res.status(201).json(experiment);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.get("/", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const result = await listVlmExperiments({ limit, offset });
    res.json(result);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.get("/preview-examples", async (req: Request, res: Response) => {
  try {
    const categoryIds = (req.query.categoryIds as string)?.split(",").filter(Boolean) ?? [];
    const exampleCount = Number(req.query.exampleCount) || 10;
    const exampleSeed = Number(req.query.exampleSeed) || 42;
    const result = await previewExampleSelection(categoryIds, exampleCount, exampleSeed);
    res.json(result);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const experiment = await getVlmExperiment((req.params.id as string));
    res.json(experiment);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { name, categoryIds, exampleCount, exampleSeed, modelIds } = req.body;
    const experiment = await updateVlmExperiment((req.params.id as string), {
      name, categoryIds, exampleCount, exampleSeed, modelIds,
    });
    res.json(experiment);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await deleteVlmExperiment((req.params.id as string));
    res.status(204).end();
  } catch (err) { handleError(err, res); }
});

// ── Execution ───────────────────────────────────────────────────────

vlmExperimentRouter.post("/:id/start", async (req: Request, res: Response) => {
  try {
    await startVlmExperiment((req.params.id as string));
    res.status(202).json({ message: "VLM experiment started" });
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    await cancelVlmExperiment((req.params.id as string));
    res.json({ message: "Cancellation requested" });
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.post("/:id/rerun", async (req: Request, res: Response) => {
  try {
    const experiment = await rerunVlmExperiment((req.params.id as string));
    res.json(experiment);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.delete("/:id/runs/:runId/results", async (req: Request, res: Response) => {
  try {
    const result = await resetVlmExperimentRun((req.params.id as string), (req.params.runId as string));
    res.json(result);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.get("/:id/status", async (req: Request, res: Response) => {
  try {
    const status = await getVlmExperimentStatus((req.params.id as string));
    res.json(status);
  } catch (err) { handleError(err, res); }
});

// ── Comparison / Metrics ────────────────────────────────────────────

vlmExperimentRouter.get("/:id/comparison", async (req: Request, res: Response) => {
  try {
    const result = await getVlmComparison((req.params.id as string));
    res.json(result);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.get("/:id/examples", async (req: Request, res: Response) => {
  try {
    const result = await getVlmPerExampleComparison((req.params.id as string));
    res.json(result);
  } catch (err) { handleError(err, res); }
});

vlmExperimentRouter.get("/:id/inter-rater", async (req: Request, res: Response) => {
  try {
    const result = await getVlmInterRaterAgreement((req.params.id as string));
    res.json(result);
  } catch (err) { handleError(err, res); }
});
