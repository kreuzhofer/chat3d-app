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
import { CODE_REVIEW_SKIP_VLM_THRESHOLD } from "./eval-orchestrator.service.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { currentInstrumentId } from "./visual-eval-instrument-id.service.js";
import { getExportAdmission, type ExportAdmission } from "./training-export/admission.js";
import { getModelForPurpose } from "./llm-config.service.js";
import { openServingGate } from "./serving-gate.service.js";
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
/** The same ceiling as `global.vlm_experiment_concurrency`: the pool never has more replicas than this. */
const MAX_BATCH_CONCURRENCY = 8;

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
  // Stale by instrument (ADR 0003) or by items: the prompt's criteria were
  // regenerated after the rating (#89), so the answers are to questions that
  // no longer exist.
  return { ...RATED, OR: [{ vlmInstrumentId: null }, { vlmInstrumentId: { not: currentId } }, { ratingItemsStale: true }] };
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
  /** The training export's admission over the approved rows (ADR 0004, #62). */
  export: ExportAdmission;
  /**
   * Production rows the pipeline rejected before the judge was asked (issue
   * #68): assertions failed, or code review scored at or below the skip
   * threshold — pending, no visual score, no instrument id, so outside every
   * count above. Split by the reason the row itself stores.
   */
  rejectedBeforeJudge: RejectedBeforeJudge;
}

export interface RejectedBeforeJudge {
  total: number;
  /** `assertion_pass_rate` below 1: the assertions failed and nothing further ran. */
  assertionsFailed: number;
  /** Assertions passed (or none ran) and `code_eval_score` ≤ CODE_REVIEW_SKIP_VLM_THRESHOLD: the VLM was skipped. */
  codeReviewRejected: number;
  /** Unrated pending rows with neither reason stored — a state the pipeline should not leave. */
  unexplained: number;
}

/** A production row that reached the pipeline and left it without a rating. */
const UNRATED_PENDING: Prisma.WorkbenchExampleWhereInput = {
  renderStatus: "success", experimentRunId: null, visualScore: null, vlmInstrumentId: null, approvalStatus: "pending",
};
const ASSERTIONS_PASSED_OR_NONE: Prisma.WorkbenchExampleWhereInput = { OR: [{ assertionPassRate: null }, { assertionPassRate: { gte: 1 } }] };

async function countRejectedBeforeJudge(): Promise<RejectedBeforeJudge> {
  const [assertionsFailed, codeReviewRejected, unexplained] = await Promise.all([
    prisma.workbenchExample.count({ where: { ...UNRATED_PENDING, assertionPassRate: { lt: 1 } } }),
    prisma.workbenchExample.count({ where: { ...UNRATED_PENDING, ...ASSERTIONS_PASSED_OR_NONE, codeEvalScore: { lte: CODE_REVIEW_SKIP_VLM_THRESHOLD } } }),
    prisma.workbenchExample.count({ where: { ...UNRATED_PENDING, AND: [ASSERTIONS_PASSED_OR_NONE, { OR: [{ codeEvalScore: null }, { codeEvalScore: { gt: CODE_REVIEW_SKIP_VLM_THRESHOLD } }] }] } }),
  ]);
  return { total: assertionsFailed + codeReviewRejected + unexplained, assertionsFailed, codeReviewRejected, unexplained };
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
  const exportAdmission = await getExportAdmission(instrumentId);
  const rejectedBeforeJudge = await countRejectedBeforeJudge();
  return {
    instrumentId, rated, current, stale: staleCount, staleApproved,
    unratable: staleCount - reRatable, staleHumanDecided, export: exportAdmission, rejectedBeforeJudge,
  };
}

export interface ReRateStaleOptions {
  /** Rows per batch; the next call continues where this one stopped. */
  limit?: number;
  /** Restrict the batch to one category. */
  categoryId?: string;
  /**
   * Rows in flight at once (default 1). Above 1 only when the judge is
   * served by that many replicas: one request per replica keeps sole
   * tenancy (ADR 0004), more would co-batch the judge with itself (#63).
   */
  concurrency?: number;
  /**
   * Re-rate exactly these rows instead of the Stale selection, whatever
   * their rating state — the rows a failed run left unrated (issue #87: a
   * dead gateway voided 179 ratings, and an unrated row is outside the
   * Stale frame). Still production, rendered, with the eight views and a
   * judge-derived verdict; still gated.
   */
  exampleIds?: string[];
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
  const requested = Math.min(Math.max(1, Math.floor(opts.concurrency ?? 1)), MAX_BATCH_CONCURRENCY);

  // N ≤ R before the first row, not after forty (ADR 0006). The number the
  // caller passes is a ceiling; the pool decides what is actually run, and the
  // gate the pre-flight returns is asked again before every dispatch.
  const judge = await getModelForPurpose("vlm_eval");
  const gate = await openServingGate({
    endpointUrl: judge.endpointUrl,
    publishedName: judge.modelName,
    configuredConcurrency: requested,
    label: "stale re-rating batch",
  });
  const concurrency = gate.concurrency;

  const instrumentId = await currentInstrumentId();

  const byId = opts.exampleIds && opts.exampleIds.length > 0;
  const rows = await prisma.workbenchExample.findMany({
    where: {
      ...(byId
        ? { id: { in: opts.exampleIds }, renderStatus: "success", experimentRunId: null }
        : staleRatingWhere(instrumentId)),
      ...HAS_STANDARD_VIEWS,
      approvalStatus: { in: JUDGE_DERIVED_STATUSES },
      ...(opts.categoryId ? { promptRef: { categoryId: opts.categoryId } } : {}),
    },
    select: { id: true, promptId: true, promptRef: { select: { prompt: true } } },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  if (rows.length === 0) {
    const err = new Error(byId ? "None of the given rows can be re-rated" : `No stale ratings to re-rate under ${instrumentId}`);
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }

  const jobId = generateJobId("batch-re-rate-stale");
  const job: BatchJob = {
    jobId,
    type: "batch-re-rate-stale",
    categoryId: opts.categoryId ?? "*",
    categoryName: byId ? "Given rows (by id)" : opts.categoryId ? "Stale ratings (one category)" : "Stale ratings (all categories)",
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
    concurrency,
    servingBackoffs: 0,
    servingHalt: null,
    pendingPromptIds: new Set(),
    userId: null,
    abortController: new AbortController(),
  };
  jobs.set(jobId, job);

  void runBatchReEvaluate(job, rows, concurrency, gate);

  logger.info({ jobId, instrumentId, total: rows.length, limit, requested, concurrency, categoryId: opts.categoryId ?? null, byId: byId ? opts.exampleIds!.length : 0 }, "stale re-rating batch started");
  return toSummary(job);
}
