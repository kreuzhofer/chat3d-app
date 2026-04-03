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
import {
  acquireExperimentLock,
  releaseExperimentLock,
  isExperimentRunning,
  cancelRunningExperiment,
} from "./experiment-lock.service.js";

const logger = createLogger("experiment-exec");

// ── Startup recovery ────────────────────────────────────────────────

/**
 * Resume experiments stuck in "running" status after a server restart.
 * Picks up where they left off — skips completed runs and already-generated prompts.
 */
export async function recoverStuckExperiments(): Promise<void> {
  const stuck = await prisma.experiment.findMany({
    where: { status: "running", type: "codegen" },
    include: {
      runs: { orderBy: { runOrder: "asc" } },
      promptSelections: { orderBy: { selectionOrder: "asc" } },
    },
  });
  if (stuck.length === 0) return;

  logger.info({ count: stuck.length, ids: stuck.map((e) => e.id) }, "resuming stuck experiments after restart");

  // Resume experiments one at a time (normally only one can be running)
  for (const exp of stuck) {
    const abortController = acquireExperimentLock(exp.id);

    try {
      await executeExperiment(exp, abortController);
    } catch (err) {
      logger.error({ err, experimentId: exp.id }, "resumed experiment failed unexpectedly");
    }
  }
}

// ── Start experiment ────────────────────────────────────────────────

export async function startExperiment(experimentId: string, userId: string): Promise<void> {
  if (isExperimentRunning()) {
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
  if (exp.status === "running") throw new ExperimentError("Experiment is already running", 409);
  const hasPendingRuns = exp.runs.some((r) => r.status === "pending");
  if (!hasPendingRuns) throw new ExperimentError("No pending runs to execute", 409);

  await prisma.experiment.update({
    where: { id: experimentId },
    data: { status: "running", startedAt: new Date() },
  });

  const abortController = acquireExperimentLock(experimentId);

  // Fire-and-forget: run all runs sequentially in background
  executeExperiment(exp, abortController).catch((err) => {
    logger.error({ err, experimentId }, "experiment execution failed unexpectedly");
  });
}

// ── Cancel experiment ───────────────────────────────────────────────

export async function cancelExperiment(experimentId: string): Promise<void> {
  if (!cancelRunningExperiment(experimentId)) {
    throw new ExperimentError("Experiment is not running", 409);
  }
}

// ── Internal execution ──────────────────────────────────────────────

interface ExperimentWithRelations {
  id: string;
  runs: Array<{ id: string; modelId: string; modelLabel: string; runOrder: number; fewShotCount: number | null; status: string }>;
  promptSelections: Array<{ promptId: string; selectionOrder: number }>;
}

async function executeExperiment(exp: ExperimentWithRelations, abortController: AbortController): Promise<void> {
  const promptIds = exp.promptSelections.map((s) => s.promptId);
  let allSucceeded = true;

  try {
    for (const run of exp.runs) {
      // Skip runs that already reached a terminal state
      if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
        if (run.status !== "completed") allSucceeded = false;
        continue;
      }

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
    releaseExperimentLock(exp.id);
  }
}

interface RunInfo {
  id: string;
  modelId: string;
  modelLabel: string;
  runOrder: number;
  fewShotCount: number | null;
  status: string;
}

async function executeRun(run: RunInfo, promptIds: string[], signal: AbortSignal): Promise<void> {
  // Find prompts already completed for this run (non-pending examples)
  const completedExamples = await prisma.workbenchExample.findMany({
    where: { experimentRunId: run.id, renderStatus: { not: "pending" } },
    select: { promptId: true },
  });
  const completedPromptIds = new Set(completedExamples.map((e) => e.promptId));
  const remainingPromptIds = promptIds.filter((id) => !completedPromptIds.has(id));

  // Clean up orphaned pending examples from interrupted pipelines
  if (completedPromptIds.size > 0) {
    await prisma.workbenchExample.deleteMany({
      where: { experimentRunId: run.id, renderStatus: "pending" },
    });
  }

  logger.info({
    runId: run.id, model: run.modelLabel,
    promptCount: promptIds.length, remainingCount: remainingPromptIds.length,
    skippedCount: completedPromptIds.size,
  }, run.status === "running" ? "resuming experiment run" : "starting experiment run");

  if (remainingPromptIds.length === 0) {
    await prisma.experimentRun.update({
      where: { id: run.id },
      data: { status: "completed", completedAt: new Date() },
    });
    logger.info({ runId: run.id, model: run.modelLabel }, "experiment run already complete — nothing to resume");
    return;
  }

  // Only set startedAt on fresh runs, not when resuming
  const updateData: { status: string; startedAt?: Date } = { status: "running" };
  if (run.status !== "running") {
    updateData.startedAt = new Date();
  }
  await prisma.experimentRun.update({ where: { id: run.id }, data: updateData });

  // Resolve model config for override
  const modelConfig = await resolveModelConfigById(run.modelId);
  // Also create the provider model instance for the config
  const _model = createProviderModel(modelConfig);

  let successCount = completedExamples.length;
  let failCount = 0;

  for (const promptId of remainingPromptIds) {
    if (signal.aborted) break;

    try {
      const result: GenerateResult = await generateForPrompt(promptId, {
        externalSignal: signal,
        codegenModelOverride: modelConfig,
        experimentRunId: run.id,
        ragMaxExamplesOverride: run.fewShotCount ?? undefined,
        excludePromptIds: promptIds,
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
