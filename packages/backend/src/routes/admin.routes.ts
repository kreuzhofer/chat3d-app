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
