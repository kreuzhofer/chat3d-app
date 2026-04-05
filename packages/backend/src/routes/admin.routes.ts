import path from "node:path";
import multer from "multer";
import { Router, type RequestHandler, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  activateUser,
  AdminError,
  deactivateUser,
  deleteUserPermanently,
  getAdminSettings,
  listUsers,
  resetUserOnboarding,
  setUserPassword,
  triggerAdminPasswordReset,
  updateAdminSettings,
} from "../services/admin.service.js";
import {
  approveWaitlistEntry,
  deleteWaitlistEntry,
  listWaitlistEntries,
  rejectWaitlistEntry,
  resendWaitlistConfirmation,
  WaitlistError,
} from "../services/waitlist.service.js";
import {
  listGenerationSettings,
  updateGenerationSetting,
  deleteGenerationSetting,
  GenerationSettingsError,
} from "../services/generation-settings.service.js";
import {
  listCurationCandidates,
  getCandidateDetail,
  updateCandidateStatus,
  CurationError,
} from "../services/curation.service.js";
import {
  distillPrompt,
  suggestTags,
} from "../services/curation-llm.service.js";
import { promoteCandidate, promoteCandidateAsImprovement } from "../services/curation-promote.service.js";
import { checkSimilarity } from "../services/workbench-embeddings.service.js";
import {
  listKnowledgeEntries,
  getKnowledgeEntry,
  deleteKnowledgeEntry,
  deleteKnowledgeBySource,
  getKnowledgeStats,
  backfillKnowledgeEmbeddings,
  createManualEntry,
  createReferenceEntry,
  updateKnowledgeEntry,
  type KnowledgeSourceType,
  type ValidationStatus,
} from "../services/knowledge.service.js";
import {
  listKnowledgeSources,
  getKnowledgeSource,
  createKnowledgeSource,
  updateKnowledgeSource,
  deleteKnowledgeSource,
  validateSourceConfig,
} from "../services/knowledge-source.service.js";
import {
  submitCrawlJob,
  submitValidateJob,
  submitEmbedJob,
  getJobStatus,
} from "../services/job-queue.service.js";
import { exportKnowledge, importKnowledge } from "../services/knowledge-data-transfer.service.js";
import {
  getUsageSummary,
  getUsageTimeseries,
  exportUsageEvents,
} from "../services/usage-analytics.service.js";
import {
  getPipelineSummary,
  getPipelineTimeseries,
  getPipelineToolUsage,
  getPipelineBreakdown,
  getDetailViewAngleBreakdown,
  getDetailViewTimeseries,
} from "../services/pipeline-analytics.service.js";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import {
  listAllModels,
  createModel,
  updateModel,
  deleteModel,
  listPurposeAssignments,
  updatePurposeAssignment,
  listAllProviders,
  getProviderByName,
  createProvider,
  updateProvider,
  deleteProvider,
} from "../services/llm-config.service.js";
import { fetchProviderModels } from "../services/llm-provider-models.service.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

function parseOptionalSearch(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateSettingsPatchBody(body: unknown) {
  const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  if (payload.waitlistEnabled !== undefined && typeof payload.waitlistEnabled !== "boolean") {
    return { valid: false as const, error: "waitlistEnabled must be a boolean" };
  }
  if (payload.invitationsEnabled !== undefined && typeof payload.invitationsEnabled !== "boolean") {
    return { valid: false as const, error: "invitationsEnabled must be a boolean" };
  }
  if (
    payload.invitationWaitlistRequired !== undefined &&
    typeof payload.invitationWaitlistRequired !== "boolean"
  ) {
    return { valid: false as const, error: "invitationWaitlistRequired must be a boolean" };
  }
  if (
    payload.invitationQuotaPerUser !== undefined &&
    (!Number.isInteger(payload.invitationQuotaPerUser) || Number(payload.invitationQuotaPerUser) < 0)
  ) {
    return { valid: false as const, error: "invitationQuotaPerUser must be a non-negative integer" };
  }
  if (
    payload.emailConfirmationEnabled !== undefined &&
    typeof payload.emailConfirmationEnabled !== "boolean"
  ) {
    return { valid: false as const, error: "emailConfirmationEnabled must be a boolean" };
  }

  return {
    valid: true as const,
    payload: {
      waitlistEnabled:
        payload.waitlistEnabled !== undefined ? (payload.waitlistEnabled as boolean) : undefined,
      invitationsEnabled:
        payload.invitationsEnabled !== undefined ? (payload.invitationsEnabled as boolean) : undefined,
      invitationWaitlistRequired:
        payload.invitationWaitlistRequired !== undefined
          ? (payload.invitationWaitlistRequired as boolean)
          : undefined,
      invitationQuotaPerUser:
        payload.invitationQuotaPerUser !== undefined
          ? (payload.invitationQuotaPerUser as number)
          : undefined,
      emailConfirmationEnabled:
        payload.emailConfirmationEnabled !== undefined
          ? (payload.emailConfirmationEnabled as boolean)
          : undefined,
    },
  };
}

function sendKnownError(res: Response, error: unknown, fallbackMessage: string) {
  if (
    error instanceof AdminError ||
    error instanceof WaitlistError ||
    error instanceof GenerationSettingsError ||
    error instanceof CurationError
  ) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: fallbackMessage, detail: String(error) });
}

function readPathParam(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value;
}

const handleDeactivateUser: RequestHandler = async (req, res) => {
  const adminUser = req.authUser;
  if (!adminUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;
  const targetUserId = readPathParam(req.params.userId);
  if (!targetUserId) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const user = await deactivateUser({
      adminUserId: adminUser.id,
      targetUserId,
      reason,
    });
    res.status(200).json(user);
  } catch (error) {
    sendKnownError(res, error, "Failed to deactivate user");
  }
};

const handleActivateUser: RequestHandler = async (req, res) => {
  const adminUser = req.authUser;
  if (!adminUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const targetUserId = readPathParam(req.params.userId);
  if (!targetUserId) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const user = await activateUser({
      adminUserId: adminUser.id,
      targetUserId,
    });
    res.status(200).json(user);
  } catch (error) {
    sendKnownError(res, error, "Failed to activate user");
  }
};

const handleResetPassword: RequestHandler = async (req, res) => {
  const adminUser = req.authUser;
  if (!adminUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const targetUserId = readPathParam(req.params.userId);
  if (!targetUserId) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const result = await triggerAdminPasswordReset({
      adminUserId: adminUser.id,
      targetUserId,
    });
    res.status(202).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to trigger password reset");
  }
};

const handleSetPassword: RequestHandler = async (req, res) => {
  const adminUser = req.authUser;
  if (!adminUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const targetUserId = readPathParam(req.params.userId);
  if (!targetUserId) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const newPassword = req.body?.newPassword;
  if (typeof newPassword !== "string" || newPassword === "") {
    res.status(400).json({ error: "newPassword is required" });
    return;
  }

  try {
    const result = await setUserPassword({
      adminUserId: adminUser.id,
      targetUserId,
      newPassword,
    });
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to set password");
  }
};

const handleApproveWaitlist: RequestHandler = async (req, res) => {
  const authUser = req.authUser;

  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const entryId = readPathParam(req.params.entryId);
  if (!entryId) {
    res.status(400).json({ error: "Invalid waitlist entry id" });
    return;
  }

  try {
    const result = await approveWaitlistEntry({
      waitlistEntryId: entryId,
      approvedByUserId: authUser.id,
    });
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to approve waitlist entry");
  }
};

const handleRejectWaitlist: RequestHandler = async (req, res) => {
  const authUser = req.authUser;

  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const entryId = readPathParam(req.params.entryId);
  if (!entryId) {
    res.status(400).json({ error: "Invalid waitlist entry id" });
    return;
  }

  try {
    const result = await rejectWaitlistEntry({
      waitlistEntryId: entryId,
      approvedByUserId: authUser.id,
    });
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to reject waitlist entry");
  }
};

adminRouter.get("/users", async (req, res) => {
  try {
    const users = await listUsers(parseOptionalSearch(req.query.search));
    res.status(200).json({ users });
  } catch (error) {
    sendKnownError(res, error, "Failed to list users");
  }
});

adminRouter.patch("/users/:userId/deactivate", handleDeactivateUser);
adminRouter.post("/users/:userId/deactivate", handleDeactivateUser);
adminRouter.patch("/users/:userId/activate", handleActivateUser);
adminRouter.post("/users/:userId/activate", handleActivateUser);
adminRouter.post("/users/:userId/reset-password", handleResetPassword);
adminRouter.post("/users/:userId/password-reset", handleResetPassword);
adminRouter.post("/users/:userId/set-password", handleSetPassword);

adminRouter.delete("/users/:userId", async (req, res) => {
  const adminUser = req.authUser;
  if (!adminUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const targetUserId = readPathParam(req.params.userId);
  if (!targetUserId) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const result = await deleteUserPermanently({
      adminUserId: adminUser.id,
      targetUserId,
    });
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to delete user");
  }
});

adminRouter.post("/users/:userId/reset-onboarding", async (req, res) => {
  const adminUser = req.authUser;
  if (!adminUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const targetUserId = readPathParam(req.params.userId);
  if (!targetUserId) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  try {
    const result = await resetUserOnboarding({
      adminUserId: adminUser.id,
      targetUserId,
    });
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to reset user onboarding");
  }
});

adminRouter.get("/settings", async (_req, res) => {
  try {
    const settings = await getAdminSettings();
    res.status(200).json(settings);
  } catch (error) {
    sendKnownError(res, error, "Failed to load admin settings");
  }
});

adminRouter.patch("/settings", async (req, res) => {
  const adminUser = req.authUser;
  if (!adminUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const validated = validateSettingsPatchBody(req.body);
  if (!validated.valid) {
    res.status(400).json({ error: validated.error });
    return;
  }

  try {
    const settings = await updateAdminSettings({
      adminUserId: adminUser.id,
      ...validated.payload,
    });
    res.status(200).json(settings);
  } catch (error) {
    sendKnownError(res, error, "Failed to update admin settings");
  }
});

adminRouter.get("/waitlist", async (_req, res) => {
  try {
    const entries = await listWaitlistEntries(200);
    res.status(200).json({ entries });
  } catch (error) {
    sendKnownError(res, error, "Failed to list waitlist entries");
  }
});

adminRouter.patch("/waitlist/:entryId/approve", handleApproveWaitlist);
adminRouter.post("/waitlist/:entryId/approve", handleApproveWaitlist);
adminRouter.patch("/waitlist/:entryId/reject", handleRejectWaitlist);
adminRouter.post("/waitlist/:entryId/reject", handleRejectWaitlist);

adminRouter.post("/waitlist/:entryId/resend-confirmation", async (req, res) => {
  try {
    const result = await resendWaitlistConfirmation(req.params.entryId);
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to resend waitlist confirmation");
  }
});

adminRouter.delete("/waitlist/:entryId", async (req, res) => {
  try {
    const result = await deleteWaitlistEntry(req.params.entryId);
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to delete waitlist entry");
  }
});

// ── LLM Model Configuration ────────────────────────────────────────

adminRouter.get("/llm-models", async (_req, res) => {
  try {
    const models = await listAllModels();
    res.status(200).json({ models });
  } catch (error) {
    sendKnownError(res, error, "Failed to list LLM models");
  }
});

adminRouter.post("/llm-models", async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.provider !== "string" || typeof body.modelName !== "string") {
    res.status(400).json({ error: "provider and modelName are required" });
    return;
  }

  try {
    const model = await createModel({
      provider: body.provider,
      modelName: body.modelName,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      costPer1mInput: typeof body.costPer1mInput === "number" ? body.costPer1mInput : undefined,
      costPer1mOutput: typeof body.costPer1mOutput === "number" ? body.costPer1mOutput : undefined,
      maxOutputTokens: typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : (body.maxOutputTokens === null ? null : undefined),
      maxContextTokens: typeof body.maxContextTokens === "number" ? body.maxContextTokens : (body.maxContextTokens === null ? null : undefined),
      supportsThinking: typeof body.supportsThinking === "boolean" ? body.supportsThinking : undefined,
      defaultThinkingEffort: typeof body.defaultThinkingEffort === "string" ? body.defaultThinkingEffort : (body.defaultThinkingEffort === null ? null : undefined),
      supportsVision: typeof body.supportsVision === "boolean" ? body.supportsVision : undefined,
      supportsEmbeddings: typeof body.supportsEmbeddings === "boolean" ? body.supportsEmbeddings : undefined,
      streamingEnabled: typeof body.streamingEnabled === "boolean" ? body.streamingEnabled : undefined,
    });
    res.status(201).json(model);
  } catch (error) {
    sendKnownError(res, error, "Failed to create LLM model");
  }
});

adminRouter.patch("/llm-models/:id", async (req, res) => {
  const modelId = readPathParam(req.params.id);
  if (!modelId) {
    res.status(400).json({ error: "Invalid model id" });
    return;
  }

  try {
    const updated = await updateModel(modelId, req.body as Record<string, unknown>);
    if (!updated) {
      res.status(404).json({ error: "Model not found" });
      return;
    }
    res.status(200).json(updated);
  } catch (error) {
    sendKnownError(res, error, "Failed to update LLM model");
  }
});

adminRouter.delete("/llm-models/:id", async (req, res) => {
  const modelId = readPathParam(req.params.id);
  if (!modelId) {
    res.status(400).json({ error: "Invalid model id" });
    return;
  }

  try {
    const deleted = await deleteModel(modelId);
    if (!deleted) {
      res.status(404).json({ error: "Model not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, "Failed to delete LLM model");
  }
});

// ── LLM Purpose Assignments ────────────────────────────────────────

adminRouter.get("/llm-purposes", async (_req, res) => {
  try {
    const purposes = await listPurposeAssignments();
    res.status(200).json({ purposes });
  } catch (error) {
    sendKnownError(res, error, "Failed to list LLM purpose assignments");
  }
});

adminRouter.patch("/llm-purposes/:purpose", async (req, res) => {
  const purpose = readPathParam(req.params.purpose);
  if (!purpose) {
    res.status(400).json({ error: "Invalid purpose" });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body) {
    res.status(400).json({ error: "Request body is required" });
    return;
  }

  try {
    const updated = await updatePurposeAssignment(purpose, {
      modelId: typeof body.modelId === "string" ? body.modelId : undefined,
      overrideMaxOutputTokens: body.overrideMaxOutputTokens !== undefined
        ? (typeof body.overrideMaxOutputTokens === "number" ? body.overrideMaxOutputTokens : null)
        : undefined,
      overrideThinkingEffort: body.overrideThinkingEffort !== undefined
        ? (typeof body.overrideThinkingEffort === "string" ? body.overrideThinkingEffort : null)
        : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "Purpose not found" });
      return;
    }
    res.status(200).json(updated);
  } catch (error) {
    sendKnownError(res, error, "Failed to update LLM purpose assignment");
  }
});

// ── LLM Provider Configuration ──────────────────────────────────────

adminRouter.get("/llm-providers", async (_req, res) => {
  try {
    const providers = await listAllProviders();
    res.status(200).json({ providers });
  } catch (error) {
    sendKnownError(res, error, "Failed to list LLM providers");
  }
});

adminRouter.get("/llm-providers/:name/api-key", async (req, res) => {
  const name = readPathParam(req.params.name);
  if (!name) {
    res.status(400).json({ error: "Invalid provider name" });
    return;
  }

  try {
    const provider = await getProviderByName(name);
    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    res.status(200).json({ apiKey: provider.api_key });
  } catch (error) {
    sendKnownError(res, error, "Failed to retrieve API key");
  }
});

adminRouter.get("/llm-providers/:name/models", async (req, res) => {
  const name = readPathParam(req.params.name);
  if (!name) {
    res.status(400).json({ error: "Invalid provider name" });
    return;
  }

  try {
    const models = await fetchProviderModels(name);
    res.status(200).json({ models });
  } catch (error) {
    sendKnownError(res, error, "Failed to fetch provider models");
  }
});

adminRouter.post("/llm-providers", async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.name !== "string" || body.name.trim() === "") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const provider = await createProvider({
      name: body.name.trim().toLowerCase(),
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      apiKey: typeof body.apiKey === "string" && body.apiKey !== "" ? body.apiKey : null,
      endpointUrl: typeof body.endpointUrl === "string" && body.endpointUrl !== "" ? body.endpointUrl : null,
      providerType: typeof body.providerType === "string" ? body.providerType : null,
    });
    res.status(201).json(provider);
  } catch (error) {
    sendKnownError(res, error, "Failed to create LLM provider");
  }
});

adminRouter.patch("/llm-providers/:name", async (req, res) => {
  const name = readPathParam(req.params.name);
  if (!name) {
    res.status(400).json({ error: "Invalid provider name" });
    return;
  }

  try {
    const updated = await updateProvider(name, req.body as Record<string, unknown>);
    if (!updated) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    res.status(200).json(updated);
  } catch (error) {
    sendKnownError(res, error, "Failed to update LLM provider");
  }
});

adminRouter.delete("/llm-providers/:name", async (req, res) => {
  const name = readPathParam(req.params.name);
  if (!name) {
    res.status(400).json({ error: "Invalid provider name" });
    return;
  }

  try {
    const deleted = await deleteProvider(name);
    if (!deleted) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, "Failed to delete LLM provider");
  }
});

// ── Generation Settings ──────────────────────────────────────────────

adminRouter.get("/generation-settings", async (_req, res) => {
  try {
    const settings = await listGenerationSettings();
    res.status(200).json({ settings });
  } catch (error) {
    sendKnownError(res, error, "Failed to list generation settings");
  }
});

adminRouter.patch("/generation-settings/:key", async (req, res) => {
  const key = readPathParam(req.params.key);
  if (!key) {
    res.status(400).json({ error: "Invalid setting key" });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.value !== "number" || !Number.isFinite(body.value)) {
    res.status(400).json({ error: "value must be a finite number" });
    return;
  }

  try {
    const setting = await updateGenerationSetting(key, body.value);
    res.status(200).json(setting);
  } catch (error) {
    sendKnownError(res, error, "Failed to update generation setting");
  }
});

adminRouter.delete("/generation-settings/:key", async (req, res) => {
  const key = readPathParam(req.params.key);
  if (!key) {
    res.status(400).json({ error: "Invalid setting key" });
    return;
  }

  try {
    const setting = await deleteGenerationSetting(key);
    res.status(200).json(setting);
  } catch (error) {
    sendKnownError(res, error, "Failed to revert generation setting");
  }
});

// ── Curation ─────────────────────────────────────────────────────────

adminRouter.get("/curation/candidates", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : undefined;

    const result = await listCurationCandidates({ status, limit, offset });
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to list curation candidates");
  }
});

adminRouter.get("/curation/candidates/:id", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  try {
    const detail = await getCandidateDetail(id);
    res.status(200).json(detail);
  } catch (error) {
    sendKnownError(res, error, "Failed to get curation candidate");
  }
});

adminRouter.patch("/curation/candidates/:id", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.status !== "string") {
    res.status(400).json({ error: "status is required" });
    return;
  }

  try {
    const notes = typeof body.notes === "string" ? body.notes : undefined;
    const updated = await updateCandidateStatus(id, body.status, notes);
    res.status(200).json(updated);
  } catch (error) {
    sendKnownError(res, error, "Failed to update curation candidate");
  }
});

adminRouter.post("/curation/candidates/:id/distill", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  try {
    const result = await distillPrompt(id);
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to distill prompt");
  }
});

adminRouter.patch("/curation/candidates/:id/prompt", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.distilledPrompt !== "string") {
    res.status(400).json({ error: "distilledPrompt is required" });
    return;
  }

  try {
    const updated = await prisma.curationCandidate.update({
      where: { id },
      data: { distilledPrompt: body.distilledPrompt as string, updatedAt: new Date() },
    });
    res.status(200).json({
      distilledPrompt: updated.distilledPrompt,
      originalPrompt: updated.originalPrompt,
    });
  } catch (error) {
    sendKnownError(res, error, "Failed to update distilled prompt");
  }
});

adminRouter.post("/curation/candidates/:id/suggest-tags", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  try {
    const tags = await suggestTags(id);
    res.status(200).json({ tags });
  } catch (error) {
    sendKnownError(res, error, "Failed to suggest tags");
  }
});

adminRouter.post("/curation/candidates/:id/approve", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  try {
    const result = await promoteCandidate(id);
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to approve curation candidate");
  }
});

adminRouter.post("/curation/candidates/:id/approve-as-improvement", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  try {
    const result = await promoteCandidateAsImprovement(id);
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to approve remix as improvement");
  }
});

adminRouter.post("/curation/candidates/:id/check-similarity", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  try {
    const candidate = await prisma.curationCandidate.findUnique({
      where: { id },
      select: { distilledPrompt: true },
    });

    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }

    if (!candidate.distilledPrompt) {
      res.status(400).json({ error: "Distill the prompt before checking similarity" });
      return;
    }

    const result = await checkSimilarity(candidate.distilledPrompt);
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to check similarity");
  }
});

adminRouter.get("/tags", async (_req, res) => {
  try {
    const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
    res.status(200).json({ tags });
  } catch (error) {
    sendKnownError(res, error, "Failed to list tags");
  }
});

adminRouter.post("/curation/candidates/:id/tags", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body.tagName !== "string" || !body.tagName.trim()) {
    res.status(400).json({ error: "tagName is required" });
    return;
  }

  try {
    const normalizedName = (body.tagName as string).toLowerCase().trim();

    const tag = await prisma.tag.upsert({
      where: { name: normalizedName },
      update: {},
      create: { name: normalizedName },
    });

    await prisma.curationCandidateTag.upsert({
      where: {
        candidateId_tagId: { candidateId: id, tagId: tag.id },
      },
      update: { suggestedBy: "admin" },
      create: {
        candidateId: id,
        tagId: tag.id,
        suggestedBy: "admin",
      },
    });

    res.status(200).json({ id: tag.id, name: tag.name, suggestedBy: "admin" });
  } catch (error) {
    sendKnownError(res, error, "Failed to add tag");
  }
});

adminRouter.delete("/curation/candidates/:id/tags/:tagId", async (req, res) => {
  const id = readPathParam(req.params.id);
  const tagId = readPathParam(req.params.tagId);
  if (!id || !tagId) {
    res.status(400).json({ error: "Invalid candidate id or tag id" });
    return;
  }

  try {
    await prisma.curationCandidateTag.delete({
      where: {
        candidateId_tagId: { candidateId: id, tagId },
      },
    });
    res.status(200).json({ success: true });
  } catch (error) {
    sendKnownError(res, error, "Failed to remove tag");
  }
});

// ── Usage Analytics ──────────────────────────────────────────────────

function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ── Data Quality ──────────────────────────────────────────────────────
adminRouter.get("/data-quality", async (_req, res) => {
  try {
    const { getDataQualityReport } = await import("../services/data-quality.service.js");
    const report = await getDataQualityReport();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: "Failed to generate data quality report", detail: String(error) });
  }
});

// ── Usage Analytics ───────────────────────────────────────────────────
adminRouter.get("/usage/summary", async (req, res) => {
  try {
    const summary = await getUsageSummary({
      from: parseOptionalDate(req.query.from),
      to: parseOptionalDate(req.query.to),
      userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
      modelName: typeof req.query.modelName === "string" ? req.query.modelName : undefined,
      providerName: typeof req.query.providerName === "string" ? req.query.providerName : undefined,
      purpose: typeof req.query.purpose === "string" ? req.query.purpose : undefined,
    });
    res.status(200).json(summary);
  } catch (error) {
    sendKnownError(res, error, "Failed to get usage summary");
  }
});

adminRouter.get("/usage/timeseries", async (req, res) => {
  try {
    const granularity = typeof req.query.granularity === "string" ? req.query.granularity : "day";
    const groupBy = typeof req.query.groupBy === "string" ? req.query.groupBy : undefined;

    const result = await getUsageTimeseries(
      {
        from: parseOptionalDate(req.query.from),
        to: parseOptionalDate(req.query.to),
        userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
        modelName: typeof req.query.modelName === "string" ? req.query.modelName : undefined,
        providerName: typeof req.query.providerName === "string" ? req.query.providerName : undefined,
        purpose: typeof req.query.purpose === "string" ? req.query.purpose : undefined,
      },
      granularity,
      groupBy,
    );
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to get usage timeseries");
  }
});

adminRouter.get("/usage/export", async (req, res) => {
  try {
    const format = req.query.format === "csv" ? "csv" : "json";
    const result = await exportUsageEvents(
      {
        from: parseOptionalDate(req.query.from),
        to: parseOptionalDate(req.query.to),
        userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
        modelName: typeof req.query.modelName === "string" ? req.query.modelName : undefined,
        providerName: typeof req.query.providerName === "string" ? req.query.providerName : undefined,
        purpose: typeof req.query.purpose === "string" ? req.query.purpose : undefined,
      },
      format,
    );

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=usage-events.csv");
      res.status(200).send(result);
    } else {
      res.status(200).json(result);
    }
  } catch (error) {
    sendKnownError(res, error, "Failed to export usage events");
  }
});

// ── Pipeline Analytics ───────────────────────────────────────────────

adminRouter.get("/pipeline/summary", async (req, res) => {
  try {
    const summary = await getPipelineSummary({
      from: parseOptionalDate(req.query.from),
      to: parseOptionalDate(req.query.to),
      pipelineType: typeof req.query.pipelineType === "string" ? req.query.pipelineType : undefined,
    });
    res.status(200).json(summary);
  } catch (error) {
    sendKnownError(res, error, "Failed to get pipeline summary");
  }
});

adminRouter.get("/pipeline/timeseries", async (req, res) => {
  try {
    const granularity = typeof req.query.granularity === "string" ? req.query.granularity : "day";
    const result = await getPipelineTimeseries(
      {
        from: parseOptionalDate(req.query.from),
        to: parseOptionalDate(req.query.to),
        pipelineType: typeof req.query.pipelineType === "string" ? req.query.pipelineType : undefined,
      },
      granularity,
    );
    res.status(200).json({ series: result });
  } catch (error) {
    sendKnownError(res, error, "Failed to get pipeline timeseries");
  }
});

adminRouter.get("/pipeline/tools", async (req, res) => {
  try {
    const tools = await getPipelineToolUsage({
      from: parseOptionalDate(req.query.from),
      to: parseOptionalDate(req.query.to),
      pipelineType: typeof req.query.pipelineType === "string" ? req.query.pipelineType : undefined,
    });
    res.status(200).json({ tools });
  } catch (error) {
    sendKnownError(res, error, "Failed to get pipeline tool usage");
  }
});

adminRouter.get("/pipeline/breakdown", async (req, res) => {
  try {
    const breakdown = await getPipelineBreakdown({
      from: parseOptionalDate(req.query.from),
      to: parseOptionalDate(req.query.to),
      pipelineType: typeof req.query.pipelineType === "string" ? req.query.pipelineType : undefined,
    });
    res.status(200).json(breakdown);
  } catch (error) {
    sendKnownError(res, error, "Failed to get pipeline breakdown");
  }
});

adminRouter.get("/pipeline/detail-view-timeseries", async (req, res) => {
  try {
    const granularity = typeof req.query.granularity === "string" ? req.query.granularity : "day";
    const series = await getDetailViewTimeseries(
      {
        from: parseOptionalDate(req.query.from),
        to: parseOptionalDate(req.query.to),
        pipelineType: typeof req.query.pipelineType === "string" ? req.query.pipelineType : undefined,
      },
      granularity,
    );
    res.status(200).json({ series });
  } catch (error) {
    sendKnownError(res, error, "Failed to get detail view timeseries");
  }
});

adminRouter.get("/pipeline/detail-view-angles", async (req, res) => {
  try {
    const angles = await getDetailViewAngleBreakdown({
      from: parseOptionalDate(req.query.from),
      to: parseOptionalDate(req.query.to),
      pipelineType: typeof req.query.pipelineType === "string" ? req.query.pipelineType : undefined,
    });
    res.status(200).json({ angles });
  } catch (error) {
    sendKnownError(res, error, "Failed to get detail view angle breakdown");
  }
});

// ── Knowledge Sources ───────────────────────────────────────────────

adminRouter.get("/knowledge/sources", async (_req, res) => {
  try {
    const sources = await listKnowledgeSources();
    res.status(200).json({ sources });
  } catch (error) {
    sendKnownError(res, error, "Failed to list knowledge sources");
  }
});

adminRouter.post("/knowledge/sources", async (req, res) => {
  try {
    const { name, strategy, config } = req.body;
    if (!name || !strategy) {
      res.status(400).json({ error: "name and strategy are required" });
      return;
    }
    const validation = validateSourceConfig(strategy, config ?? {});
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors.join(", ") });
      return;
    }
    const source = await createKnowledgeSource({ name, strategy, config: config ?? {} });
    res.status(201).json(source);
  } catch (error) {
    sendKnownError(res, error, "Failed to create knowledge source");
  }
});

adminRouter.get("/knowledge/sources/:id", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid source id" }); return; }
  try {
    const source = await getKnowledgeSource(id);
    if (!source) { res.status(404).json({ error: "Source not found" }); return; }
    res.status(200).json(source);
  } catch (error) {
    sendKnownError(res, error, "Failed to get knowledge source");
  }
});

adminRouter.patch("/knowledge/sources/:id", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid source id" }); return; }
  try {
    const source = await updateKnowledgeSource(id, req.body);
    res.status(200).json(source);
  } catch (error) {
    sendKnownError(res, error, "Failed to update knowledge source");
  }
});

adminRouter.delete("/knowledge/sources/:id", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid source id" }); return; }
  try {
    await deleteKnowledgeSource(id);
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, "Failed to delete knowledge source");
  }
});

adminRouter.post("/knowledge/sources/:id/crawl", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid source id" }); return; }
  try {
    const source = await getKnowledgeSource(id);
    if (!source) { res.status(404).json({ error: "Source not found" }); return; }
    if (source.strategy === "manual") { res.status(400).json({ error: "Cannot crawl a manual source" }); return; }
    const jobId = await submitCrawlJob(id);
    res.status(202).json({ jobId, message: "Crawl job submitted" });
  } catch (error) {
    sendKnownError(res, error, "Failed to submit crawl job");
  }
});

// ── Knowledge Pipeline ──────────────────────────────────────────────

adminRouter.post("/knowledge/validate", async (req, res) => {
  try {
    const revalidateAll = req.body?.revalidateAll === true;
    const jobId = await submitValidateJob({ revalidateAll });
    res.status(202).json({ jobId, message: "Validate job submitted" });
  } catch (error) {
    sendKnownError(res, error, "Failed to submit validate job");
  }
});

adminRouter.post("/knowledge/embed", async (_req, res) => {
  try {
    const jobId = await submitEmbedJob();
    res.status(202).json({ jobId, message: "Embed job submitted" });
  } catch (error) {
    sendKnownError(res, error, "Failed to submit embed job");
  }
});

adminRouter.get("/knowledge/jobs/:jobId", async (req, res) => {
  const jobId = readPathParam(req.params.jobId);
  if (!jobId) { res.status(400).json({ error: "Invalid job id" }); return; }
  try {
    const status = await getJobStatus(jobId);
    if (!status) { res.status(404).json({ error: "Job not found" }); return; }
    res.status(200).json(status);
  } catch (error) {
    sendKnownError(res, error, "Failed to get job status");
  }
});

// ── Knowledge Entries ───────────────────────────────────────────────

const VALID_SOURCE_TYPES = new Set(["docs", "github_example", "github_test", "forum", "blog", "manual", "reference"]);
const VALID_VALIDATION_STATUSES = new Set(["pending", "valid", "invalid", "error"]);

adminRouter.get("/knowledge", async (req, res) => {
  try {
    const sourceType = typeof req.query.sourceType === "string" && VALID_SOURCE_TYPES.has(req.query.sourceType)
      ? (req.query.sourceType as KnowledgeSourceType)
      : undefined;
    const validationStatus = typeof req.query.validationStatus === "string" && VALID_VALIDATION_STATUSES.has(req.query.validationStatus)
      ? (req.query.validationStatus as ValidationStatus)
      : undefined;
    const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : undefined;

    const result = await listKnowledgeEntries({ sourceType, validationStatus, sourceId, search, limit, offset });
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to list knowledge entries");
  }
});

adminRouter.get("/knowledge/stats", async (_req, res) => {
  try {
    const stats = await getKnowledgeStats();
    res.status(200).json(stats);
  } catch (error) {
    sendKnownError(res, error, "Failed to get knowledge stats");
  }
});

adminRouter.post("/knowledge/entries", async (req, res) => {
  try {
    const { sourceId, title, code, description } = req.body;
    if (!sourceId || !title || !code) {
      res.status(400).json({ error: "sourceId, title, and code are required" });
      return;
    }
    const entry = await createManualEntry({ sourceId, title, code, description });
    res.status(201).json(entry);
  } catch (error) {
    sendKnownError(res, error, "Failed to create manual entry");
  }
});

adminRouter.post("/knowledge/reference", async (req, res) => {
  try {
    const { sourceId, sourceUrl, title, content, description } = req.body;
    if (!sourceId || !title || !content) {
      res.status(400).json({ error: "sourceId, title, and content are required" });
      return;
    }
    const entry = await createReferenceEntry({ sourceId, sourceUrl, title, content, description });
    res.status(201).json(entry);
  } catch (error) {
    sendKnownError(res, error, "Failed to create reference entry");
  }
});

adminRouter.get("/knowledge/:id", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid knowledge entry id" });
    return;
  }

  try {
    const entry = await getKnowledgeEntry(id);
    if (!entry) {
      res.status(404).json({ error: "Knowledge entry not found" });
      return;
    }
    res.status(200).json(entry);
  } catch (error) {
    sendKnownError(res, error, "Failed to get knowledge entry");
  }
});

adminRouter.patch("/knowledge/:id", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid knowledge entry id" });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body) {
    res.status(400).json({ error: "Request body is required" });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.description === "string" || body.description === null) patch.description = body.description;
  if (typeof body.code === "string") patch.code = body.code;
  if (typeof body.sourceUrl === "string") patch.sourceUrl = body.sourceUrl;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  try {
    const updated = await updateKnowledgeEntry(id, patch as Parameters<typeof updateKnowledgeEntry>[1]);
    if (!updated) {
      res.status(404).json({ error: "Knowledge entry not found" });
      return;
    }
    res.status(200).json(updated);
  } catch (error) {
    sendKnownError(res, error, "Failed to update knowledge entry");
  }
});

adminRouter.delete("/knowledge/:id", async (req, res) => {
  const id = readPathParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid knowledge entry id" });
    return;
  }

  try {
    await deleteKnowledgeEntry(id);
    res.status(204).send();
  } catch (error) {
    sendKnownError(res, error, "Failed to delete knowledge entry");
  }
});

// ── Knowledge Export / Import ───────────────────────────────────────

adminRouter.post("/knowledge/export", async (_req, res) => {
  try {
    const backup = await exportKnowledge();
    res.status(200).json(backup);
  } catch (error) {
    sendKnownError(res, error, "Failed to export knowledge");
  }
});

const knowledgeImportUpload = multer({
  dest: path.join(config.storage.rootDir, "knowledge-exports"),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

adminRouter.post(
  "/knowledge/import",
  knowledgeImportUpload.single("file") as RequestHandler,
  async (req, res) => {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    try {
      const counts = await importKnowledge(file.path);
      res.status(200).json({ message: "Import completed", ...counts });
    } catch (error) {
      sendKnownError(res, error, "Failed to import knowledge");
    }
  },
);
