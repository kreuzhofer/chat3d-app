import { Router, type RequestHandler, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  activateUser,
  AdminError,
  deactivateUser,
  getAdminSettings,
  listUsers,
  triggerAdminPasswordReset,
  updateAdminSettings,
} from "../services/admin.service.js";
import {
  approveWaitlistEntry,
  listWaitlistEntries,
  rejectWaitlistEntry,
  WaitlistError,
} from "../services/waitlist.service.js";
import {
  listAllModels,
  createModel,
  updateModel,
  deleteModel,
  listPurposeAssignments,
  updatePurposeAssignment,
  listAllProviders,
  createProvider,
  updateProvider,
  deleteProvider,
} from "../services/llm-config.service.js";

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
    },
  };
}

function sendKnownError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof AdminError || error instanceof WaitlistError) {
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
