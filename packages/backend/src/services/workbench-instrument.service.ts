/**
 * The instrument's reach over the stored ratings (ADR 0003).
 *
 * A rating is Stale when its Instrument id is not the current one — including
 * the rows rated before ids existed. Stale rows stay readable, leave the
 * fine-tuning filter, and are re-rated in batches by whatever `vlm_eval`
 * points at. The batch is resumable by construction: a row leaves the stale
 * selection the moment its new rating is written, so re-running after an
 * interruption picks up where it stopped.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { currentInstrumentId } from "./visual-eval-instrument-id.service.js";
import {
  jobs, generateJobId, toSummary, runBatchReEvaluate,
  type BatchJob, type BatchJobSummary,
} from "./workbench-batch.service.js";

const logger = createLogger("workbench-instrument");

const APPROVED = ["auto_approved", "human_approved"];
/**
 * Verdicts the judge derived, so re-rating may re-derive them. A human's
 * decision is not the judge's to overturn: rows with any other status are
 * reported, never re-rated here (their export admission is #62's question).
 */
const JUDGE_DERIVED_STATUSES = ["auto_approved", "pending"];
const DEFAULT_BATCH_LIMIT = 250;
const MAX_BATCH_LIMIT = 5000;

/** Production rows that carry a visual rating at all. */
const RATED: Prisma.WorkbenchExampleWhereInput = {
  renderStatus: "success",
  experimentRunId: null,
  visualScore: { not: null },
};

/** Rows the judge can be re-run on: the eight standard views are stored. */
const HAS_STANDARD_VIEWS: Prisma.WorkbenchExampleWhereInput = {
  screenshotFront: { not: null }, screenshotBack: { not: null },
  screenshotLeft: { not: null }, screenshotRight: { not: null },
  screenshotTop: { not: null }, screenshotBottom: { not: null },
  screenshotOrtho45: { not: null }, screenshotOrtho45Bottom: { not: null },
};

/** Rated rows whose Instrument id is not `currentId` (pre-versioning rows included). */
export function staleRatingWhere(currentId: string): Prisma.WorkbenchExampleWhereInput {
  return { ...RATED, OR: [{ vlmInstrumentId: null }, { vlmInstrumentId: { not: currentId } }] };
}

export interface InstrumentStatus {
  /** The id production's judge stamps right now. */
  instrumentId: string;
  /** Production rows with a visual rating. */
  rated: number;
  /** ...of which rated under the current instrument. */
  current: number;
  /** ...of which Stale (rated under another id, or before ids existed). */
  stale: number;
  /** Stale rows that are approved: they sit outside the fine-tuning filter until re-rated. */
  staleApproved: number;
  /** Stale rows that cannot be re-rated: a standard view is missing. */
  unratable: number;
  /** Stale rows the batch leaves alone because a human decided their status. */
  staleHumanDecided: number;
}

export async function getInstrumentStatus(): Promise<InstrumentStatus> {
  const instrumentId = await currentInstrumentId();
  const stale = staleRatingWhere(instrumentId);
  const [rated, current, staleCount, staleApproved, reRatable, staleHumanDecided] = await Promise.all([
    prisma.workbenchExample.count({ where: RATED }),
    prisma.workbenchExample.count({ where: { ...RATED, vlmInstrumentId: instrumentId } }),
    prisma.workbenchExample.count({ where: stale }),
    prisma.workbenchExample.count({ where: { ...stale, approvalStatus: { in: APPROVED } } }),
    prisma.workbenchExample.count({ where: { ...stale, ...HAS_STANDARD_VIEWS } }),
    prisma.workbenchExample.count({ where: { ...stale, approvalStatus: { notIn: JUDGE_DERIVED_STATUSES } } }),
  ]);
  return {
    instrumentId, rated, current, stale: staleCount, staleApproved,
    unratable: staleCount - reRatable, staleHumanDecided,
  };
}

export interface ReRateStaleOptions {
  /** Rows per batch; the next call continues where this one stopped. */
  limit?: number;
  /** Restrict the batch to one category. */
  categoryId?: string;
}

/**
 * Re-rate a batch of Stale rows with the full evaluation pipeline, so the
 * new rating is stamped with the current Instrument id and the verdict is
 * re-derived. Oldest ratings first.
 */
export async function startBatchReRateStale(opts: ReRateStaleOptions = {}): Promise<BatchJobSummary> {
  const running = [...jobs.values()].find((j) => j.type === "batch-re-rate-stale" && j.status === "running");
  if (running) {
    const err = new Error(`A stale re-rating batch is already running (${running.jobId})`);
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? DEFAULT_BATCH_LIMIT)), MAX_BATCH_LIMIT);
  const instrumentId = await currentInstrumentId();

  const rows = await prisma.workbenchExample.findMany({
    where: {
      ...staleRatingWhere(instrumentId),
      ...HAS_STANDARD_VIEWS,
      approvalStatus: { in: JUDGE_DERIVED_STATUSES },
      ...(opts.categoryId ? { promptRef: { categoryId: opts.categoryId } } : {}),
    },
    select: { id: true, promptId: true, promptRef: { select: { prompt: true } } },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  if (rows.length === 0) {
    const err = new Error(`No stale ratings to re-rate under ${instrumentId}`);
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }

  const jobId = generateJobId("batch-re-rate-stale");
  const job: BatchJob = {
    jobId,
    type: "batch-re-rate-stale",
    categoryId: opts.categoryId ?? "*",
    categoryName: opts.categoryId ? "Stale ratings (one category)" : "Stale ratings (all categories)",
    status: "running",
    total: rows.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    currentPromptId: null,
    currentPromptText: null,
    exampleId: null,
    results: [],
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    pendingPromptIds: new Set(),
    userId: null,
    abortController: new AbortController(),
  };
  jobs.set(jobId, job);

  void runBatchReEvaluate(job, rows);

  logger.info({ jobId, instrumentId, total: rows.length, limit, categoryId: opts.categoryId ?? null }, "stale re-rating batch started");
  return toSummary(job);
}
