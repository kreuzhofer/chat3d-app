/**
 * Workbench Generate Job Service
 *
 * In-memory job store for single-prompt generation, retry, and re-render
 * operations. Decouples the HTTP request lifecycle from the long-running
 * codegen → render → eval pipeline so that nginx proxy timeouts no longer
 * kill the connection.
 *
 * Jobs run in the background; the frontend polls for status.
 */

import { ProviderQuotaExhaustedError } from "../utils/llm-errors.js";
import { generateForPrompt, reRenderForExample, type GenerateResult } from "./workbench-codegen.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("generate-job");

// ── Types ────────────────────────────────────────────────────────────

export interface GenerateJob {
  jobId: string;
  promptId: string;
  type: "generate" | "retry" | "re-render";
  status: "running" | "completed" | "failed";
  result: GenerateResult | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface GenerateJobSummary {
  jobId: string;
  promptId: string;
  type: "generate" | "retry" | "re-render";
  status: "running" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// ── In-memory job store ──────────────────────────────────────────────

const jobs = new Map<string, GenerateJob>();
let jobCounter = 0;

function generateJobId(): string {
  jobCounter += 1;
  return `gen-${Date.now()}-${jobCounter}`;
}

function toSummary(job: GenerateJob): GenerateJobSummary {
  return {
    jobId: job.jobId,
    promptId: job.promptId,
    type: job.type,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

// ── Housekeeping ─────────────────────────────────────────────────────

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
 * Start a background generation job for a prompt.
 * Returns immediately with a job summary; the pipeline runs in the background.
 */
export function startGenerateJob(promptId: string): GenerateJobSummary {
  evictStaleJobs();

  const jobId = generateJobId();
  const job: GenerateJob = {
    jobId,
    promptId,
    type: "generate",
    status: "running",
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(jobId, job);

  void runJob(job, () => generateForPrompt(promptId));

  return toSummary(job);
}

/**
 * Start a background retry job (re-generate for a prompt from an existing example).
 */
export function startRetryJob(promptId: string): GenerateJobSummary {
  evictStaleJobs();

  const jobId = generateJobId();
  const job: GenerateJob = {
    jobId,
    promptId,
    type: "retry",
    status: "running",
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(jobId, job);

  void runJob(job, () => generateForPrompt(promptId));

  return toSummary(job);
}

/**
 * Start a background re-render job for an existing example.
 */
export function startReRenderJob(exampleId: string, promptId: string): GenerateJobSummary {
  evictStaleJobs();

  const jobId = generateJobId();
  const job: GenerateJob = {
    jobId,
    promptId,
    type: "re-render",
    status: "running",
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(jobId, job);

  void runJob(job, () => reRenderForExample(exampleId));

  return toSummary(job);
}

/**
 * Get job status including the full result if completed.
 */
export function getGenerateJob(jobId: string): GenerateJob | null {
  return jobs.get(jobId) ?? null;
}

/**
 * Get a running job for a specific prompt (to prevent double-starts).
 */
export function getRunningJobForPrompt(promptId: string): GenerateJobSummary | null {
  for (const job of jobs.values()) {
    if (job.promptId === promptId && job.status === "running") {
      return toSummary(job);
    }
  }
  return null;
}

// ── Internal ─────────────────────────────────────────────────────────

async function runJob(
  job: GenerateJob,
  work: () => Promise<GenerateResult>,
): Promise<void> {
  logger.info({ jobId: job.jobId, type: job.type, promptId: job.promptId }, "job started");

  try {
    const result = await work();
    job.result = result;
    job.status = "completed";
  } catch (error) {
    const isQuota = error instanceof ProviderQuotaExhaustedError;
    job.error = error instanceof Error ? error.message : String(error);
    job.status = "failed";
    logger.error(
      { err: error, jobId: job.jobId, isQuota },
      "job failed",
    );
  } finally {
    job.finishedAt = new Date().toISOString();
    logger.info(
      { jobId: job.jobId, status: job.status, duration: Date.now() - new Date(job.createdAt).getTime() },
      "job finished",
    );
  }
}
