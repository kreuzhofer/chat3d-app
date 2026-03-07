/**
 * Workbench Job Queue Service
 *
 * Unified in-memory job queue for all workbench generation operations:
 * - Batch generation across an entire category
 * - Single-prompt generate, retry, and re-render
 *
 * All operations share the same job store and status API so the frontend
 * can use a single polling pattern regardless of how generation was started.
 */

import { prisma } from "../db/prisma.js";
import { ProviderQuotaExhaustedError } from "../utils/llm-errors.js";
import { generateForPrompt, reRenderForExample, type GenerateResult, type ProgressCallback } from "./workbench-codegen.service.js";
import { embedAndStorePrompt } from "./workbench-embeddings.service.js";
import { cleanupExamplesForPrompt } from "./workbench-examples.service.js";
import { createLogger } from "../utils/logger.js";
import { sseService } from "./sse.service.js";

const logger = createLogger("workbench-batch");

// ── Types ────────────────────────────────────────────────────────────

export type JobType = "batch" | "batch-re-render" | "batch-cleanup" | "generate" | "retry" | "re-render";

export interface BatchJob {
  jobId: string;
  type: JobType;
  categoryId: string;
  categoryName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentPromptId: string | null;
  currentPromptText: string | null;
  /** For re-render jobs: the example being re-rendered. */
  exampleId: string | null;
  results: BatchPromptResult[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Prompt IDs still pending processing (batch jobs only). */
  pendingPromptIds: Set<string>;
  /** Admin user ID for SSE progress events. */
  userId: string | null;
}

export interface BatchPromptResult {
  promptId: string;
  promptText: string;
  status: "success" | "error" | "skipped" | "rejected" | "disambiguation";
  exampleId: string | null;
  evalScore: number | null;
  approvalStatus: string | null;
  error: string | null;
}

export interface BatchJobSummary {
  jobId: string;
  type: JobType;
  categoryId: string;
  categoryName: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentPromptId: string | null;
  currentPromptText: string | null;
  exampleId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// ── In-memory job store ──────────────────────────────────────────────

const jobs = new Map<string, BatchJob>();

let jobCounter = 0;

function generateJobId(type: JobType): string {
  jobCounter += 1;
  const prefix = type === "batch" ? "batch" : "job";
  return `${prefix}-${Date.now()}-${jobCounter}`;
}

/** Evict completed/failed jobs older than 30 minutes. */
function evictStaleJobs(): void {
  const threshold = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status !== "running" && new Date(job.createdAt).getTime() < threshold) {
      jobs.delete(id);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Return the running batch job for a category, or null if none.
 * Only considers full-batch jobs (not single-prompt jobs).
 * Used internally for double-start prevention.
 */
export function getRunningJobForCategory(categoryId: string): BatchJobSummary | null {
  for (const job of jobs.values()) {
    if (job.categoryId === categoryId && job.status === "running" && (job.type === "batch" || job.type === "batch-re-render" || job.type === "batch-cleanup")) {
      return toSummary(job);
    }
  }
  return null;
}

/**
 * Return ALL running jobs for a category (batch + single-prompt).
 * Used by the category page to reconnect to jobs started elsewhere
 * (e.g. single-prompt generate/retry/re-render from the prompt detail page).
 */
export function getAllRunningJobsForCategory(categoryId: string): BatchJobSummary[] {
  const result: BatchJobSummary[] = [];
  for (const job of jobs.values()) {
    if (job.categoryId === categoryId && job.status === "running") {
      result.push(toSummary(job));
    }
  }
  return result;
}

/**
 * Return any running job that involves a specific prompt.
 * Checks:
 * - Single-prompt jobs (generate/retry/re-render) with matching promptId
 * - Batch jobs where this prompt is currently being processed or is still pending
 */
export function getActiveJobForPrompt(promptId: string): BatchJobSummary | null {
  for (const job of jobs.values()) {
    if (job.status !== "running") continue;

    if (job.type !== "batch") {
      // Single-prompt job — check if it targets this prompt
      if (job.currentPromptId === promptId) {
        return toSummary(job);
      }
    } else {
      // Batch job — check if this prompt is current or still pending
      if (job.currentPromptId === promptId || job.pendingPromptIds.has(promptId)) {
        return toSummary(job);
      }
    }
  }
  return null;
}

/**
 * Return all currently running batch jobs (across all categories).
 */
export function getRunningJobs(): BatchJobSummary[] {
  const running: BatchJobSummary[] = [];
  for (const job of jobs.values()) {
    if (job.status === "running") {
      running.push(toSummary(job));
    }
  }
  return running;
}

/**
 * Start a batch generation job for a category.
 * Optionally skip prompts that already have an approved example.
 * Throws 409 if a batch is already running for this category.
 */
export async function startBatchJob(
  categoryId: string,
  options: { skipApproved?: boolean } = {},
  userId?: string,
): Promise<BatchJobSummary> {
  // Prevent double-starts
  const existing = getRunningJobForCategory(categoryId);
  if (existing) {
    const err = new Error("A batch job is already running for this category");
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  // Verify category exists
  const cat = await prisma.workbenchCategory.findUnique({
    where: { id: categoryId },
    select: { name: true },
  });
  if (!cat) {
    throw new Error("Category not found");
  }
  const categoryName = cat.name;

  // Fetch prompts for this category
  const allPrompts = await prisma.workbenchExamplePrompt.findMany({
    where: { categoryId },
    select: { id: true, prompt: true },
    orderBy: { index: "asc" },
  });

  if (allPrompts.length === 0) {
    throw new Error("No prompts found for this category");
  }

  // Optionally filter out prompts that already have approved examples
  let promptsToProcess = allPrompts;
  if (options.skipApproved) {
    const approvedExamples = await prisma.workbenchExample.findMany({
      where: {
        promptId: { in: allPrompts.map((p) => p.id) },
        approvalStatus: { in: ["auto_approved", "human_approved"] },
      },
      select: { promptId: true },
      distinct: ["promptId"],
    });
    const approvedIds = new Set(approvedExamples.map((r) => r.promptId));
    promptsToProcess = allPrompts.filter((p) => !approvedIds.has(p.id));
  }

  const skippedCount = allPrompts.length - promptsToProcess.length;

  const jobId = generateJobId("batch");
  const job: BatchJob = {
    jobId,
    type: "batch",
    categoryId,
    categoryName,
    status: "running",
    total: promptsToProcess.length,
    completed: 0,
    failed: 0,
    skipped: skippedCount,
    currentPromptId: null,
    currentPromptText: null,
    exampleId: null,
    results: [],
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    pendingPromptIds: new Set(promptsToProcess.map((p) => p.id)),
    userId: userId ?? null,
  };

  jobs.set(jobId, job);

  // Run in background — don't await
  void runBatchJob(job, promptsToProcess);

  return toSummary(job);
}

/**
 * Start a batch re-render job for a category.
 * Re-renders all examples that have code and a successful render, using
 * the existing `reRenderForExample()` pipeline (no AI, no token cost).
 * Useful for backfilling files after a storage migration.
 */
export async function startBatchReRender(categoryId: string): Promise<BatchJobSummary> {
  // Prevent double-starts (reuse same guard as batch generate)
  const existing = getRunningJobForCategory(categoryId);
  if (existing) {
    const err = new Error("A batch job is already running for this category");
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  // Verify category exists
  const cat = await prisma.workbenchCategory.findUnique({
    where: { id: categoryId },
    select: { name: true },
  });
  if (!cat) {
    throw new Error("Category not found");
  }
  const categoryName = cat.name;

  // Fetch all examples with renderable code in this category
  const exampleRows = await prisma.workbenchExample.findMany({
    where: {
      promptRef: { categoryId },
      code: { not: "" },
      renderStatus: "success",
    },
    select: {
      id: true,
      promptId: true,
      promptRef: { select: { prompt: true, index: true } },
      iteration: true,
    },
    orderBy: [
      { promptRef: { index: "asc" } },
      { iteration: "asc" },
    ],
  });

  const examples = exampleRows.map((e) => ({
    id: e.id,
    prompt_id: e.promptId,
    prompt_text: e.promptRef.prompt,
  }));
  if (examples.length === 0) {
    throw new Error("No renderable examples found for this category");
  }

  const jobId = generateJobId("batch-re-render");
  const job: BatchJob = {
    jobId,
    type: "batch-re-render",
    categoryId,
    categoryName,
    status: "running",
    total: examples.length,
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
  };

  jobs.set(jobId, job);

  // Run in background — don't await
  void runBatchReRender(job, examples);

  logger.info(
    { jobId, categoryId, total: examples.length },
    "batch re-render started",
  );

  return toSummary(job);
}

/**
 * Start a single-prompt job (generate, retry, or re-render).
 * Creates a "batch of 1" in the unified job store so the same polling
 * and status APIs work for both batch and single operations.
 */
export async function startSingleJob(
  promptId: string,
  type: "generate" | "retry" | "re-render",
  exampleId?: string,
  userId?: string,
): Promise<BatchJobSummary> {
  evictStaleJobs();

  // Check if there's already an active job for this prompt
  const existing = getActiveJobForPrompt(promptId);
  if (existing) {
    // Return existing job rather than starting a duplicate
    return existing;
  }

  // Look up the prompt's category
  const promptRow = await prisma.workbenchExamplePrompt.findUnique({
    where: { id: promptId },
    select: { prompt: true, categoryId: true, category: { select: { name: true } } },
  });
  if (!promptRow) {
    throw new Error("Prompt not found");
  }
  const promptText = promptRow.prompt;
  const categoryId = promptRow.categoryId;
  const categoryName = promptRow.category.name;

  const jobId = generateJobId(type);
  const job: BatchJob = {
    jobId,
    type,
    categoryId,
    categoryName,
    status: "running",
    total: 1,
    completed: 0,
    failed: 0,
    skipped: 0,
    currentPromptId: promptId,
    currentPromptText: promptText,
    exampleId: exampleId ?? null,
    results: [],
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    pendingPromptIds: new Set(),
    userId: userId ?? null,
  };

  jobs.set(jobId, job);

  // Run in background — don't await
  void runSingleJob(job, promptId, promptText, type, exampleId);

  logger.info(
    { jobId, type, promptId, exampleId },
    "single-prompt job started",
  );

  return toSummary(job);
}

/**
 * Get current status of a job (batch or single).
 */
export function getJobStatus(jobId: string): BatchJobSummary | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  return toSummary(job);
}

/**
 * Get full details of a batch job including per-prompt results.
 * Returns a plain object (omitting non-serializable fields like Sets).
 */
export function getJobDetails(jobId: string): Omit<BatchJob, "pendingPromptIds"> | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  const { pendingPromptIds: _, ...rest } = job;
  return rest;
}

/**
 * Cancel a running batch job. Current prompt will finish but no more will start.
 */
export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return false;
  job.status = "cancelled";
  job.finishedAt = new Date().toISOString();
  return true;
}

/**
 * List all batch jobs, most recent first.
 */
export function listJobs(): BatchJobSummary[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toSummary);
}

// ── Internal ─────────────────────────────────────────────────────────

/** Build a progress callback that publishes ephemeral SSE events to the admin user. */
function buildProgressCallback(job: BatchJob, promptId: string): ProgressCallback | undefined {
  if (!job.userId) return undefined;
  const userId = job.userId;
  return (state: string, detail: string) => {
    sseService.publishEphemeral(userId, "workbench.job.progress", {
      jobId: job.jobId,
      promptId,
      state,
      detail,
    });
  };
}

function toSummary(job: BatchJob): BatchJobSummary {
  return {
    jobId: job.jobId,
    type: job.type,
    categoryId: job.categoryId,
    categoryName: job.categoryName,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    currentPromptId: job.currentPromptId,
    currentPromptText: job.currentPromptText,
    exampleId: job.exampleId,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

async function runBatchJob(
  job: BatchJob,
  prompts: Array<{ id: string; prompt: string }>,
): Promise<void> {
  for (const prompt of prompts) {
    // Check for cancellation before starting next prompt
    if (job.status === "cancelled") {
      break;
    }

    job.currentPromptId = prompt.id;
    job.currentPromptText = prompt.prompt;
    job.pendingPromptIds.delete(prompt.id);

    let result: GenerateResult | null = null;
    try {
      result = await generateForPrompt(prompt.id, buildProgressCallback(job, prompt.id));

      if (result.disambiguationNeeded) {
        // Prompt needs disambiguation — count as skipped
        job.skipped += 1;
        job.results.push({
          promptId: prompt.id,
          promptText: prompt.prompt,
          status: "disambiguation",
          exampleId: null,
          evalScore: null,
          approvalStatus: null,
          error: `Needs clarification: ${result.disambiguationQuestions?.join("; ")}`,
        });
        logger.info(
          { promptId: prompt.id, questions: result.disambiguationQuestions },
          "prompt needs disambiguation, skipped",
        );
      } else if (result.approvalStatus === "rejected") {
        // Prompt was rejected by validation — count as completed (not failed)
        job.completed += 1;
        job.results.push({
          promptId: prompt.id,
          promptText: prompt.prompt,
          status: "rejected",
          exampleId: result.exampleId,
          evalScore: null,
          approvalStatus: "rejected",
          error: result.renderError,
        });
        logger.info(
          { promptId: prompt.id, reason: result.renderError },
          "prompt rejected by validation",
        );
      } else {
        job.completed += 1;
        job.results.push({
          promptId: prompt.id,
          promptText: prompt.prompt,
          status: "success",
          exampleId: result.exampleId,
          evalScore: result.evalScore,
          approvalStatus: result.approvalStatus,
          error: null,
        });

        // Generate embedding for approved examples so they're available for
        // few-shot retrieval by subsequent prompts in this batch
        if (result.approvalStatus === "auto_approved") {
          try {
            await embedAndStorePrompt(prompt.id, prompt.prompt);
          } catch (embedError) {
            logger.error(
              { err: embedError, promptId: prompt.id },
              "failed to embed prompt",
            );
            // Non-fatal: embedding failure shouldn't fail the batch prompt
          }
        }
      }
    } catch (error) {
      // Quota exhaustion → abort entire batch (no point continuing)
      if (error instanceof ProviderQuotaExhaustedError) {
        job.failed += 1;
        job.results.push({
          promptId: prompt.id,
          promptText: prompt.prompt,
          status: "error",
          exampleId: null,
          evalScore: null,
          approvalStatus: null,
          error: error.message,
        });
        job.error = error.message;
        job.status = "failed";
        job.finishedAt = new Date().toISOString();
        job.currentPromptId = null;
        job.currentPromptText = null;
        logger.error({ err: error, jobId: job.jobId }, "batch aborted — provider quota exhausted");
        return;
      }

      job.failed += 1;
      job.results.push({
        promptId: prompt.id,
        promptText: prompt.prompt,
        status: "error",
        exampleId: null,
        evalScore: null,
        approvalStatus: null,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error(
        { err: error, promptId: prompt.id },
        "prompt generation failed",
      );
    }
  }

  job.currentPromptId = null;
  job.currentPromptText = null;
  if (job.status === "running") {
    job.status = "completed";
  }
  job.finishedAt = new Date().toISOString();

  logger.info(
    { jobId: job.jobId, status: job.status, completed: job.completed, failed: job.failed, skipped: job.skipped },
    "batch job finished",
  );
}

async function runSingleJob(
  job: BatchJob,
  promptId: string,
  promptText: string,
  type: "generate" | "retry" | "re-render",
  exampleId?: string,
): Promise<void> {
  try {
    let result: GenerateResult;
    const onProgress = buildProgressCallback(job, promptId);

    if (type === "re-render" && exampleId) {
      result = await reRenderForExample(exampleId, onProgress);
    } else {
      result = await generateForPrompt(promptId, onProgress);
    }

    if (result.approvalStatus === "rejected") {
      job.completed = 1;
      job.results.push({
        promptId,
        promptText,
        status: "rejected",
        exampleId: result.exampleId,
        evalScore: null,
        approvalStatus: "rejected",
        error: result.renderError,
      });
    } else {
      job.completed = 1;
      job.results.push({
        promptId,
        promptText,
        status: "success",
        exampleId: result.exampleId,
        evalScore: result.evalScore,
        approvalStatus: result.approvalStatus,
        error: null,
      });

      // Embed approved examples for few-shot retrieval
      if (type !== "re-render" && result.approvalStatus === "auto_approved") {
        try {
          await embedAndStorePrompt(promptId, promptText);
        } catch (embedError) {
          logger.error(
            { err: embedError, promptId },
            "failed to embed prompt",
          );
        }
      }
    }

    job.status = "completed";
  } catch (error) {
    job.failed = 1;
    job.results.push({
      promptId,
      promptText,
      status: "error",
      exampleId: null,
      evalScore: null,
      approvalStatus: null,
      error: error instanceof Error ? error.message : String(error),
    });
    job.error = error instanceof Error ? error.message : String(error);
    job.status = "failed";

    logger.error(
      { err: error, jobId: job.jobId, type },
      "single-prompt job failed",
    );
  } finally {
    job.currentPromptId = null;
    job.currentPromptText = null;
    job.finishedAt = new Date().toISOString();

    logger.info(
      { jobId: job.jobId, type, status: job.status, duration: Date.now() - new Date(job.createdAt).getTime() },
      "single-prompt job finished",
    );
  }
}

async function runBatchReRender(
  job: BatchJob,
  examples: Array<{ id: string; prompt_id: string; prompt_text: string }>,
): Promise<void> {
  // Track original example IDs that were successfully re-rendered so we can
  // delete them at the end (the new examples replace them).
  const originalIdsToDelete: string[] = [];

  for (const example of examples) {
    // Check for cancellation before starting next example
    if (job.status === "cancelled") {
      break;
    }

    job.currentPromptId = example.prompt_id;
    job.currentPromptText = example.prompt_text;
    job.exampleId = example.id;

    try {
      const result = await reRenderForExample(example.id, buildProgressCallback(job, example.prompt_id));

      job.completed += 1;
      job.results.push({
        promptId: example.prompt_id,
        promptText: example.prompt_text,
        status: result.approvalStatus === "rejected" ? "rejected" : "success",
        exampleId: result.exampleId,
        evalScore: result.evalScore,
        approvalStatus: result.approvalStatus,
        error: result.renderError ?? null,
      });

      // Mark the original for deletion (new example replaces it)
      originalIdsToDelete.push(example.id);
    } catch (error) {
      job.failed += 1;
      job.results.push({
        promptId: example.prompt_id,
        promptText: example.prompt_text,
        status: "error",
        exampleId: null,
        evalScore: null,
        approvalStatus: null,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error(
        { err: error, exampleId: example.id },
        "batch re-render failed for example",
      );
    }
  }

  // Delete original examples that were successfully replaced
  if (originalIdsToDelete.length > 0) {
    try {
      const deleteResult = await prisma.workbenchExample.deleteMany({
        where: { id: { in: originalIdsToDelete } },
      });
      logger.info(
        { deleted: deleteResult.count, total: originalIdsToDelete.length },
        "deleted original examples after batch re-render",
      );
    } catch (error) {
      logger.error(
        { err: error, count: originalIdsToDelete.length },
        "failed to delete original examples after batch re-render",
      );
    }
  }

  job.currentPromptId = null;
  job.currentPromptText = null;
  job.exampleId = null;
  if (job.status === "running") {
    job.status = "completed";
  }
  job.finishedAt = new Date().toISOString();

  logger.info(
    { jobId: job.jobId, status: job.status, completed: job.completed, failed: job.failed, deletedOriginals: originalIdsToDelete.length },
    "batch re-render finished",
  );
}

// ── Batch Cleanup ─────────────────────────────────────────────────────

/**
 * Start a batch cleanup job for a category.
 * For each prompt, keeps only the best example (by approval, score, date)
 * and deletes all others including their stored files.
 */
export async function startBatchCleanup(categoryId: string): Promise<BatchJobSummary> {
  const existing = getRunningJobForCategory(categoryId);
  if (existing) {
    const err = new Error("A batch job is already running for this category");
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  const cat = await prisma.workbenchCategory.findUnique({
    where: { id: categoryId },
    select: { name: true },
  });
  if (!cat) {
    throw new Error("Category not found");
  }
  const categoryName = cat.name;

  // Find prompts that have more than 1 example (nothing to clean if only 1)
  // Subquery with COUNT → raw SQL
  const prompts = await prisma.$queryRaw<{ id: string; prompt: string }[]>`
    SELECT p.id, p.prompt
    FROM workbench_example_prompts p
    WHERE p.category_id = ${categoryId}::uuid
      AND (SELECT COUNT(*) FROM workbench_examples e WHERE e.prompt_id = p.id) > 1
    ORDER BY p.index ASC
  `;
  if (prompts.length === 0) {
    throw new Error("No prompts with multiple examples found — nothing to clean up");
  }

  const jobId = generateJobId("batch-cleanup");
  const job: BatchJob = {
    jobId,
    type: "batch-cleanup",
    categoryId,
    categoryName,
    status: "running",
    total: prompts.length,
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
    pendingPromptIds: new Set(prompts.map((p) => p.id)),
    userId: null,
  };

  jobs.set(jobId, job);

  void runBatchCleanup(job, prompts);

  logger.info(
    { jobId, categoryId, total: prompts.length },
    "batch cleanup started",
  );

  return toSummary(job);
}

async function runBatchCleanup(
  job: BatchJob,
  prompts: Array<{ id: string; prompt: string }>,
): Promise<void> {
  let totalDeleted = 0;
  let totalFilesDeleted = 0;

  for (const prompt of prompts) {
    if (job.status === "cancelled") {
      break;
    }

    job.currentPromptId = prompt.id;
    job.currentPromptText = prompt.prompt;
    job.pendingPromptIds.delete(prompt.id);

    try {
      const result = await cleanupExamplesForPrompt(prompt.id);
      totalDeleted += result.deleted;
      totalFilesDeleted += result.filesDeleted;

      job.completed += 1;
      job.results.push({
        promptId: prompt.id,
        promptText: prompt.prompt,
        status: "success",
        exampleId: result.keptId,
        evalScore: null,
        approvalStatus: null,
        error: null,
      });
    } catch (error) {
      job.failed += 1;
      job.results.push({
        promptId: prompt.id,
        promptText: prompt.prompt,
        status: "error",
        exampleId: null,
        evalScore: null,
        approvalStatus: null,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error(
        { err: error, promptId: prompt.id },
        "cleanup failed for prompt",
      );
    }
  }

  job.currentPromptId = null;
  job.currentPromptText = null;
  if (job.status === "running") {
    job.status = "completed";
  }
  job.finishedAt = new Date().toISOString();

  logger.info(
    { jobId: job.jobId, status: job.status, completed: job.completed, failed: job.failed, totalDeleted, totalFilesDeleted },
    "batch cleanup finished",
  );
}
