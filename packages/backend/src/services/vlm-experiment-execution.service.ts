/**
 * VLM Experiment Execution Service
 *
 * Runs VLM evaluations against selected workbench examples for each model run.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { ExperimentError } from "./experiment.service.js";
import { resolveModelConfigById, type LlmModelConfig } from "./llm-config.service.js";
import { evaluateModelWithConfig, type LabeledImage, type EvaluationResult } from "./visual-eval.service.js";
import { runZoomFollowUp } from "./visual-eval-zoom.service.js";
import { isUncertain } from "./visual-eval-parser.service.js";
import { readStorageFile, storageFileExists } from "./file-storage.service.js";
import {
  acquireExperimentLock,
  releaseExperimentLock,
  isExperimentRunning,
  cancelRunningExperiment,
} from "./experiment-lock.service.js";
import { runWithUsageContext } from "./usage-tracking.service.js";
import { deriveVisualChecklist } from "../utils/verification-criteria.js";
import { runWithConcurrency } from "../utils/worker-pool.js";
import { getVlmExperimentConcurrency } from "./generation-settings.service.js";
import type { EvaluateModelInput } from "./visual-eval.service.js";
import type { JudgeInstrument } from "./visual-eval-instrument-id.service.js";

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
  runs: Array<{ id: string; modelId: string; modelLabel: string; runOrder: number; status: string; judgePromptVariantId: string | null; judgePromptTemplate: string | null }>;
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
  /** The run's instrument (issue #35); both null = production's. */
  judgePromptVariantId: string | null;
  judgePromptTemplate: string | null;
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
  // Examples in flight at once. Above 1 only pays off when the provider
  // serves several replicas behind one name; the provider semaphore still
  // caps the calls, and each example's zoom follow-up stays inside its own
  // evaluation. Read once per run so a run is one setting throughout.
  const concurrency = await getVlmExperimentConcurrency();
  logger.info({ runId: run.id, concurrency, providerMaxConcurrent: modelConfig.maxConcurrent }, "VLM run concurrency");

  await runWithConcurrency(remaining, concurrency, async (exampleId) => {
    const startMs = Date.now();
    try {
      const result = await runWithUsageContext(
        { source: "experiment", experimentId: run.id, experimentRunId: run.id, sourceLabel: `VLM Experiment: ${run.modelLabel}` },
        () => evaluateExample(exampleId, modelConfig, runInstrument(run)),
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
          instrumentId: result.instrumentId,
          thinkingEffort: result.thinkingEffort,
        },
      });

      logger.debug({ runId: run.id, exampleId, score: result.score, durationMs, instrumentId: result.instrumentId }, "VLM eval completed");
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
  }, signal);

  const status = signal.aborted ? "cancelled" : "completed";
  await prisma.experimentRun.update({
    where: { id: run.id },
    data: { status, completedAt: new Date() },
  });
  logger.info({ runId: run.id, model: run.modelLabel, status }, "VLM run finished");
}

// ── Load example and evaluate ───────────────────────────────────────

/**
 * The instrument a run judges under: its variant, named by the variant id so
 * the Instrument id reads `<variant>@<hash>`; undefined = production's.
 */
function runInstrument(run: Pick<RunInfo, "judgePromptVariantId" | "judgePromptTemplate">): JudgeInstrument | undefined {
  if (!run.judgePromptTemplate) return undefined;
  if (!run.judgePromptVariantId) {
    throw new Error("Experiment run carries an instrument template without a variant id");
  }
  return { name: run.judgePromptVariantId, template: run.judgePromptTemplate };
}

async function evaluateExample(
  exampleId: string,
  modelConfig: Awaited<ReturnType<typeof resolveModelConfigById>>,
  instrument: JudgeInstrument | undefined,
) {
  const example = await prisma.workbenchExample.findUnique({
    where: { id: exampleId },
    include: {
      promptRef: {
        select: {
          prompt: true,
          constructionSpec: true,
          verificationChecklist: true,
          verificationCriteria: true,
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

  const stlBase64 = await loadStlBase64(example.stlPath);
  const input = {
    ...buildExperimentEvalInput(example, images, stlBase64),
    ...(instrument ? { instrument } : {}),
  };
  const firstPass = await evaluateModelWithConfig(input, modelConfig);
  return applyZoomFollowUp(firstPass, input, modelConfig);
}

/** The example's STL, for the zoom follow-up's high-res render. Undefined when the file is gone. */
async function loadStlBase64(stlPath: string | null): Promise<string | undefined> {
  if (!stlPath || !(await storageFileExists(stlPath))) return undefined;
  return (await readStorageFile({ relativePath: stlPath })).toString("base64");
}

/**
 * Production's zoom follow-up on the experiment's first pass (issue #54).
 *
 * Mirrors eval-orchestrator: the follow-up runs only when the judge left
 * items uncertain and the STL is available, behind the same `global.zoom_*`
 * settings, and its tokens are added to the evaluation's. The one deliberate
 * difference is the judge — the follow-up must be answered by the run's model,
 * not the production `vlm_eval` model, or the experiment scores a hybrid.
 * A failed follow-up keeps the uncertain items, as production does.
 */
export async function applyZoomFollowUp(
  result: EvaluationResult,
  input: EvaluateModelInput,
  vlmConfig: LlmModelConfig,
): Promise<EvaluationResult> {
  const checklist = result.checklistResults;
  if (!checklist || !checklist.some((c) => isUncertain(c))) return result;

  if (!input.stlBase64) {
    logger.warn(
      { uncertainCount: checklist.filter((c) => isUncertain(c)).length },
      "no STL for this example — zoom follow-up skipped, uncertain items kept",
    );
    return result;
  }

  try {
    const zoom = await runZoomFollowUp({
      checklist,
      stlBase64: input.stlBase64,
      modelFormat: input.modelFormat ?? "stl",
      constructionSpec: input.constructionSpec,
      vlmConfig,
    });
    if (!zoom) return result;

    logger.info({ followUpCount: zoom.followUpCount, model: vlmConfig.label }, "zoom follow-ups completed");
    return {
      ...result,
      checklistResults: zoom.resolvedChecklist,
      promptTokens: result.promptTokens + zoom.promptTokens,
      completionTokens: result.completionTokens + zoom.completionTokens,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), model: vlmConfig.label },
      "zoom follow-up failed, keeping uncertain results",
    );
    return result;
  }
}

/**
 * The judge input for one experiment evaluation.
 *
 * Kept identical to what eval-orchestrator builds for a production run: the
 * checklist goes through `deriveVisualChecklist`, which owns the visibility and
 * dimension filters and tolerates the legacy bare-string criteria shape that
 * most of the stored corpus holds (issue #33). Passing anything else here means
 * the experiment scores a judge on a prompt production never sends, which is
 * the whole point of the comparison.
 *
 * `stlBase64` is the example's model for the zoom follow-up's high-res render;
 * without it the follow-up is skipped, exactly as production skips it.
 */
export function buildExperimentEvalInput(
  example: {
    promptRef: {
      prompt: string;
      constructionSpec?: string | null;
      verificationChecklist?: unknown;
      verificationCriteria?: unknown;
      /** Ignored: the judge no longer sees the eval plan (ADR 0003). */
      evalPlan?: unknown;
      category: { name: string; complexity: number };
    };
  },
  images: LabeledImage[],
  stlBase64?: string,
): EvaluateModelInput {
  const { promptRef } = example;
  return {
    userPrompt: promptRef.prompt,
    categoryName: promptRef.category.name,
    complexity: promptRef.category.complexity,
    images,
    ...(stlBase64 ? { stlBase64, modelFormat: "stl" as const } : {}),
    constructionSpec: promptRef.constructionSpec ?? undefined,
    verificationChecklist: deriveVisualChecklist(
      promptRef.verificationCriteria,
      (promptRef.verificationChecklist as string[] | null) ?? undefined,
    ),
  };
}
