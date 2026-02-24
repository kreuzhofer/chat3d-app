import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  activateSystemPrompt,
  getActiveSystemPrompt,
  listCategories,
  listPromptsForCategory,
  listSystemPrompts,
  seedFromFiles,
  WorkbenchSeederError,
} from "../services/workbench-seeder.service.js";
import { generateForPrompt } from "../services/workbench-codegen.service.js";

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

// ── System Prompts ────────────────────────────────────────────────────

workbenchRouter.get("/system-prompts", async (_req, res) => {
  try {
    const prompts = await listSystemPrompts();
    res.status(200).json(prompts);
  } catch (error) {
    res.status(500).json({ error: "Failed to list system prompts", detail: String(error) });
  }
});

workbenchRouter.get("/system-prompts/active", async (_req, res) => {
  try {
    const prompt = await getActiveSystemPrompt();
    res.status(200).json(prompt);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to get active system prompt", detail: String(error) });
  }
});

workbenchRouter.post("/system-prompts/:id/activate", async (req, res) => {
  try {
    await activateSystemPrompt(req.params.id);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to activate system prompt", detail: String(error) });
  }
});

// ── Generation ───────────────────────────────────────────────────────

workbenchRouter.post("/generate", async (req, res) => {
  try {
    const { promptId } = req.body as { promptId?: string };
    if (!promptId || typeof promptId !== "string") {
      res.status(400).json({ error: "promptId is required" });
      return;
    }
    const result = await generateForPrompt(promptId);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Generation failed", detail: String(error) });
  }
});
