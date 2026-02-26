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

import { pool } from "../db/connection.js";
import { ProviderQuotaExhaustedError } from "../utils/llm-errors.js";
import { generateForPrompt, reRenderForExample, type GenerateResult } from "./workbench-codegen.service.js";
import { embedAndStorePrompt } from "./workbench-embeddings.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("workbench-batch");

// ── Types ────────────────────────────────────────────────────────────

export type JobType = "batch" | "batch-re-render" | "generate" | "retry" | "re-render";

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
}

export interface BatchPromptResult {
  promptId: string;
  promptText: string;
  status: "success" | "error" | "skipped" | "rejected";
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
 */
export function getRunningJobForCategory(categoryId: string): BatchJobSummary | null {
  for (const job of jobs.values()) {
    if (job.categoryId === categoryId && job.status === "running" && (job.type === "batch" || job.type === "batch-re-render")) {
      return toSummary(job);
    }
  }
  return null;
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
): Promise<BatchJobSummary> {
  // Prevent double-starts
  const existing = getRunningJobForCategory(categoryId);
  if (existing) {
    const err = new Error("A batch job is already running for this category");
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  // Verify category exists
  const catResult = await pool.query<{ name: string }>(
    `SELECT name FROM workbench_categories WHERE id = $1`,
    [categoryId],
  );
  if (catResult.rows.length === 0) {
    throw new Error("Category not found");
  }
  const categoryName = catResult.rows[0].name;

  // Fetch prompts for this category
  const promptResult = await pool.query<{ id: string; prompt: string }>(
    `SELECT id, prompt FROM workbench_example_prompts
     WHERE category_id = $1
     ORDER BY index ASC`,
    [categoryId],
  );
  const allPrompts = promptResult.rows;

  if (allPrompts.length === 0) {
    throw new Error("No prompts found for this category");
  }

  // Optionally filter out prompts that already have approved examples
  let promptsToProcess = allPrompts;
  if (options.skipApproved) {
    const approvedResult = await pool.query<{ prompt_id: string }>(
      `SELECT DISTINCT prompt_id
       FROM workbench_examples
       WHERE prompt_id = ANY($1::uuid[])
         AND approval_status IN ('auto_approved', 'human_approved')`,
      [allPrompts.map((p) => p.id)],
    );
    const approvedIds = new Set(approvedResult.rows.map((r) => r.prompt_id));
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
  const catResult = await pool.query<{ name: string }>(
    `SELECT name FROM workbench_categories WHERE id = $1`,
    [categoryId],
  );
  if (catResult.rows.length === 0) {
    throw new Error("Category not found");
  }
  const categoryName = catResult.rows[0].name;

  // Fetch all examples with renderable code in this category
  const exampleResult = await pool.query<{ id: string; prompt_id: string; prompt_text: string }>(
    `SELECT e.id, e.prompt_id, p.prompt AS prompt_text
     FROM workbench_examples e
     JOIN workbench_example_prompts p ON p.id = e.prompt_id
     WHERE p.category_id = $1
       AND e.code IS NOT NULL
       AND e.code != ''
       AND e.render_status = 'success'
     ORDER BY p.index ASC, e.iteration ASC`,
    [categoryId],
  );

  const examples = exampleResult.rows;
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
): Promise<BatchJobSummary> {
  evictStaleJobs();

  // Check if there's already an active job for this prompt
  const existing = getActiveJobForPrompt(promptId);
  if (existing) {
    // Return existing job rather than starting a duplicate
    return existing;
  }

  // Look up the prompt's category
  const promptResult = await pool.query<{ prompt: string; category_id: string }>(
    `SELECT prompt, category_id FROM workbench_example_prompts WHERE id = $1`,
    [promptId],
  );
  if (promptResult.rows.length === 0) {
    throw new Error("Prompt not found");
  }
  const { prompt: promptText, category_id: categoryId } = promptResult.rows[0];

  const catResult = await pool.query<{ name: string }>(
    `SELECT name FROM workbench_categories WHERE id = $1`,
    [categoryId],
  );
  const categoryName = catResult.rows[0]?.name ?? "Unknown";

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
      result = await generateForPrompt(prompt.id);

      if (result.approvalStatus === "rejected") {
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

    if (type === "re-render" && exampleId) {
      result = await reRenderForExample(exampleId);
    } else {
      result = await generateForPrompt(promptId);
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
      const result = await reRenderForExample(example.id);

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
      const deleteResult = await pool.query(
        `DELETE FROM workbench_examples WHERE id = ANY($1::uuid[])`,
        [originalIdsToDelete],
      );
      logger.info(
        { deleted: deleteResult.rowCount, total: originalIdsToDelete.length },
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
