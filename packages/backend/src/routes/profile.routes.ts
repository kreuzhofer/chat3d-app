import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  confirmAccountAction,
  AccountLifecycleError,
  requestAccountDelete,
  requestAccountReactivation,
  requestDataExport,
  requestEmailChange,
  requestPasswordReset,
} from "../services/account-lifecycle.service.js";

export const profileRouter = Router();

function sendKnownError(res: Parameters<typeof profileRouter.get>[1] extends (req: infer _Req, res: infer Res) => unknown ? Res : never, error: unknown, fallback: string) {
  if (error instanceof AccountLifecycleError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: fallback, detail: String(error) });
}

profileRouter.post("/reset-password/request", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!newPassword) {
    res.status(400).json({ error: "newPassword is required" });
    return;
  }

  try {
    await requestPasswordReset({
      userId: authUser.id,
      email: authUser.email,
      newPassword,
    });
    res.status(202).json({ status: "pending_confirmation" });
  } catch (error) {
    sendKnownError(res, error, "Failed to request password reset");
  }
});

profileRouter.post("/change-email/request", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const newEmail = typeof req.body?.newEmail === "string" ? req.body.newEmail : "";
  if (!newEmail) {
    res.status(400).json({ error: "newEmail is required" });
    return;
  }

  try {
    await requestEmailChange({
      userId: authUser.id,
      currentEmail: authUser.email,
      newEmail,
    });
    res.status(202).json({ status: "pending_confirmation" });
  } catch (error) {
    sendKnownError(res, error, "Failed to request email change");
  }
});

profileRouter.post("/export-data/request", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    await requestDataExport({
      userId: authUser.id,
      email: authUser.email,
    });
    res.status(202).json({ status: "pending_confirmation" });
  } catch (error) {
    sendKnownError(res, error, "Failed to request data export");
  }
});

profileRouter.post("/delete-account/request", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    await requestAccountDelete({
      userId: authUser.id,
      email: authUser.email,
    });
    res.status(202).json({ status: "pending_confirmation" });
  } catch (error) {
    sendKnownError(res, error, "Failed to request account delete");
  }
});

profileRouter.post("/reactivate/request", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  try {
    await requestAccountReactivation({ email });
    res.status(202).json({ status: "pending_confirmation" });
  } catch (error) {
    sendKnownError(res, error, "Failed to request account reactivation");
  }
});

profileRouter.get("/actions/confirm", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";

  try {
    const result = await confirmAccountAction(token);
    res.status(200).json(result);
  } catch (error) {
    sendKnownError(res, error, "Failed to confirm action");
  }
});
