const WORKBENCH_API_BASE = "/api/admin/workbench";

async function requestJson<T>(
  token: string,
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<T> {
  const response = await fetch(`${WORKBENCH_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Workbench request failed";
    throw new Error(message);
  }

  return body as T;
}

// ── Types ────────────────────────────────────────────────────────────

export interface WorkbenchCategory {
  id: string;
  rank: number;
  name: string;
  complexity: number;
  description: string;
  promptCount: number;
  autoApprovedCount: number;
  humanApprovedCount: number;
  pendingCount: number;
  rejectedCount: number;
  avgRating: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchPrompt {
  id: string;
  categoryId: string;
  index: number;
  prompt: string;
  description: string | null;
  exampleCount: number;
  bestScore: number | null;
  bestApproval: string | null;
  bestExampleId: string | null;
  bestEvalSource: string | null;
  bestHasAssertions: boolean;
  bestHasScreenshots: boolean;
  hasSpec: boolean;
  createdAt: string;
}

export interface WorkbenchExample {
  id: string;
  promptId: string;
  promptText: string;
  categoryName: string;
  complexity: number;
  iteration: number;
  generationSeed: number | null;
  code: string;
  renderStatus: string;
  renderError: string | null;
  stlPath: string | null;
  stepPath: string | null;
  threemfPath: string | null;
  screenshotFront: string | null;
  screenshotBack: string | null;
  screenshotLeft: string | null;
  screenshotRight: string | null;
  screenshotTop: string | null;
  screenshotBottom: string | null;
  screenshotOrtho45: string | null;
  screenshotOrtho45Bottom: string | null;
  screenshotIso: string | null;
  screenshotIsoBack: string | null;
  evalScore: number | null;
  evalIssues: string[];
  evalSuggestions: string[];
  approvalStatus: string;
  rejectionNote: string | null;
  llmModel: string | null;
  vlmModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportStats {
  categories: Array<{
    categoryId: string;
    categoryName: string;
    rank: number;
    totalPrompts: number;
    totalExamples: number;
    pending: number;
    autoApproved: number;
    humanApproved: number;
    rejected: number;
  }>;
  totals: {
    totalPrompts: number;
    totalExamples: number;
    pending: number;
    autoApproved: number;
    humanApproved: number;
    rejected: number;
  };
}

export type JobType = "batch" | "batch-re-render" | "batch-re-evaluate" | "generate" | "retry" | "re-render" | "re-evaluate";

export interface BatchJobSummary {
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
  exampleId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
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

export interface BatchJobDetail extends BatchJobSummary {
  results: BatchPromptResult[];
}

// ── Categories ───────────────────────────────────────────────────────

export function listCategories(token: string): Promise<WorkbenchCategory[]> {
  return requestJson<WorkbenchCategory[]>(token, "/categories", { method: "GET" });
}

export function listPromptsForCategory(token: string, categoryId: string): Promise<WorkbenchPrompt[]> {
  return requestJson<WorkbenchPrompt[]>(token, `/categories/${encodeURIComponent(categoryId)}/prompts`, {
    method: "GET",
  });
}

export function updatePromptText(token: string, promptId: string, prompt: string, description?: string | null): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/prompts/${encodeURIComponent(promptId)}`, {
    method: "PATCH",
    body: JSON.stringify({ prompt, ...(description !== undefined ? { description } : {}) }),
  });
}

export function deletePrompt(token: string, promptId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/prompts/${encodeURIComponent(promptId)}`, {
    method: "DELETE",
  });
}

// ── Prompt Improvement ──────────────────────────────────────────────

export interface PromptImproveResult {
  variations: string[];
}

export function improvePrompt(token: string, promptId: string): Promise<PromptImproveResult> {
  return requestJson<PromptImproveResult>(token, `/prompts/${encodeURIComponent(promptId)}/improve`, {
    method: "POST",
  });
}

// ── Generation (fire-and-forget — all operations return a job summary) ───

/**
 * Start a background generation job for a prompt.
 * Returns immediately with a job summary; poll via `getJobStatus()`.
 */
export function startGenerate(token: string, promptId: string): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/generate", {
    method: "POST",
    body: JSON.stringify({ promptId }),
  });
}

/**
 * Start a retry (re-generate) job for an existing example.
 * Returns immediately with a job summary; poll via `getJobStatus()`.
 */
export function startRetry(token: string, exampleId: string): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, `/examples/${encodeURIComponent(exampleId)}/retry`, {
    method: "POST",
  });
}

/**
 * Start a re-render job for an existing example.
 * Returns immediately with a job summary; poll via `getJobStatus()`.
 */
export function startReRender(token: string, exampleId: string): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, `/examples/${encodeURIComponent(exampleId)}/re-render`, {
    method: "POST",
  });
}

// ── Job Management (unified for batch and single-prompt jobs) ────────

export function startBatchJob(
  token: string,
  categoryId: string,
  options: { skipApproved?: boolean; onlyMissing?: boolean } = { skipApproved: true },
): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/generate/batch", {
    method: "POST",
    body: JSON.stringify({ categoryId, ...options }),
  });
}

export function startBatchReRender(
  token: string,
  categoryId: string,
): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/re-render/batch", {
    method: "POST",
    body: JSON.stringify({ categoryId }),
  });
}

/**
 * Start a re-evaluate job for an existing example.
 * Re-runs eval pipeline (assertions + code review + VLM) on existing screenshots.
 */
export function startReEvaluate(token: string, exampleId: string): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, `/examples/${encodeURIComponent(exampleId)}/re-evaluate`, {
    method: "POST",
  });
}

export function startBatchReEvaluate(
  token: string,
  categoryId: string,
  mode?: "all" | "missing",
): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/re-evaluate/batch", {
    method: "POST",
    body: JSON.stringify({ categoryId, ...(mode ? { mode } : {}) }),
  });
}

export function startBatchBackfillSpecs(
  token: string,
  categoryId: string,
  regenerate?: boolean,
): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/backfill-specs/batch", {
    method: "POST",
    body: JSON.stringify({ categoryId, ...(regenerate ? { regenerate: true } : {}) }),
  });
}

export function startBatchCleanup(
  token: string,
  categoryId: string,
): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/cleanup/batch", {
    method: "POST",
    body: JSON.stringify({ categoryId }),
  });
}

export function getJobStatus(token: string, jobId: string): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, `/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
  });
}

export function getJobDetails(token: string, jobId: string): Promise<BatchJobDetail> {
  return requestJson<BatchJobDetail>(token, `/jobs/${encodeURIComponent(jobId)}/details`, {
    method: "GET",
  });
}

/** Get ALL running jobs for a category (batch + single-prompt). */
export function getRunningJobsForCategory(token: string, categoryId: string): Promise<BatchJobSummary[]> {
  return requestJson<BatchJobSummary[]>(token, `/jobs/running?categoryId=${encodeURIComponent(categoryId)}`, {
    method: "GET",
  });
}

/** Get the active job (if any) for a specific prompt — works for batch and single-prompt jobs. */
export function getActiveJobForPrompt(token: string, promptId: string): Promise<BatchJobSummary | null> {
  return requestJson<BatchJobSummary | null>(token, `/jobs/running?promptId=${encodeURIComponent(promptId)}`, {
    method: "GET",
  });
}

export function getRunningJobs(token: string): Promise<BatchJobSummary[]> {
  return requestJson<BatchJobSummary[]>(token, "/jobs/running", { method: "GET" });
}

export function cancelJob(token: string, jobId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
}

// ── Examples ─────────────────────────────────────────────────────────

export function listExamplesForPrompt(token: string, promptId: string): Promise<WorkbenchExample[]> {
  return requestJson<WorkbenchExample[]>(token, `/prompts/${encodeURIComponent(promptId)}/examples`, {
    method: "GET",
  });
}

export function getExample(token: string, exampleId: string): Promise<WorkbenchExample> {
  return requestJson<WorkbenchExample>(token, `/examples/${encodeURIComponent(exampleId)}`, {
    method: "GET",
  });
}

export function approveExample(token: string, exampleId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/examples/${encodeURIComponent(exampleId)}/approve`, {
    method: "PATCH",
  });
}

export function rejectExample(token: string, exampleId: string, note?: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/examples/${encodeURIComponent(exampleId)}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ note }),
  });
}

export function updateExampleCode(token: string, exampleId: string, code: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/examples/${encodeURIComponent(exampleId)}/code`, {
    method: "PATCH",
    body: JSON.stringify({ code }),
  });
}

export function deleteExample(token: string, exampleId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/examples/${encodeURIComponent(exampleId)}`, {
    method: "DELETE",
  });
}

export function deleteExamplesForPrompt(token: string, promptId: string): Promise<{ deleted: number }> {
  return requestJson<{ deleted: number }>(token, `/prompts/${encodeURIComponent(promptId)}/examples`, {
    method: "DELETE",
  });
}

export function deleteExamplesForCategory(token: string, categoryId: string): Promise<{ deleted: number }> {
  return requestJson<{ deleted: number }>(token, `/categories/${encodeURIComponent(categoryId)}/examples`, {
    method: "DELETE",
  });
}

// ── Embeddings ───────────────────────────────────────────────────────

export interface EmbeddingStatus {
  total: number;
  embedded: number;
  missing: number;
  stale: number;
  currentModel: string;
}

export interface BackfillResult {
  embedded: number;
  skipped: number;
}

export function getEmbeddingStatus(token: string): Promise<EmbeddingStatus> {
  return requestJson<EmbeddingStatus>(token, "/embeddings/status", { method: "GET" });
}

export async function backfillEmbeddings(token: string): Promise<BackfillResult> {
  // Backfill both prompt embeddings and spec embeddings in one click
  const [promptResult, specResult] = await Promise.all([
    requestJson<BackfillResult>(token, "/embeddings/backfill", { method: "POST" }),
    requestJson<BackfillResult>(token, "/spec-embeddings/backfill", { method: "POST" }),
  ]);
  return { embedded: promptResult.embedded + specResult.embedded, skipped: promptResult.skipped + specResult.skipped };
}

// ── Export ────────────────────────────────────────────────────────────

export function getExportStats(token: string): Promise<ExportStats> {
  return requestJson<ExportStats>(token, "/export/stats", { method: "GET" });
}

export function getExportJsonlUrl(token: string): string {
  return `${WORKBENCH_API_BASE}/export/jsonl?token=${encodeURIComponent(token)}`;
}

// ── Data Transfer (Full Export / Import) ─────────────────────────────

export interface TransferCounts {
  categories: number;
  prompts: number;
  examples: number;
}

export interface TransferJob {
  jobId: string;
  type: "export" | "import";
  status: "running" | "completed" | "failed";
  progress: { phase: string; detail?: string };
  counts: TransferCounts | null;
  filePath: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function startFullExport(token: string): Promise<TransferJob> {
  return requestJson<TransferJob>(token, "/export/full", { method: "POST" });
}

export async function uploadAndImport(token: string, file: File): Promise<TransferJob> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${WORKBENCH_API_BASE}/import/full`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Import upload failed";
    throw new Error(message);
  }

  return body as TransferJob;
}

export function getTransferJob(token: string, jobId: string): Promise<TransferJob> {
  return requestJson<TransferJob>(token, `/transfer-jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
  });
}

export function listTransferJobs(token: string): Promise<TransferJob[]> {
  return requestJson<TransferJob[]>(token, "/transfer-jobs", { method: "GET" });
}

export function deleteTransferJob(token: string, jobId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/transfer-jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}

// ── Trace ─────────────────────────────────────────────────────────────

export interface TraceRecord {
  id: string;
  totalDurationMs: number | null;
  totalCostUsd: number | null;
  totalSteps: number | null;
  totalLlmCalls: number | null;
  finalStatus: string;
  pipelineType: string;
  trace: import("@chat3d/shared").GenerationTrace;
  createdAt: string;
}

export function getExampleTrace(token: string, exampleId: string): Promise<TraceRecord> {
  return requestJson<TraceRecord>(token, `/examples/${encodeURIComponent(exampleId)}/trace`);
}
