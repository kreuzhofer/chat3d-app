/**
 * VLM Experiment Execution Service
 *
 * Runs VLM evaluations against selected workbench examples for each model run.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { ExperimentError } from "./experiment.service.js";
import { resolveModelConfigById } from "./llm-config.service.js";
import { evaluateModelWithConfig, type LabeledImage } from "./visual-eval.service.js";
import { readStorageFile, storageFileExists } from "./file-storage.service.js";
import {
  acquireExperimentLock,
  releaseExperimentLock,
  isExperimentRunning,
  cancelRunningExperiment,
} from "./experiment-lock.service.js";
import { runWithUsageContext } from "./usage-tracking.service.js";

const logger = createLogger("vlm-experiment-exec");

// ── Screenshot angle mapping ────────────────────────────────────────

const SCREENSHOT_FIELDS: Array<{ angle: string; field: string }> = [
  { angle: "front", field: "screenshotFront" },
  { angle: "back", field: "screenshotBack" },
  { angle: "left", field: "screenshotLeft" },
  { angle: "right", field: "screenshotRight" },
  { angle: "top", field: "screenshotTop" },
  { angle: "bottom", field: "screenshotBottom" },
  { angle: "ortho_45", field: "screenshotOrtho45" },
  { angle: "ortho_45_bottom", field: "screenshotOrtho45Bottom" },
];

// ── Startup recovery ────────────────────────────────────────────────

export async function recoverStuckVlmExperiments(): Promise<void> {
  const stuck = await prisma.experiment.findMany({
    where: { status: "running", type: "vlm_comparison" },
    include: {
      runs: { orderBy: { runOrder: "asc" } },
      vlmExampleSelections: { orderBy: { selectionOrder: "asc" } },
    },
  });
  if (stuck.length === 0) return;

  logger.info({ count: stuck.length }, "resuming stuck VLM experiments");
  for (const exp of stuck) {
    const abortController = acquireExperimentLock(exp.id);
    try {
      await executeVlmExperiment(exp, abortController);
    } catch (err) {
      logger.error({ err, experimentId: exp.id }, "resumed VLM experiment failed");
    }
  }
}

// ── Start ───────────────────────────────────────────────────────────

export async function startVlmExperiment(experimentId: string): Promise<void> {
  if (isExperimentRunning()) {
    throw new ExperimentError("Another experiment is already running", 409);
  }

  const exp = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      runs: { orderBy: { runOrder: "asc" } },
      vlmExampleSelections: { orderBy: { selectionOrder: "asc" } },
    },
  });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);
  if (exp.status === "running") throw new ExperimentError("Already running", 409);
  if (!exp.runs.some((r) => r.status === "pending")) throw new ExperimentError("No pending runs", 409);

  await prisma.experiment.update({
    where: { id: experimentId },
    data: { status: "running", startedAt: new Date() },
  });

  const abortController = acquireExperimentLock(experimentId);

  executeVlmExperiment(exp, abortController).catch((err) => {
    logger.error({ err, experimentId }, "VLM experiment failed unexpectedly");
  });
}

// ── Cancel ──────────────────────────────────────────────────────────

export async function cancelVlmExperiment(experimentId: string): Promise<void> {
  if (!cancelRunningExperiment(experimentId)) {
    throw new ExperimentError("VLM experiment is not running", 409);
  }
}

// ── Internal execution ──────────────────────────────────────────────

interface VlmExpWithRelations {
  id: string;
  runs: Array<{ id: string; modelId: string; modelLabel: string; runOrder: number; status: string }>;
  vlmExampleSelections: Array<{ exampleId: string; selectionOrder: number }>;
}

async function executeVlmExperiment(exp: VlmExpWithRelations, abortController: AbortController): Promise<void> {
  const exampleIds = exp.vlmExampleSelections.map((s) => s.exampleId);
  let allSucceeded = true;

  try {
    for (const run of exp.runs) {
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
        await executeVlmRun(run, exampleIds, abortController.signal);
      } catch (err) {
        logger.error({ err, runId: run.id }, "VLM run failed");
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
    logger.info({ experimentId: exp.id, finalStatus }, "VLM experiment finished");
  } catch (err) {
    logger.error({ err, experimentId: exp.id }, "VLM experiment top-level error");
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
  status: string;
}

async function executeVlmRun(run: RunInfo, exampleIds: string[], signal: AbortSignal): Promise<void> {
  // Find already-evaluated examples for resume support
  const completed = await prisma.vlmExperimentResult.findMany({
    where: { runId: run.id },
    select: { exampleId: true },
  });
  const completedSet = new Set(completed.map((r) => r.exampleId));
  const remaining = exampleIds.filter((id) => !completedSet.has(id));

  logger.info({
    runId: run.id, model: run.modelLabel,
    total: exampleIds.length, remaining: remaining.length, skipped: completedSet.size,
  }, remaining.length < exampleIds.length ? "resuming VLM run" : "starting VLM run");

  if (remaining.length === 0) {
    await prisma.experimentRun.update({
      where: { id: run.id },
      data: { status: "completed", completedAt: new Date() },
    });
    return;
  }

  const updateData: { status: string; startedAt?: Date } = { status: "running" };
  if (run.status !== "running") updateData.startedAt = new Date();
  await prisma.experimentRun.update({ where: { id: run.id }, data: updateData });

  const modelConfig = await resolveModelConfigById(run.modelId);

  for (const exampleId of remaining) {
    if (signal.aborted) break;

    const startMs = Date.now();
    try {
      const result = await runWithUsageContext(
        { source: "experiment", experimentId: run.id, experimentRunId: run.id, sourceLabel: `VLM Experiment: ${run.modelLabel}` },
        () => evaluateExample(exampleId, modelConfig),
      );
      const durationMs = Date.now() - startMs;

      await prisma.vlmExperimentResult.create({
        data: {
          runId: run.id,
          exampleId,
          visualScore: result.score,
          issues: result.issues,
          suggestions: result.suggestions,
          checklistResults: result.checklistResults ?? null,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          durationMs,
          rawResponse: result.rawResponse ?? null,
          reasoning: result.reasoning ?? null,
          systemPrompt: result.systemPrompt ?? null,
        },
      });

      logger.debug({ runId: run.id, exampleId, score: result.score, durationMs }, "VLM eval completed");
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await prisma.vlmExperimentResult.create({
        data: {
          runId: run.id,
          exampleId,
          error: errorMsg,
          durationMs,
        },
      });
      logger.warn({ err: errorMsg, runId: run.id, exampleId }, "VLM eval failed for example");
    }
  }

  const status = signal.aborted ? "cancelled" : "completed";
  await prisma.experimentRun.update({
    where: { id: run.id },
    data: { status, completedAt: new Date() },
  });
  logger.info({ runId: run.id, model: run.modelLabel, status }, "VLM run finished");
}

// ── Load example and evaluate ───────────────────────────────────────

async function evaluateExample(
  exampleId: string,
  modelConfig: Awaited<ReturnType<typeof resolveModelConfigById>>,
) {
  const example = await prisma.workbenchExample.findUnique({
    where: { id: exampleId },
    include: {
      promptRef: {
        select: {
          prompt: true,
          constructionSpec: true,
          category: { select: { name: true, complexity: true } },
        },
      },
    },
  });
  if (!example) throw new Error(`Example ${exampleId} not found`);

  // Load screenshots as base64
  const images: LabeledImage[] = [];
  const exRecord = example as Record<string, unknown>;
  for (const { angle, field } of SCREENSHOT_FIELDS) {
    const path = exRecord[field] as string | null;
    if (!path) continue;
    // Handle both file paths and inline base64
    if (path.startsWith("data:") || path.length > 500) {
      // Inline base64 — strip data URI prefix if present
      const b64 = path.replace(/^data:image\/\w+;base64,/, "");
      images.push({ angle, base64: b64 });
    } else if (await storageFileExists(path)) {
      const buf = await readStorageFile({ relativePath: path });
      images.push({ angle, base64: buf.toString("base64") });
    }
  }

  if (images.length === 0) throw new Error(`No screenshots available for example ${exampleId}`);

  return evaluateModelWithConfig({
    userPrompt: example.promptRef.prompt,
    categoryName: example.promptRef.category.name,
    complexity: example.promptRef.category.complexity,
    images,
    constructionSpec: example.promptRef.constructionSpec ?? undefined,
  }, modelConfig);
}
