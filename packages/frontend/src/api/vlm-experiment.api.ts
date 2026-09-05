/**
 * VLM Experiment API Client
 */

const BASE = "/api/admin/vlm-experiments";

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (response.status === 204) return {} as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

// ── Types ───────────────────────────────────────────────────────────

/** Display name of a run: the model, plus the judge-prompt variant when it has one. */
export function runDisplayLabel(run: { modelLabel: string; judgePromptVariantId?: string | null }, short = false): string {
  const model = short ? (run.modelLabel.split("/").pop() ?? run.modelLabel) : run.modelLabel;
  return run.judgePromptVariantId ? `${model} · ${run.judgePromptVariantId}` : model;
}

export interface VlmExperimentRun {
  id: string;
  modelLabel: string;
  /** Judge-prompt variant this run judges under; null = production's instrument. */
  judgePromptVariantId?: string | null;
  status: string;
  model?: { displayName: string | null };
}

export interface VlmExperiment {
  id: string;
  name: string;
  type: string;
  categoryIds: string[];
  promptCount: number;  // exampleCount
  promptSeed: number;   // exampleSeed
  status: string;
  runs: VlmExperimentRun[];
  vlmExampleSelections?: Array<{ exampleId: string; selectionOrder: number }>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface VlmExperimentListItem {
  id: string;
  name: string;
  categoryIds: string[];
  categoryNames: string[];
  promptCount: number;
  status: string;
  runs: Array<{ id: string; modelLabel: string; status: string; judgePromptVariantId?: string | null }>;
  createdAt: string;
}

export interface VlmExperimentStatus {
  status: string;
  runs: Array<{
    runId: string;
    modelLabel: string;
    judgePromptVariantId?: string | null;
    status: string;
    completedExamples: number;
    totalExamples: number;
  }>;
}

export interface VlmRunMetrics {
  runId: string;
  modelLabel: string;
  judgePromptVariantId?: string | null;
  runOrder: number;
  totalExamples: number;
  evaluatedCount: number;
  errorCount: number;
  avgScore: number | null;
  medianScore: number | null;
  stddevScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  correlationExistingVisualScore: number | null;
  correlationAssertionPassRate: number | null;
  correlationCodeEvalScore: number | null;
  avgScoreAssertionPass: number | null;
  avgScoreAssertionFail: number | null;
  scoreSeparation: number | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  avgDurationMs: number | null;
}

export interface VlmExampleComparisonRun {
  runId: string;
  modelLabel: string;
  visualScore: number | null;
  issues: string[];
  error: string | null;
  durationMs: number | null;
}

export interface VlmExampleComparison {
  exampleId: string;
  promptText: string;
  categoryName: string;
  approvalStatus: string;
  existingVisualScore: number | null;
  existingCodeEvalScore: number | null;
  existingEvalScore: number | null;
  assertionPassRate: number | null;
  screenshotIso: string | null;
  runs: VlmExampleComparisonRun[];
}

export interface InterRaterPair {
  runA: { id: string; label: string };
  runB: { id: string; label: string };
  spearmanCorrelation: number | null;
  meanAbsDifference: number | null;
  agreementCount: number;
  totalPaired: number;
}

export interface PreviewExample {
  id: string;
  screenshotIso: string | null;
  evalScore: string | null;
  visualScore: string | null;
  codeEvalScore: string | null;
  assertionPassRate: string | null;
  approvalStatus: string;
  promptRef: { prompt: string; category: { name: string } };
}

// ── API calls ───────────────────────────────────────────────────────

export async function createVlmExperiment(
  token: string,
  input: {
    name: string; categoryIds: string[]; exampleCount: number; exampleSeed?: number; modelIds: string[];
    /** One run per model and variant; omit for production's instrument. */
    judgePromptVariants?: Array<{ id: string; template: string }>;
  },
): Promise<VlmExperiment> {
  return request(token, "", { method: "POST", body: JSON.stringify(input) });
}

export async function listVlmExperiments(token: string): Promise<{ items: VlmExperimentListItem[]; total: number }> {
  return request(token, "");
}

export async function getVlmExperiment(token: string, id: string): Promise<VlmExperiment> {
  return request(token, `/${id}`);
}

export async function updateVlmExperiment(
  token: string,
  id: string,
  input: { name?: string; categoryIds?: string[]; exampleCount?: number; exampleSeed?: number; modelIds?: string[] },
): Promise<VlmExperiment> {
  return request(token, `/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deleteVlmExperiment(token: string, id: string): Promise<void> {
  await request(token, `/${id}`, { method: "DELETE" });
}

export async function startVlmExperiment(token: string, id: string): Promise<void> {
  await request(token, `/${id}/start`, { method: "POST" });
}

export async function cancelVlmExperiment(token: string, id: string): Promise<void> {
  await request(token, `/${id}/cancel`, { method: "POST" });
}

export async function rerunVlmExperiment(token: string, id: string): Promise<VlmExperiment> {
  return request(token, `/${id}/rerun`, { method: "POST" });
}

export async function resetVlmExperimentRun(token: string, id: string, runId: string): Promise<{ deleted: number }> {
  return request(token, `/${id}/runs/${runId}/results`, { method: "DELETE" });
}

export async function getVlmExperimentStatus(token: string, id: string): Promise<VlmExperimentStatus> {
  return request(token, `/${id}/status`);
}

export async function getVlmComparison(token: string, id: string): Promise<{ runs: VlmRunMetrics[] }> {
  return request(token, `/${id}/comparison`);
}

export async function getVlmPerExampleComparison(token: string, id: string): Promise<VlmExampleComparison[]> {
  return request(token, `/${id}/examples`);
}

export async function getVlmInterRaterAgreement(token: string, id: string): Promise<{ pairs: InterRaterPair[] }> {
  return request(token, `/${id}/inter-rater`);
}

export async function previewVlmExamples(
  token: string,
  categoryIds: string[],
  exampleCount: number,
  exampleSeed: number,
): Promise<{ totalEligible: number; selected: PreviewExample[] }> {
  const params = new URLSearchParams({
    categoryIds: categoryIds.join(","),
    exampleCount: String(exampleCount),
    exampleSeed: String(exampleSeed),
  });
  return request(token, `/preview-examples?${params}`);
}

// Re-export shared helpers from main experiment API
export { listLlmModels, listWorkbenchCategories } from "./experiment.api";
