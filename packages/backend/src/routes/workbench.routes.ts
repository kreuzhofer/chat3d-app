import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  listCategories,
  listPromptsForCategory,
  seedFromFiles,
  WorkbenchSeederError,
} from "../services/workbench-seeder.service.js";

export const workbenchRouter = Router();

workbenchRouter.use(requireAuth, requireRole("admin"));

// ── Categories ────────────────────────────────────────────────────────

workbenchRouter.get("/categories", async (_req, res) => {
  try {
    const categories = await listCategories();
    res.status(200).json(categories);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to list categories", detail: String(error) });
  }
});

workbenchRouter.get("/categories/:id/prompts", async (req, res) => {
  try {
    const prompts = await listPromptsForCategory(req.params.id);
    res.status(200).json(prompts);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to list prompts", detail: String(error) });
  }
});

// ── Seeding ───────────────────────────────────────────────────────────

workbenchRouter.post("/categories/seed", async (_req, res) => {
  try {
    const result = await seedFromFiles();
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Seeding failed", detail: String(error) });
  }
});
