import { Router } from "express";
import { query } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  approveWaitlistEntry,
  listWaitlistEntries,
  rejectWaitlistEntry,
  WaitlistError,
} from "../services/waitlist.service.js";

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "user";
  status: "active" | "deactivated" | "pending_registration";
  created_at: string;
}

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

adminRouter.get("/users", async (_req, res) => {
  const result = await query<AdminUserRow>(
    `
    SELECT id, email, display_name, role, status, created_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 100;
    `,
  );

  const users = result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  }));

  res.status(200).json({ users });
});

adminRouter.get("/waitlist", async (_req, res) => {
  const entries = await listWaitlistEntries(200);
  res.status(200).json({ entries });
});

adminRouter.post("/waitlist/:entryId/approve", async (req, res) => {
  const entryId = req.params.entryId;
  const authUser = req.authUser;

  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const result = await approveWaitlistEntry({
      waitlistEntryId: entryId,
      approvedByUserId: authUser.id,
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof WaitlistError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to approve waitlist entry", detail: String(error) });
  }
});

adminRouter.post("/waitlist/:entryId/reject", async (req, res) => {
  const entryId = req.params.entryId;
  const authUser = req.authUser;

  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const result = await rejectWaitlistEntry({
      waitlistEntryId: entryId,
      approvedByUserId: authUser.id,
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof WaitlistError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to reject waitlist entry", detail: String(error) });
  }
});
