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
  exampleCount: number;
  bestScore: number | null;
  bestApproval: string | null;
  bestExampleId: string | null;
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
  screenshotTop: string | null;
  screenshotIso: string | null;
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

export interface WorkbenchSystemPrompt {
  id: string;
  version: number;
  label: string;
  content: string;
  isActive: boolean;
  createdAt: string;
}

export interface GenerateResult {
  exampleId: string;
  promptId: string;
  iteration: number;
  code: string;
  renderStatus: string;
  renderError: string | null;
  evalScore: number | null;
  evalIssues: string[] | null;
  evalSuggestions: string[] | null;
  approvalStatus: string;
  llmModel: string;
  vlmModel: string | null;
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

export interface SeedResult {
  categories: number;
  prompts: number;
  systemPromptSeeded: boolean;
}

export interface BatchJobSummary {
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
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
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

export function seedCategories(token: string): Promise<SeedResult> {
  return requestJson<SeedResult>(token, "/categories/seed", { method: "POST" });
}

export function updatePromptText(token: string, promptId: string, prompt: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/prompts/${encodeURIComponent(promptId)}`, {
    method: "PATCH",
    body: JSON.stringify({ prompt }),
  });
}

// ── Generation (async job-based) ─────────────────────────────────────

export interface GenerateJobSummary {
  jobId: string;
  promptId: string;
  type: "generate" | "retry" | "re-render";
  status: "running" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface GenerateJobDetail extends GenerateJobSummary {
  result: GenerateResult | null;
}

/**
 * Start a background generation job. Returns immediately with a job summary.
 * Poll `getGenerateJobStatus()` to track progress.
 */
export function startGenerate(token: string, promptId: string): Promise<GenerateJobSummary> {
  return requestJson<GenerateJobSummary>(token, "/generate", {
    method: "POST",
    body: JSON.stringify({ promptId }),
  });
}

/** Get the full status of a generation job, including the result when completed. */
export function getGenerateJobStatus(token: string, jobId: string): Promise<GenerateJobDetail> {
  return requestJson<GenerateJobDetail>(token, `/generate/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
  });
}

/**
 * High-level helper: start a generation job and poll until it completes.
 * Returns the final GenerateResult on success, throws on failure.
 */
export async function generateForPrompt(token: string, promptId: string): Promise<GenerateResult> {
  const job = await startGenerate(token, promptId);
  return pollGenerateJob(token, job.jobId);
}

async function pollGenerateJob(token: string, jobId: string): Promise<GenerateResult> {
  const POLL_INTERVAL = 3000;
  const MAX_POLL_TIME = 30 * 60 * 1000; // 30 minutes
  const start = Date.now();

  while (Date.now() - start < MAX_POLL_TIME) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const detail = await getGenerateJobStatus(token, jobId);

    if (detail.status === "completed" && detail.result) {
      return detail.result;
    }
    if (detail.status === "failed") {
      throw new Error(detail.error ?? "Generation job failed");
    }
    // Still running — continue polling
  }

  throw new Error("Generation timed out after 30 minutes");
}

// ── Batch Generation ────────────────────────────────────────────────

export function startBatchJob(
  token: string,
  categoryId: string,
  skipApproved = true,
): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/generate/batch", {
    method: "POST",
    body: JSON.stringify({ categoryId, skipApproved }),
  });
}

export function getJobStatus(token: string, jobId: string): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, `/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
  });
}

export function getRunningJob(token: string, categoryId: string): Promise<BatchJobSummary | null> {
  return requestJson<BatchJobSummary | null>(token, `/jobs/running?categoryId=${encodeURIComponent(categoryId)}`, {
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

export async function retryExample(token: string, exampleId: string): Promise<GenerateResult> {
  const job = await requestJson<GenerateJobSummary>(token, `/examples/${encodeURIComponent(exampleId)}/retry`, {
    method: "POST",
  });
  return pollGenerateJob(token, job.jobId);
}

export async function reRenderExample(token: string, exampleId: string): Promise<GenerateResult> {
  const job = await requestJson<GenerateJobSummary>(token, `/examples/${encodeURIComponent(exampleId)}/re-render`, {
    method: "POST",
  });
  return pollGenerateJob(token, job.jobId);
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

// ── System Prompts ───────────────────────────────────────────────────

export function listSystemPrompts(token: string): Promise<WorkbenchSystemPrompt[]> {
  return requestJson<WorkbenchSystemPrompt[]>(token, "/system-prompts", { method: "GET" });
}

export function activateSystemPrompt(token: string, promptId: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(token, `/system-prompts/${encodeURIComponent(promptId)}/activate`, {
    method: "POST",
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

export function backfillEmbeddings(token: string): Promise<BackfillResult> {
  return requestJson<BackfillResult>(token, "/embeddings/backfill", { method: "POST" });
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
  systemPrompts: number;
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
