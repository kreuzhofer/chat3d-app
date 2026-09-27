/**
 * A sitting from the corpus (issue #91): pick a size and a seed, and the app
 * draws the rows, runs the reference judge on exactly those rows, and opens
 * the sitting when the run completes.
 *
 * The frame is the corpus's current rows outside the export's held-out
 * prompts (the 125, every spot check — cut by prompt, as the export cuts) and
 * outside every earlier sitting's sample taken under the row's current
 * criteria, so no question is adjudicated twice: regenerating a prompt's
 * criteria replaces the questions, which re-opens its rows (#120). The reference judge is the `adjudication_reference` purpose — the
 * reference standard of the bar, Sonnet 4.6 thinking off by standing
 * decision — assigned in the admin UI like any other purpose.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { HELD_OUT_EXPERIMENT_ID, HELD_OUT_EXPERIMENT_IDS } from "./training-export/judge-sft-held-out.js";
import { createLogger } from "../utils/logger.js";
import { currentInstrumentId } from "./visual-eval-instrument-id.service.js";
import { getModelForPurpose } from "./llm-config.service.js";
import { createVlmExperiment } from "./vlm-experiment-create.service.js";
import { startVlmExperiment } from "./vlm-experiment-execution.service.js";
import { getVlmExperimentStatus } from "./vlm-experiment.service.js";
import { createSitting, SittingError } from "./adjudication-sitting.service.js";
import { startTriageJob } from "./adjudication-triage.service.js";
import { generateJobId, jobs, toSummary, type BatchJob, type BatchJobSummary } from "./workbench-batch.service.js";

const logger = createLogger("sitting-draw");

export { HELD_OUT_EXPERIMENT_ID };
export const REFERENCE_PURPOSE = "adjudication_reference" as const;
/** Fewer items than this and the Gate cannot decide the example (ADR 0001); such rows are not worth a judge's disagreement. */
const MIN_CHECKLIST_ITEMS = 3;

export interface DrawInput {
  size: number;
  seed: number;
}

export interface DrawResult {
  instrumentId: string;
  frame: number;
  excluded: number;
  exampleIds: string[];
}

/** mulberry32: a small seeded generator, so a draw is reproducible from its seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `size` of `ids` in a seeded order (a partial Fisher–Yates), returned sorted by id. */
export function drawIds(ids: string[], size: number, seed: number): string[] {
  const pool = ids.slice().sort();
  const rand = seededRandom(seed);
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size).sort();
}

export interface FrameFacts {
  heldOut: boolean;
  /** When the latest sitting whose sample holds the row was created; null if never sampled. */
  lastSampledAt: Date | null;
  criteriaRegeneratedAt: Date | null;
}

/** A row is in the frame unless held out, or sampled since its prompt's criteria last changed. */
export function inFrame(r: FrameFacts): boolean {
  if (r.heldOut) return false;
  if (!r.lastSampledAt) return true;
  return r.criteriaRegeneratedAt !== null && r.criteriaRegeneratedAt > r.lastSampledAt;
}

/** The frame: current rows with a gate-eligible checklist, outside the held-out set and every sample taken under their current criteria. */
export async function drawSample(input: DrawInput): Promise<DrawResult> {
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > 500) throw new SittingError("size must be a whole number between 1 and 500", 400);
  if (!Number.isInteger(input.seed) || input.seed < 0) throw new SittingError("seed must be a non-negative whole number", 400);
  const instrumentId = await currentInstrumentId();
  const rows = await prisma.$queryRaw<Array<FrameFacts & { id: string }>>`
    select e.id,
      (e.prompt_id in (select he.prompt_id from vlm_experiment_example_selections hs join workbench_examples he on he.id = hs.example_id
                        where hs.experiment_id in (${Prisma.join(HELD_OUT_EXPERIMENT_IDS.map((id) => Prisma.sql`${id}::uuid`))}))) as "heldOut",
      (select max(s.created_at) from adjudication_sittings s
         join vlm_experiment_example_selections sel on sel.experiment_id = s.sample_experiment_id
        where sel.example_id = e.id) as "lastSampledAt",
      p.criteria_regenerated_at as "criteriaRegeneratedAt"
    from workbench_examples e
    join workbench_example_prompts p on p.id = e.prompt_id
    where e.vlm_instrument_id = ${instrumentId}
      and e.experiment_run_id is null
      and e.render_status = 'success'
      and e.approval_status in ('auto_approved', 'pending')
      and jsonb_typeof(e.eval_checklist_results) = 'array'
      and jsonb_array_length(e.eval_checklist_results) >= ${MIN_CHECKLIST_ITEMS}
    order by e.id`;
  const frame = rows.filter(inFrame).map((r) => r.id);
  const excluded = rows.length - frame.length;
  if (frame.length < input.size) throw new SittingError(`The frame holds ${frame.length} rows outside the held-out set and samples taken under their current criteria; ${input.size} were asked for`, 409);
  return { instrumentId, frame: frame.length, excluded, exampleIds: drawIds(frame, input.size, input.seed) };
}

export interface StartDrawInput extends DrawInput {
  title?: string;
  /** Run the triage job on the sitting once it exists (default true). */
  triage?: boolean;
}

/**
 * Draw, run the reference on the draw, and open the sitting: a job, since
 * the reference run takes minutes. The job's `sittingId` is set when the
 * sitting exists; progress is the reference run's completed examples.
 */
export async function startSittingDraw(input: StartDrawInput, userId: string): Promise<BatchJobSummary> {
  const running = [...jobs.values()].find((j) => j.type === "batch-sitting-draw" && j.status === "running");
  if (running) throw new SittingError(`A sitting is already being drawn (job ${running.jobId})`, 409);
  const reference = await getModelForPurpose(REFERENCE_PURPOSE);
  const draw = await drawSample(input);
  const title = input.title?.trim() || `Gold sitting, seed ${input.seed} — ${input.size} corpus rows`;
  const experiment = await createVlmExperiment({
    name: `${title}: ${reference.label} on ${draw.exampleIds.length} rows under ${draw.instrumentId}`,
    exampleIds: draw.exampleIds,
    modelIds: [reference.id],
    createdBy: userId,
  });
  await startVlmExperiment(experiment.id);

  const jobId = generateJobId("batch-sitting-draw");
  const job: BatchJob = {
    jobId, type: "batch-sitting-draw", categoryId: experiment.id, categoryName: title,
    status: "running", total: draw.exampleIds.length, completed: 0, failed: 0, skipped: 0,
    currentPromptId: null, currentPromptText: `reference ${reference.label} judging the draw`, exampleId: null, results: [], error: null,
    createdAt: new Date().toISOString(), finishedAt: null, concurrency: 1,
    pendingPromptIds: new Set(), userId, abortController: new AbortController(), sittingId: null,
  };
  jobs.set(jobId, job);
  void awaitReferenceThenOpen(job, experiment.id, title, input, userId);
  logger.info({ jobId, experimentId: experiment.id, seed: input.seed, size: input.size, frame: draw.frame, excluded: draw.excluded, reference: reference.label }, "sitting draw started");
  return toSummary(job);
}

const POLL_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function awaitReferenceThenOpen(job: BatchJob, experimentId: string, title: string, input: StartDrawInput, userId: string): Promise<void> {
  try {
    for (;;) {
      if (job.abortController.signal.aborted) { job.status = "cancelled"; break; }
      const status = await getVlmExperimentStatus(experimentId);
      const run = status.runs[0];
      if (!run) throw new Error("the reference experiment has no run");
      job.completed = run.completedExamples;
      if (run.status === "completed") {
        // A reference that answered nothing (an exhausted API key stores every row as a failed evaluation) is not a pair.
        const failed = await prisma.vlmExperimentResult.findMany({ where: { runId: run.runId, instrumentId: null }, select: { issues: true } });
        if (run.completedExamples > 0 && failed.length >= run.completedExamples) {
          const reason = String((failed[0]?.issues as unknown[] | null)?.[0] ?? "evaluation failed");
          throw new Error(`the reference answered none of the ${run.completedExamples} drawn rows: ${reason}`);
        }
        if (failed.length > 0) logger.warn({ jobId: job.jobId, failed: failed.length, of: run.completedExamples }, "the reference failed on some drawn rows; they stay outside the sitting");
        const sitting = await createSitting({
          candidate: { productionExperimentId: experimentId }, referenceRunId: run.runId, title,
          notes: `Drawn in the app: seed ${input.seed}, ${input.size} of the corpus's current rows outside the held-out set and earlier samples; reference run ${run.runId}.`,
        }, userId);
        job.sittingId = sitting.id;
        job.currentPromptText = null;
        job.status = "completed";
        logger.info({ jobId: job.jobId, sittingId: sitting.id, items: sitting.itemCount, examples: sitting.exampleCount }, "sitting opened from the draw");
        if (input.triage !== false) {
          try { const t = await startTriageJob(sitting.id); job.currentPromptId = t.jobId; }
          catch (error) { logger.warn({ err: error, sittingId: sitting.id }, "triage did not start; the sitting is open without it"); }
        }
        break;
      }
      if (run.status !== "running" && run.status !== "pending") {
        throw new Error(`the reference run ended ${run.status}`);
      }
      await sleep(POLL_MS);
    }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, jobId: job.jobId, experimentId }, "sitting draw failed");
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}
