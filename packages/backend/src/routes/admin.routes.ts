import { Router } from "express";
import { query } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

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
