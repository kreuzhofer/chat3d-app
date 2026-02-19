import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createInvitationsForUser,
  InvitationError,
  listInvitationsForUser,
  revokeInvitationForUser,
} from "../services/invitation.service.js";

export const invitationsRouter = Router();

invitationsRouter.use(requireAuth);

invitationsRouter.get("/", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const invitations = await listInvitationsForUser(authUser.id);
  res.status(200).json({ invitations });
});

invitationsRouter.post("/", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const emailsFromArray = Array.isArray(req.body?.emails)
    ? req.body.emails.filter((value: unknown): value is string => typeof value === "string")
    : [];

  const emailFromSingle = typeof req.body?.email === "string" ? [req.body.email] : [];
  const emails = [...emailsFromArray, ...emailFromSingle];

  if (emails.length === 0) {
    res.status(400).json({ error: "At least one email must be provided" });
    return;
  }

  try {
    const invitations = await createInvitationsForUser({
      inviterUserId: authUser.id,
      emails,
    });

    res.status(201).json({ invitations });
  } catch (error) {
    if (error instanceof InvitationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to create invitations", detail: String(error) });
  }
});

invitationsRouter.delete("/:invitationId", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const invitation = await revokeInvitationForUser({
      inviterUserId: authUser.id,
      invitationId: req.params.invitationId,
    });

    res.status(200).json(invitation);
  } catch (error) {
    if (error instanceof InvitationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to revoke invitation", detail: String(error) });
  }
});
