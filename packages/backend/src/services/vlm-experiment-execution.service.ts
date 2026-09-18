/**
 * VLM Experiment Execution Service
 *
 * Runs VLM evaluations against selected workbench examples for each model run.
 */

import { prisma } from "../db/prisma.js";
import { isResponseShape } from "./visual-eval-schema.service.js";
import { createLogger } from "../utils/logger.js";
import { ExperimentError } from "./experiment.service.js";
import { resolveModelConfigById } from "./llm-config.service.js";
import { evaluateExample } from "./vlm-experiment-evaluate.service.js";
import {
  acquireExperimentLock,
  releaseExperimentLock,
  isExperimentRunning,
  cancelRunningExperiment,
} from "./experiment-lock.service.js";
import { runWithUsageContext } from "./usage-tracking.service.js";
import { runWithConcurrency } from "../utils/worker-pool.js";
import { getVlmExperimentConcurrency } from "./generation-settings.service.js";
import { openServingGate, ServingHaltError, type ServingGate } from "./serving-gate.service.js";
import { withJudgeThinking, type JudgeInstrument } from "./visual-eval-instrument-id.service.js";

const logger = createLogger("vlm-experiment-exec");


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
  // A halted run is resumable: the gate stopped it before a dispatch, and
  // resuming is the operator's call once the pool is fixed (ADR 0006).
  if (!exp.runs.some((r) => r.status === "pending" || r.status === "halted")) {
    throw new ExperimentError("No pending runs", 409);
  }

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
  if (cancelRunningExperiment(experimentId)) return;
  // No runner holds it. A row still "running" is an orphan: the process that
  // ran it restarted (a rebuild, a crash) and nothing else will ever finish
  // it — and while it says running, no other experiment may start. Cancel is
  // the honest end for it, stamped like an aborted run.
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true, status: true, type: true } });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);
  if (exp.status !== "running") throw new ExperimentError("VLM experiment is not running", 409);
  const now = new Date();
  await prisma.experimentRun.updateMany({ where: { experimentId, status: { in: ["running", "pending"] } }, data: { status: "cancelled", completedAt: now } });
  await prisma.experiment.update({ where: { id: experimentId }, data: { status: "cancelled", completedAt: now } });
  logger.warn({ experimentId }, "experiment was running with no runner in this process (interrupted by a restart); marked cancelled");
}

// ── Internal execution ──────────────────────────────────────────────

interface VlmExpWithRelations {
  id: string;
  runs: Array<{
    id: string; modelId: string; modelLabel: string; runOrder: number; status: string;
    judgePromptVariantId: string | null; judgePromptTemplate: string | null;
    judgeResponseShape: string | null; judgeThinkingEffort: string | null;
    servingViolation: string | null; servingBackoffs: number;
  }>;
  vlmExampleSelections: Array<{ exampleId: string; selectionOrder: number }>;
}

async function executeVlmExperiment(exp: VlmExpWithRelations, abortController: AbortController): Promise<void> {
  const exampleIds = exp.vlmExampleSelections.map((s) => s.exampleId);
  let allSucceeded = true;
  let halted = false;

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
        const outcome = await executeVlmRun(run, exampleIds, abortController.signal);
        if (outcome.halted) {
          // The pool is broken, not this run: starting the next arm on it
          // would only produce a second set of numbers nobody can compare.
          halted = true;
          allSucceeded = false;
          break;
        }
      } catch (err) {
        logger.error({ err, runId: run.id }, "VLM run failed");
        await prisma.experimentRun.update({
          where: { id: run.id },
          data: { status: "failed", completedAt: new Date() },
        });
        allSucceeded = false;
      }
    }

    const finalStatus = halted ? "halted" : abortController.signal.aborted ? "cancelled" : allSucceeded ? "completed" : "failed";
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
  /** A mark from an earlier attempt (ADR 0006); a resume never clears it. */
  servingViolation: string | null;
  servingBackoffs: number;
  /** The answer shape that instrument asks for (issue #66); null = production's. */
  judgeResponseShape: string | null;
  /** The effort the run judges at (issue #99); null = a run from before the column, which ran at its row default. */
  judgeThinkingEffort: string | null;
}

async function executeVlmRun(
  run: RunInfo,
  exampleIds: string[],
  signal: AbortSignal,
): Promise<{ halted: boolean }> {
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
    return { halted: false };
  }

  const updateData: { status: string; startedAt?: Date } = { status: "running" };
  if (run.status !== "running") updateData.startedAt = new Date();
  await prisma.experimentRun.update({ where: { id: run.id }, data: updateData });

  // The judge runs at thinking off unless this run explicitly asks otherwise
  // (issue #99): the model row default never decides what an experiment measures.
  const modelConfig = withJudgeThinking(await resolveModelConfigById(run.modelId), run.judgeThinkingEffort);
  // Examples in flight at once. Above 1 only pays off when the provider
  // serves several replicas behind one name; the provider semaphore still
  // caps the calls, and each example's zoom follow-up stays inside its own
  // evaluation. Read once per run so a run is one setting throughout.
  const configured = await getVlmExperimentConcurrency();
  // N <= R before the first example (ADR 0006): the setting is a ceiling the
  // operator sets, not a claim about how many replicas are actually up.
  const gate = await openServingGate({
    endpointUrl: modelConfig.endpointUrl,
    publishedName: modelConfig.modelName,
    configuredConcurrency: configured,
    label: `VLM run ${run.modelLabel}`,
  });
  const concurrency = gate.concurrency;
  logger.info({ runId: run.id, configured, concurrency, providerMaxConcurrent: modelConfig.maxConcurrent }, "VLM run concurrency");

  const haltController = new AbortController();
  const gatedSignal = AbortSignal.any([signal, haltController.signal]);

  await runWithConcurrency(remaining, concurrency, async (exampleId) => {
    // The condition before the dispatch. Unlike the batch, a result already
    // written stays: it is an observation about the pool, and the run carries
    // the mark that keeps it out of any pair.
    try {
      await gate.admit();
    } catch (err) {
      if (!(err instanceof ServingHaltError)) throw err;
      haltController.abort();
      return;
    }

    const startMs = Date.now();
    try {
      const result = await runWithUsageContext(
        {
          source: "experiment", experimentId: run.id, experimentRunId: run.id,
          sourceLabel: `VLM Experiment: ${run.modelLabel}`,
          // N for this run's judge calls (ADR 0005): read once per run, so
          // every row of the run reports the same configured concurrency.
          driverConcurrency: concurrency,
        },
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
  }, gatedSignal);

  const halted = gate.violation !== null;
  const status = halted ? "halted" : signal.aborted ? "cancelled" : "completed";
  await prisma.experimentRun.update({
    where: { id: run.id },
    data: {
      status,
      completedAt: new Date(),
      // The mark is sticky across a resume: the calls in flight when a
      // replica went away still completed and were written, so the run holds
      // results taken across the drop however cleanly its second half runs.
      servingViolation: gate.violation ?? run.servingViolation,
      servingBackoffs: run.servingBackoffs + gate.backoffs,
    },
  });
  logger.info(
    { runId: run.id, model: run.modelLabel, status, servingViolation: gate.violation, servingBackoffs: gate.backoffs },
    halted ? "VLM run halted on the serving condition — resume once the pool is back" : "VLM run finished",
  );
  return { halted };
}

// ── The instrument a run judges under ───────────────────────────────

/**
 * The instrument a run judges under: its variant, named by the variant id so
 * the Instrument id reads `<variant>@<hash>`; undefined = production's.
 */
function runInstrument(
  run: Pick<RunInfo, "judgePromptVariantId" | "judgePromptTemplate" | "judgeResponseShape">,
): JudgeInstrument | undefined {
  if (!run.judgePromptTemplate) return undefined;
  if (!run.judgePromptVariantId) {
    throw new Error("Experiment run carries an instrument template without a variant id");
  }
  const shape = run.judgeResponseShape;
  if (shape !== null && !isResponseShape(shape)) {
    throw new Error(`Experiment run carries an unknown judge response shape "${shape}"`);
  }
  return {
    name: run.judgePromptVariantId,
    template: run.judgePromptTemplate,
    ...(shape ? { responseShape: shape } : {}),
  };
}
