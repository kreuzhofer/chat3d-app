/**
 * Experiment API Client
 */

const BASE = "/api/admin/experiments";

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

// ── Types ───────────────────────────────────────────────────────────

export interface ExperimentRun {
  id: string;
  modelId?: string;
  modelLabel: string;
  model?: { id: string; displayName: string | null; modelName: string; provider: string };
  runOrder: number;
  fewShotCount?: number | null;
  status: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PromptSelection {
  promptId: string;
  selectionOrder: number;
  prompt: string;
  index: number;
}

export interface Experiment {
  id: string;
  name: string;
  categoryIds: string[];
  categories: Array<{ id: string; name: string; complexity?: number }>;
  promptCount: number;
  promptSeed: number;
  testedPurpose: string;
  fewShotCounts?: number[];
  status: string;
  runs: ExperimentRun[];
  promptSelections?: PromptSelection[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ExperimentListItem {
  id: string;
  name: string;
  categoryIds: string[];
  categoryNames: string[];
  promptCount: number;
  testedPurpose: string;
  status: string;
  runs: Array<{ id: string; modelLabel: string; status: string }>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface RunMetrics {
  runId: string;
  modelLabel: string;
  runOrder: number;
  fewShotCount: number | null;
  totalPrompts: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  avgEvalScore: number | null;
  avgVisualScore: number | null;
  avgCodeEvalScore: number | null;
  avgAssertionPassRate: number | null;
  autoApprovalRate: number;
  avgSteps: number | null;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
  totalCostUsd: number | null;
  avgLlmCalls: number | null;
}

export interface PromptRunResult {
  runId: string;
  modelLabel: string;
  fewShotCount: number | null;
  exampleId: string | null;
  evalScore: number | null;
  visualScore: number | null;
  codeEvalScore: number | null;
  renderStatus: string | null;
  approvalStatus: string | null;
  durationMs: number | null;
  costUsd: number | null;
  totalSteps: number | null;
  renderError: string | null;
  failureReason: string | null;
}

export interface PromptComparison {
  promptId: string;
  promptText: string;
  promptIndex: number;
  runs: PromptRunResult[];
}

export interface ExperimentStatus {
  id: string;
  status: string;
  promptCount: number;
  runs: Array<{
    id: string;
    modelLabel: string;
    runOrder: number;
    fewShotCount?: number | null;
    status: string;
    completedPrompts: number;
    startedAt?: string;
    completedAt?: string;
  }>;
}

// ── API functions ───────────────────────────────────────────────────

export async function listExperiments(token: string, filters?: { status?: string; categoryId?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.categoryId) params.set("categoryId", filters.categoryId);
  const qs = params.size > 0 ? `?${params}` : "";
  return request<{ items: ExperimentListItem[]; total: number }>(token, qs);
}

export async function getExperiment(token: string, id: string) {
  return request<Experiment>(token, `/${id}`);
}

export async function createExperiment(token: string, data: {
  name: string;
  categoryIds: string[];
  promptCount: number;
  promptSeed?: number;
  testedPurpose?: string;
  modelIds: string[];
  fewShotCounts?: number[];
}) {
  return request<Experiment>(token, "", { method: "POST", body: JSON.stringify(data) });
}

export async function updateExperiment(token: string, id: string, data: {
  name?: string;
  categoryIds?: string[];
  promptCount?: number;
  promptSeed?: number;
  modelIds?: string[];
  fewShotCounts?: number[];
}) {
  return request<Experiment>(token, `/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteExperiment(token: string, id: string) {
  return request<{ ok: boolean }>(token, `/${id}`, { method: "DELETE" });
}

export async function startExperiment(token: string, id: string) {
  return request<{ ok: boolean }>(token, `/${id}/start`, { method: "POST" });
}

export async function cancelExperiment(token: string, id: string) {
  return request<{ ok: boolean }>(token, `/${id}/cancel`, { method: "POST" });
}

export async function rerunExperiment(token: string, id: string) {
  return request<{ ok: boolean }>(token, `/${id}/rerun`, { method: "POST" });
}

export async function getExperimentStatus(token: string, id: string) {
  return request<ExperimentStatus>(token, `/${id}/status`);
}

export async function getExperimentComparison(token: string, id: string) {
  return request<{ runs: RunMetrics[] }>(token, `/${id}/comparison`);
}

export async function getPerPromptComparison(token: string, id: string) {
  return request<PromptComparison[]>(token, `/${id}/prompts`);
}

export async function previewPrompts(token: string, categoryIds: string[], count: number, seed: number) {
  return request<Array<{ id: string; prompt: string; index: number }>>(
    token,
    `/preview-prompts?categoryIds=${categoryIds.join(",")}&count=${count}&seed=${seed}`,
  );
}

export async function listLlmModels(token: string) {
  const response = await fetch("/api/admin/llm-models", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? "Failed to load models");
  // Admin API returns snake_case keys
  const raw = (body.models ?? body) as Array<Record<string, unknown>>;
  return raw.map((m) => ({
    id: m.id as string,
    provider: m.provider as string,
    modelName: (m.model_name ?? m.modelName) as string,
    displayName: (m.display_name ?? m.displayName ?? null) as string | null,
    isActive: (m.is_active ?? m.isActive ?? true) as boolean,
  }));
}

export async function listWorkbenchCategories(token: string) {
  const response = await fetch("/api/admin/workbench/categories", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? "Failed to load categories");
  return body as Array<{
    id: string;
    name: string;
    complexity: number;
    promptCount: number;
    approvedPromptCount: number;
  }>;
}
