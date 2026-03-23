/**
 * Experiment Execution Service
 *
 * Orchestrates running experiment runs sequentially, each with a model override.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { ExperimentError } from "./experiment.service.js";
import { resolveModelConfigById, createProviderModel } from "./llm-config.service.js";
import { generateForPrompt, type GenerateResult } from "./workbench-codegen.service.js";

const logger = createLogger("experiment-exec");

// ── In-memory state for running experiments ─────────────────────────

interface RunningExperiment {
  experimentId: string;
  abortController: AbortController;
}

let runningExperiment: RunningExperiment | null = null;

// ── Start experiment ────────────────────────────────────────────────

export async function startExperiment(experimentId: string, userId: string): Promise<void> {
  // Check no other experiment is running
  if (runningExperiment) {
    throw new ExperimentError("Another experiment is already running", 409);
  }

  const exp = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      runs: { orderBy: { runOrder: "asc" } },
      promptSelections: { orderBy: { selectionOrder: "asc" } },
    },
  });
  if (!exp) throw new ExperimentError("Experiment not found", 404);
  if (exp.status !== "created") throw new ExperimentError(`Experiment is in '${exp.status}' status, expected 'created'`, 409);

  // Set experiment to running
  await prisma.experiment.update({
    where: { id: experimentId },
    data: { status: "running", startedAt: new Date() },
  });

  const abortController = new AbortController();
  runningExperiment = { experimentId, abortController };

  // Fire-and-forget: run all runs sequentially in background
  executeExperiment(exp, abortController).catch((err) => {
    logger.error({ err, experimentId }, "experiment execution failed unexpectedly");
  });
}

// ── Cancel experiment ───────────────────────────────────────────────

export async function cancelExperiment(experimentId: string): Promise<void> {
  if (!runningExperiment || runningExperiment.experimentId !== experimentId) {
    throw new ExperimentError("Experiment is not running", 409);
  }
  runningExperiment.abortController.abort();
  logger.info({ experimentId }, "experiment cancellation requested");
}

// ── Internal execution ──────────────────────────────────────────────

interface ExperimentWithRelations {
  id: string;
  runs: Array<{ id: string; modelId: string; modelLabel: string; runOrder: number }>;
  promptSelections: Array<{ promptId: string; selectionOrder: number }>;
}

async function executeExperiment(exp: ExperimentWithRelations, abortController: AbortController): Promise<void> {
  const promptIds = exp.promptSelections.map((s) => s.promptId);
  let allSucceeded = true;

  try {
    for (const run of exp.runs) {
      if (abortController.signal.aborted) {
        await prisma.experimentRun.update({
          where: { id: run.id },
          data: { status: "cancelled", completedAt: new Date() },
        });
        allSucceeded = false;
        continue;
      }

      try {
        await executeRun(run, promptIds, abortController.signal);
      } catch (err) {
        logger.error({ err, runId: run.id }, "run failed");
        await prisma.experimentRun.update({
          where: { id: run.id },
          data: { status: "failed", completedAt: new Date() },
        });
        allSucceeded = false;
      }
    }

    const finalStatus = abortController.signal.aborted ? "cancelled" : allSucceeded ? "completed" : "failed";
    await prisma.experiment.update({
      where: { id: exp.id },
      data: { status: finalStatus, completedAt: new Date() },
    });
    logger.info({ experimentId: exp.id, finalStatus }, "experiment finished");
  } catch (err) {
    logger.error({ err, experimentId: exp.id }, "experiment top-level error");
    await prisma.experiment.update({
      where: { id: exp.id },
      data: { status: "failed", completedAt: new Date() },
    }).catch(() => {});
  } finally {
    runningExperiment = null;
  }
}

interface RunInfo {
  id: string;
  modelId: string;
  modelLabel: string;
  runOrder: number;
}

async function executeRun(run: RunInfo, promptIds: string[], signal: AbortSignal): Promise<void> {
  logger.info({ runId: run.id, model: run.modelLabel, promptCount: promptIds.length }, "starting experiment run");

  await prisma.experimentRun.update({
    where: { id: run.id },
    data: { status: "running", startedAt: new Date() },
  });

  // Resolve model config for override
  const modelConfig = await resolveModelConfigById(run.modelId);
  // Also create the provider model instance for the config
  const _model = createProviderModel(modelConfig);

  let successCount = 0;
  let failCount = 0;

  for (const promptId of promptIds) {
    if (signal.aborted) break;

    try {
      const result: GenerateResult = await generateForPrompt(promptId, {
        externalSignal: signal,
        codegenModelOverride: modelConfig,
        experimentRunId: run.id,
      });

      if (result.renderStatus === "success") {
        successCount++;
      } else {
        failCount++;
      }

      logger.debug({
        runId: run.id,
        promptId,
        evalScore: result.evalScore,
        renderStatus: result.renderStatus,
      }, "experiment prompt completed");
    } catch (err) {
      failCount++;
      logger.warn({ err: err instanceof Error ? err.message : String(err), runId: run.id, promptId }, "experiment prompt failed");
    }
  }

  const status = signal.aborted ? "cancelled" : "completed";
  await prisma.experimentRun.update({
    where: { id: run.id },
    data: { status, completedAt: new Date() },
  });

  logger.info({ runId: run.id, model: run.modelLabel, successCount, failCount, status }, "experiment run finished");
}
