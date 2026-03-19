import type { UserRole, UserStatus } from "../auth/types";

export type WaitlistStatus =
  | "pending_email_confirmation"
  | "pending_admin_approval"
  | "approved"
  | "rejected";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  deactivatedUntil: string | null;
  onboardingCompletedAt: string | null;
  generationCount: number;
  createdAt: string;
}

export interface AdminWaitlistEntry {
  id: string;
  email: string;
  status: WaitlistStatus;
  marketingConsent: boolean;
  emailConfirmedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface AdminSettings {
  waitlistEnabled: boolean;
  invitationsEnabled: boolean;
  invitationWaitlistRequired: boolean;
  invitationQuotaPerUser: number;
  emailConfirmationEnabled: boolean;
  updatedAt: string;
}

export interface AdminSettingsPatch {
  waitlistEnabled?: boolean;
  invitationsEnabled?: boolean;
  invitationWaitlistRequired?: boolean;
  invitationQuotaPerUser?: number;
  emailConfirmationEnabled?: boolean;
}

const ADMIN_API_BASE = "/api/admin";

async function requestAdminJson<T>(
  token: string,
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<T> {
  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Admin request failed";
    throw new Error(message);
  }

  return body as T;
}

export async function listAdminUsers(token: string, search?: string): Promise<AdminUser[]> {
  const query = new URLSearchParams();
  if (search && search.trim() !== "") {
    query.set("search", search.trim());
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await requestAdminJson<{ users: AdminUser[] }>(token, `/users${suffix}`, { method: "GET" });
  return Array.isArray(response.users) ? response.users : [];
}

export async function deactivateAdminUser(
  token: string,
  userId: string,
  reason?: string,
): Promise<AdminUser> {
  const payload = reason && reason.trim() !== "" ? { reason: reason.trim() } : {};
  return requestAdminJson<AdminUser>(token, `/users/${encodeURIComponent(userId)}/deactivate`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function activateAdminUser(token: string, userId: string): Promise<AdminUser> {
  return requestAdminJson<AdminUser>(token, `/users/${encodeURIComponent(userId)}/activate`, {
    method: "PATCH",
  });
}

export async function triggerAdminPasswordReset(token: string, userId: string): Promise<{
  userId: string;
  email: string;
  status: "pending";
}> {
  return requestAdminJson<{ userId: string; email: string; status: "pending" }>(
    token,
    `/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: "POST",
    },
  );
}

export async function setAdminUserPassword(
  token: string,
  userId: string,
  newPassword: string,
): Promise<{ userId: string; email: string; status: string }> {
  return requestAdminJson(token, `/users/${encodeURIComponent(userId)}/set-password`, {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
}

export async function resetAdminUserOnboarding(
  token: string,
  userId: string,
): Promise<{ userId: string; email: string; status: string }> {
  return requestAdminJson(token, `/users/${encodeURIComponent(userId)}/reset-onboarding`, {
    method: "POST",
  });
}

export async function listAdminWaitlist(token: string): Promise<AdminWaitlistEntry[]> {
  const response = await requestAdminJson<{ entries: AdminWaitlistEntry[] }>(token, "/waitlist", {
    method: "GET",
  });
  return Array.isArray(response.entries) ? response.entries : [];
}

export async function approveAdminWaitlistEntry(
  token: string,
  entryId: string,
): Promise<AdminWaitlistEntry> {
  return requestAdminJson<AdminWaitlistEntry>(token, `/waitlist/${encodeURIComponent(entryId)}/approve`, {
    method: "PATCH",
  });
}

export async function rejectAdminWaitlistEntry(
  token: string,
  entryId: string,
): Promise<AdminWaitlistEntry> {
  return requestAdminJson<AdminWaitlistEntry>(token, `/waitlist/${encodeURIComponent(entryId)}/reject`, {
    method: "PATCH",
  });
}

export async function resendWaitlistConfirmation(
  token: string,
  entryId: string,
): Promise<{ entryId: string; email: string }> {
  return requestAdminJson(token, `/waitlist/${encodeURIComponent(entryId)}/resend-confirmation`, {
    method: "POST",
  });
}

export async function deleteAdminWaitlistEntry(
  token: string,
  entryId: string,
): Promise<{ entryId: string; email: string }> {
  return requestAdminJson(token, `/waitlist/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });
}

export function getAdminSettings(token: string): Promise<AdminSettings> {
  return requestAdminJson<AdminSettings>(token, "/settings", { method: "GET" });
}

export function updateAdminSettings(token: string, patch: AdminSettingsPatch): Promise<AdminSettings> {
  return requestAdminJson<AdminSettings>(token, "/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ── LLM Provider Configuration ────────────────────────────────────

export interface LlmProviderRow {
  name: string;
  provider_type: string | null;
  display_name: string | null;
  api_key: string | null; // masked (e.g., "sk-ab****") — never contains full key
  endpoint_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateLlmProviderInput {
  name: string;
  displayName?: string;
  apiKey?: string | null;
  endpointUrl?: string | null;
  providerType?: string | null;
}

export async function listLlmProviders(token: string): Promise<LlmProviderRow[]> {
  const response = await requestAdminJson<{ providers: LlmProviderRow[] }>(token, "/llm-providers", { method: "GET" });
  return Array.isArray(response.providers) ? response.providers : [];
}

export async function getProviderApiKey(token: string, name: string): Promise<string | null> {
  const result = await requestAdminJson<{ apiKey: string | null }>(token, `/llm-providers/${encodeURIComponent(name)}/api-key`, {
    method: "GET",
  });
  return result.apiKey;
}

export async function fetchProviderModels(token: string, providerName: string): Promise<string[]> {
  const result = await requestAdminJson<{ models: string[] }>(
    token,
    `/llm-providers/${encodeURIComponent(providerName)}/models`,
  );
  return Array.isArray(result.models) ? result.models : [];
}

export async function createLlmProvider(token: string, input: CreateLlmProviderInput): Promise<LlmProviderRow> {
  return requestAdminJson<LlmProviderRow>(token, "/llm-providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateLlmProvider(token: string, name: string, patch: Record<string, unknown>): Promise<LlmProviderRow> {
  return requestAdminJson<LlmProviderRow>(token, `/llm-providers/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteLlmProvider(token: string, name: string): Promise<void> {
  await fetch(`${ADMIN_API_BASE}/llm-providers/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── LLM Model Configuration ────────────────────────────────────────

export interface LlmModelRow {
  id: string;
  provider: string;
  model_name: string;
  display_name: string | null;
  cost_per_1m_input: number;
  cost_per_1m_output: number;
  max_output_tokens: number | null;
  max_context_tokens: number | null;
  supports_thinking: boolean;
  default_thinking_effort: string | null;
  supports_vision: boolean;
  supports_embeddings: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LlmPurposeRow {
  id: string | null;
  purpose: string;
  modelId: string | null;
  modelDisplayName: string | null;
  modelProvider: string | null;
  modelModelName: string | null;
  overrideMaxOutputTokens: number | null;
  overrideThinkingEffort: string | null;
}

export interface CreateLlmModelInput {
  provider: string;
  modelName: string;
  displayName?: string;
  costPer1mInput?: number;
  costPer1mOutput?: number;
  maxOutputTokens?: number | null;
  maxContextTokens?: number | null;
  supportsThinking?: boolean;
  defaultThinkingEffort?: string | null;
  supportsVision?: boolean;
  supportsEmbeddings?: boolean;
}

export async function listAdminLlmModels(token: string): Promise<LlmModelRow[]> {
  const response = await requestAdminJson<{ models: LlmModelRow[] }>(token, "/llm-models", { method: "GET" });
  return Array.isArray(response.models) ? response.models : [];
}

export async function createLlmModel(token: string, input: CreateLlmModelInput): Promise<LlmModelRow> {
  return requestAdminJson<LlmModelRow>(token, "/llm-models", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateLlmModel(token: string, id: string, patch: Record<string, unknown>): Promise<LlmModelRow> {
  return requestAdminJson<LlmModelRow>(token, `/llm-models/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteLlmModel(token: string, id: string): Promise<void> {
  await fetch(`${ADMIN_API_BASE}/llm-models/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listLlmPurposes(token: string): Promise<LlmPurposeRow[]> {
  const response = await requestAdminJson<{ purposes: LlmPurposeRow[] }>(token, "/llm-purposes", { method: "GET" });
  return Array.isArray(response.purposes) ? response.purposes : [];
}

// ── Generation Settings ────────────────────────────────────────────

export interface GenerationSettingDescriptor {
  key: string;
  label: string;
  description: string;
  pipeline: string;
  defaultValue: number;
  effectiveValue: number;
  isOverridden: boolean;
  min: number;
  max: number;
  step: number;
  updatedAt: string | null;
}

export async function listGenerationSettings(token: string): Promise<GenerationSettingDescriptor[]> {
  const response = await requestAdminJson<{ settings: GenerationSettingDescriptor[] }>(token, "/generation-settings", { method: "GET" });
  return Array.isArray(response.settings) ? response.settings : [];
}

export async function updateGenerationSetting(token: string, key: string, value: number): Promise<GenerationSettingDescriptor> {
  return requestAdminJson<GenerationSettingDescriptor>(token, `/generation-settings/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  });
}

export async function revertGenerationSetting(token: string, key: string): Promise<GenerationSettingDescriptor> {
  return requestAdminJson<GenerationSettingDescriptor>(token, `/generation-settings/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

// ── Curation ────────────────────────────────────────────────────────

export type CurationStatus = "pending" | "reviewing" | "approved" | "rejected" | "dismissed";

export interface CurationCandidateRow {
  id: string;
  status: CurationStatus;
  notes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalLikes: number;
  totalDownloads: number;
  remixedFromPromptId: string | null;
  lastAssistantItem: {
    id: string;
    messages: unknown[];
    createdAt: string;
  } | null;
  chatContext: {
    id: string;
    name: string;
    deletedAt: string | null;
  };
}

export interface CurationTag {
  id: string;
  name: string;
  suggestedBy: "llm" | "admin";
}

export interface CurationCandidateDetail {
  id: string;
  status: CurationStatus;
  notes: string | null;
  distilledPrompt: string | null;
  originalPrompt: string | null;
  workbenchExampleId: string | null;
  remixedFromPromptId: string | null;
  remixedFromPrompt: {
    promptId: string;
    promptText: string;
    categoryId: string;
    categoryName: string;
  } | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalLikes: number;
  totalDownloads: number;
  chatContext: {
    id: string;
    name: string;
    deletedAt: string | null;
  };
  conversationItems: Array<{
    id: string;
    role: string;
    messages: unknown[];
    rating: number;
    downloadCount: number;
    createdAt: string;
  }>;
  tags: CurationTag[];
}

export async function listCurationCandidates(
  token: string,
  opts?: { status?: string; limit?: number; offset?: number },
): Promise<{ candidates: CurationCandidateRow[]; total: number }> {
  const query = new URLSearchParams();
  if (opts?.status && opts.status !== "all") query.set("status", opts.status);
  if (opts?.limit) query.set("limit", String(opts.limit));
  if (opts?.offset) query.set("offset", String(opts.offset));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestAdminJson(token, `/curation/candidates${suffix}`, { method: "GET" });
}

export async function getCurationCandidateDetail(
  token: string,
  candidateId: string,
): Promise<CurationCandidateDetail> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}`, {
    method: "GET",
  });
}

export async function updateCurationCandidate(
  token: string,
  candidateId: string,
  patch: { status: CurationStatus; notes?: string },
): Promise<{ id: string; status: CurationStatus }> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function distillCandidatePrompt(
  token: string,
  candidateId: string,
): Promise<{ distilledPrompt: string; originalPrompt: string; skippedLlm: boolean }> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}/distill`, {
    method: "POST",
  });
}

export async function updateCandidatePrompt(
  token: string,
  candidateId: string,
  distilledPrompt: string,
): Promise<{ distilledPrompt: string | null; originalPrompt: string | null }> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}/prompt`, {
    method: "PATCH",
    body: JSON.stringify({ distilledPrompt }),
  });
}

export async function suggestCandidateTags(
  token: string,
  candidateId: string,
): Promise<{ tags: CurationTag[] }> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}/suggest-tags`, {
    method: "POST",
  });
}

export async function listTags(
  token: string,
): Promise<{ tags: Array<{ id: string; name: string; createdAt: string }> }> {
  return requestAdminJson(token, `/tags`, { method: "GET" });
}

export async function addCandidateTag(
  token: string,
  candidateId: string,
  tagName: string,
): Promise<CurationTag> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}/tags`, {
    method: "POST",
    body: JSON.stringify({ tagName }),
  });
}

// ── Similarity Check ────────────────────────────────────────────────

export interface SimilarityMatch {
  prompt: string;
  similarity: number;
  exampleId: string;
  screenshotPath: string | null;
}

export interface SimilarityCheckResult {
  noveltyScore: number;
  maxSimilarity: number;
  matches: SimilarityMatch[];
}

export async function checkCandidateSimilarity(
  token: string,
  candidateId: string,
): Promise<SimilarityCheckResult> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}/check-similarity`, {
    method: "POST",
  });
}

export async function approveCurationCandidate(
  token: string,
  candidateId: string,
): Promise<{ candidateId: string; workbenchExampleId: string; workbenchPromptId: string; categoryId: string }> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}/approve`, {
    method: "POST",
  });
}

export async function approveCurationCandidateAsImprovement(
  token: string,
  candidateId: string,
): Promise<{ candidateId: string; workbenchExampleId: string; workbenchPromptId: string; categoryId: string }> {
  return requestAdminJson(token, `/curation/candidates/${encodeURIComponent(candidateId)}/approve-as-improvement`, {
    method: "POST",
  });
}

export async function removeCandidateTag(
  token: string,
  candidateId: string,
  tagId: string,
): Promise<{ success: boolean }> {
  return requestAdminJson(
    token,
    `/curation/candidates/${encodeURIComponent(candidateId)}/tags/${encodeURIComponent(tagId)}`,
    { method: "DELETE" },
  );
}

export async function updateLlmPurpose(
  token: string,
  purpose: string,
  patch: { modelId?: string; overrideMaxOutputTokens?: number | null; overrideThinkingEffort?: string | null },
): Promise<LlmPurposeRow> {
  return requestAdminJson<LlmPurposeRow>(token, `/llm-purposes/${encodeURIComponent(purpose)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ── Knowledge Sources ───────────────────────────────────────────────

export interface KnowledgeSourceRow {
  id: string;
  name: string;
  strategy: string;
  config: Record<string, unknown>;
  isActive: boolean;
  lastCrawlAt: string | null;
  lastCrawlStatus: string | null;
  lastCrawlMessage: string | null;
  lastCrawlAdded: number | null;
  lastCrawlSkipped: number | null;
  entryCount?: number;
  createdAt: string;
  updatedAt: string;
}

export async function listKnowledgeSources(token: string): Promise<KnowledgeSourceRow[]> {
  const resp = await requestAdminJson<{ sources: KnowledgeSourceRow[] }>(token, "/knowledge/sources");
  return Array.isArray(resp.sources) ? resp.sources : [];
}

export async function createKnowledgeSource(
  token: string,
  input: { name: string; strategy: string; config: Record<string, unknown> },
): Promise<KnowledgeSourceRow> {
  return requestAdminJson(token, "/knowledge/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateKnowledgeSource(
  token: string,
  id: string,
  patch: { name?: string; config?: Record<string, unknown>; isActive?: boolean },
): Promise<KnowledgeSourceRow> {
  return requestAdminJson(token, `/knowledge/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteKnowledgeSource(token: string, id: string): Promise<void> {
  await requestAdminJson(token, `/knowledge/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function triggerCrawl(token: string, sourceId: string): Promise<{ jobId: string }> {
  return requestAdminJson(token, `/knowledge/sources/${encodeURIComponent(sourceId)}/crawl`, { method: "POST" });
}

// ── Knowledge Pipeline ──────────────────────────────────────────────

export async function triggerValidate(token: string, revalidateAll?: boolean): Promise<{ jobId: string }> {
  return requestAdminJson(token, "/knowledge/validate", {
    method: "POST",
    body: JSON.stringify({ revalidateAll: revalidateAll ?? false }),
  });
}

export async function triggerEmbed(token: string): Promise<{ jobId: string }> {
  return requestAdminJson(token, "/knowledge/embed", { method: "POST" });
}

export interface KnowledgeJobStatus {
  id: string;
  name: string;
  state: string;
  data: unknown;
  createdOn: string;
  startedOn: string | null;
  completedOn: string | null;
  output: unknown;
}

export async function getKnowledgeJobStatus(token: string, jobId: string): Promise<KnowledgeJobStatus> {
  return requestAdminJson(token, `/knowledge/jobs/${encodeURIComponent(jobId)}`);
}

// ── Knowledge Entries ───────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  sourceUrl: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string | null;
  code: string;
  validatedAt: string | null;
  validationStatus: string;
  embeddingModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeStats {
  total: number;
  bySourceType: Record<string, number>;
  byValidation: Record<string, number>;
  embedded: number;
  notEmbedded: number;
}

export async function getKnowledgeStats(token: string): Promise<KnowledgeStats> {
  return requestAdminJson(token, "/knowledge/stats");
}

export async function listKnowledgeEntries(
  token: string,
  opts?: { sourceType?: string; validationStatus?: string; sourceId?: string; search?: string; limit?: number; offset?: number },
): Promise<{ entries: KnowledgeEntry[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.sourceType) params.set("sourceType", opts.sourceType);
  if (opts?.validationStatus) params.set("validationStatus", opts.validationStatus);
  if (opts?.sourceId) params.set("sourceId", opts.sourceId);
  if (opts?.search) params.set("search", opts.search);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return requestAdminJson(token, `/knowledge${qs ? `?${qs}` : ""}`);
}

export async function createManualKnowledgeEntry(
  token: string,
  input: { sourceId: string; title: string; code: string; description?: string },
): Promise<KnowledgeEntry> {
  return requestAdminJson(token, "/knowledge/entries", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createReferenceKnowledgeEntry(
  token: string,
  input: { sourceId: string; title: string; content: string; sourceUrl?: string; description?: string },
): Promise<KnowledgeEntry> {
  return requestAdminJson(token, "/knowledge/reference", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateKnowledgeEntry(
  token: string,
  id: string,
  patch: { title?: string; description?: string | null; code?: string; sourceUrl?: string },
): Promise<KnowledgeEntry> {
  return requestAdminJson(token, `/knowledge/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteKnowledgeEntry(token: string, id: string): Promise<void> {
  await requestAdminJson(token, `/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Knowledge Export / Import ───────────────────────────────────────

export async function exportKnowledge(token: string): Promise<{ id: string; label: string }> {
  return requestAdminJson(token, "/knowledge/export", { method: "POST" });
}

export async function importKnowledge(
  token: string,
  file: File,
): Promise<{ message: string; sources: number; entries: number }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${ADMIN_API_BASE}/knowledge/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Import failed");
  }
  return body;
}

// ── Usage Analytics ─────────────────────────────────────────────────

export interface UsageSummary {
  totalCost: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  avgCostPerRequest: number;
  avgInputTokensPerRequest: number;
  avgOutputTokensPerRequest: number;
}

export interface TimeseriesPoint {
  bucket: string;
  group: string | null;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface TimeseriesResponse {
  totals: { cost: number; inputTokens: number; outputTokens: number; requests: number };
  averages: { costPerRequest: number; inputTokensPerRequest: number; outputTokensPerRequest: number };
  series: TimeseriesPoint[];
}

export interface UsageFiltersInput {
  from?: string;
  to?: string;
  userId?: string;
  modelName?: string;
  providerName?: string;
  purpose?: string;
}

function buildUsageQuery(filters: UsageFiltersInput, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.modelName) params.set("modelName", filters.modelName);
  if (filters.providerName) params.set("providerName", filters.providerName);
  if (filters.purpose) params.set("purpose", filters.purpose);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function getUsageSummary(token: string, filters: UsageFiltersInput): Promise<UsageSummary> {
  return requestAdminJson(token, `/usage/summary${buildUsageQuery(filters)}`);
}

export async function getUsageTimeseries(
  token: string,
  filters: UsageFiltersInput,
  granularity: string,
  groupBy?: string,
): Promise<TimeseriesResponse> {
  const extra: Record<string, string> = { granularity };
  if (groupBy) extra.groupBy = groupBy;
  return requestAdminJson(token, `/usage/timeseries${buildUsageQuery(filters, extra)}`);
}

export async function exportUsageData(
  token: string,
  filters: UsageFiltersInput,
  format: "csv" | "json",
): Promise<void> {
  const qs = buildUsageQuery(filters, { format });
  const response = await fetch(`${ADMIN_API_BASE}/usage/export${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Export failed");

  if (format === "csv") {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "usage-events.csv";
    a.click();
    URL.revokeObjectURL(url);
  } else {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "usage-events.json";
    a.click();
    URL.revokeObjectURL(url);
  }
}
