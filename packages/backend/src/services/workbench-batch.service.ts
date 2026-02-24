/**
 * Workbench Batch Generation Service
 *
 * In-memory job queue for generating examples across an entire category.
 * Jobs run sequentially (one prompt at a time) to avoid overwhelming
 * the Build123d rendering service and LLM APIs.
 */

import { pool } from "../db/connection.js";
import { generateForPrompt, type GenerateResult } from "./workbench-codegen.service.js";

// ── Types ────────────────────────────────────────────────────────────

export interface BatchJob {
  jobId: string;
  categoryId: string;
  categoryName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentPromptId: string | null;
  currentPromptText: string | null;
  results: BatchPromptResult[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface BatchPromptResult {
  promptId: string;
  promptText: string;
  status: "success" | "error" | "skipped";
  exampleId: string | null;
  evalScore: number | null;
  approvalStatus: string | null;
  error: string | null;
}

export interface BatchJobSummary {
  jobId: string;
  categoryId: string;
  categoryName: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentPromptText: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// ── In-memory job store ──────────────────────────────────────────────

const jobs = new Map<string, BatchJob>();

let jobCounter = 0;

function generateJobId(): string {
  jobCounter += 1;
  return `batch-${Date.now()}-${jobCounter}`;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Start a batch generation job for a category.
 * Optionally skip prompts that already have an approved example.
 */
export async function startBatchJob(
  categoryId: string,
  options: { skipApproved?: boolean } = {},
): Promise<BatchJobSummary> {
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

  const jobId = generateJobId();
  const job: BatchJob = {
    jobId,
    categoryId,
    categoryName,
    status: "running",
    total: promptsToProcess.length,
    completed: 0,
    failed: 0,
    skipped: skippedCount,
    currentPromptId: null,
    currentPromptText: null,
    results: [],
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };

  jobs.set(jobId, job);

  // Run in background — don't await
  void runBatchJob(job, promptsToProcess);

  return toSummary(job);
}

/**
 * Get current status of a batch job.
 */
export function getJobStatus(jobId: string): BatchJobSummary | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  return toSummary(job);
}

/**
 * Get full details of a batch job including per-prompt results.
 */
export function getJobDetails(jobId: string): BatchJob | null {
  return jobs.get(jobId) ?? null;
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
    categoryId: job.categoryId,
    categoryName: job.categoryName,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    currentPromptText: job.currentPromptText,
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

    let result: GenerateResult | null = null;
    try {
      result = await generateForPrompt(prompt.id);
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
      console.error(
        `[workbench-batch] Failed prompt ${prompt.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  job.currentPromptId = null;
  job.currentPromptText = null;
  if (job.status === "running") {
    job.status = "completed";
  }
  job.finishedAt = new Date().toISOString();

  console.log(
    `[workbench-batch] Job ${job.jobId} ${job.status}: ${job.completed} completed, ${job.failed} failed, ${job.skipped} skipped`,
  );
}
