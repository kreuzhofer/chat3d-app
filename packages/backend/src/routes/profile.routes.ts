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
import { prisma } from "../db/prisma.js";
import { isSupportedLanguage } from "../i18n/config.js";

export const profileRouter = Router();

profileRouter.post("/reset-password/request", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!newPassword) {
    res.status(400).json({ error: req.t("validation:fields.newPasswordRequired") });
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
    if (error instanceof AccountLifecycleError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: req.t("errors:profile.passwordResetFailed"), detail: String(error) });
  }
});

profileRouter.post("/change-email/request", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const newEmail = typeof req.body?.newEmail === "string" ? req.body.newEmail : "";
  if (!newEmail) {
    res.status(400).json({ error: req.t("validation:fields.newEmailRequired") });
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
    if (error instanceof AccountLifecycleError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: req.t("errors:profile.emailChangeFailed"), detail: String(error) });
  }
});

profileRouter.post("/export-data/request", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  try {
    await requestDataExport({
      userId: authUser.id,
      email: authUser.email,
    });
    res.status(202).json({ status: "pending_confirmation" });
  } catch (error) {
    if (error instanceof AccountLifecycleError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: req.t("errors:profile.dataExportFailed"), detail: String(error) });
  }
});

profileRouter.post("/delete-account/request", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  try {
    await requestAccountDelete({
      userId: authUser.id,
      email: authUser.email,
    });
    res.status(202).json({ status: "pending_confirmation" });
  } catch (error) {
    if (error instanceof AccountLifecycleError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: req.t("errors:profile.accountDeleteFailed"), detail: String(error) });
  }
});

profileRouter.post("/reactivate/request", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  if (!email) {
    res.status(400).json({ error: req.t("validation:fields.emailRequired") });
    return;
  }

  try {
    await requestAccountReactivation({ email });
    res.status(202).json({ status: "pending_confirmation" });
  } catch (error) {
    if (error instanceof AccountLifecycleError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: req.t("errors:profile.accountReactivationFailed"), detail: String(error) });
  }
});

profileRouter.patch("/language", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  const language = typeof req.body?.language === "string" ? req.body.language : "";
  if (!language) {
    res.status(400).json({ error: req.t("validation:fields.languageRequired") });
    return;
  }

  if (!isSupportedLanguage(language)) {
    res.status(400).json({ error: req.t("validation:fields.invalidLanguage", { language }) });
    return;
  }

  try {
    await prisma.user.update({
      where: { id: authUser.id },
      data: { language },
    });
    res.status(200).json({ status: "updated", language });
  } catch (error) {
    res.status(500).json({ error: req.t("errors:profile.languageUpdateFailed"), detail: String(error) });
  }
});

profileRouter.get("/actions/confirm", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";

  try {
    const result = await confirmAccountAction(token);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof AccountLifecycleError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: req.t("errors:profile.confirmActionFailed"), detail: String(error) });
  }
});
