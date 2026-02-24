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
  updatePromptText,
  WorkbenchSeederError,
} from "../services/workbench-seeder.service.js";
import { generateForPrompt } from "../services/workbench-codegen.service.js";
import {
  approveExample,
  deleteExample,
  deleteExamplesForCategory,
  deleteExamplesForPrompt,
  exportApprovedJsonl,
  getExample,
  getExportStats,
  listExamplesForPrompt,
  rejectExample,
  updateExampleCode,
} from "../services/workbench-examples.service.js";
import {
  backfillEmbeddings,
  getEmbeddingStatus,
} from "../services/workbench-embeddings.service.js";
import {
  cancelJob,
  getJobDetails,
  getJobStatus,
  getRunningJobForCategory,
  getRunningJobs,
  listJobs,
  startBatchJob,
} from "../services/workbench-batch.service.js";

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

workbenchRouter.patch("/prompts/:id", async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt (string) is required" });
      return;
    }
    await updatePromptText(req.params.id, prompt);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to update prompt", detail: String(error) });
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

// ── Examples ─────────────────────────────────────────────────────────

workbenchRouter.get("/prompts/:promptId/examples", async (req, res) => {
  try {
    const examples = await listExamplesForPrompt(req.params.promptId);
    res.status(200).json(examples);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to list examples", detail: String(error) });
  }
});

workbenchRouter.get("/examples/:id", async (req, res) => {
  try {
    const example = await getExample(req.params.id);
    res.status(200).json(example);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to get example", detail: String(error) });
  }
});

workbenchRouter.patch("/examples/:id/approve", async (req, res) => {
  try {
    await approveExample(req.params.id);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to approve example", detail: String(error) });
  }
});

workbenchRouter.patch("/examples/:id/reject", async (req, res) => {
  try {
    const { note } = req.body as { note?: string };
    await rejectExample(req.params.id, note);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to reject example", detail: String(error) });
  }
});

workbenchRouter.patch("/examples/:id/code", async (req, res) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "code is required" });
      return;
    }
    await updateExampleCode(req.params.id, code);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to update example code", detail: String(error) });
  }
});

workbenchRouter.post("/examples/:id/retry", async (req, res) => {
  try {
    // Look up the prompt_id for this example, then re-run generation
    const example = await getExample(req.params.id);
    const result = await generateForPrompt(example.promptId);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Retry failed", detail: String(error) });
  }
});

// ── Batch Generation ──────────────────────────────────────────────────

workbenchRouter.post("/generate/batch", async (req, res) => {
  try {
    const { categoryId, skipApproved } = req.body as {
      categoryId?: string;
      skipApproved?: boolean;
    };
    if (!categoryId || typeof categoryId !== "string") {
      res.status(400).json({ error: "categoryId is required" });
      return;
    }
    const job = await startBatchJob(categoryId, { skipApproved: skipApproved ?? true });
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 600) {
      res.status(statusCode).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    res.status(500).json({ error: "Batch generation failed", detail: String(error) });
  }
});

workbenchRouter.get("/jobs", async (_req, res) => {
  try {
    const allJobs = listJobs();
    res.status(200).json(allJobs);
  } catch (error) {
    res.status(500).json({ error: "Failed to list jobs", detail: String(error) });
  }
});

// Must be before /jobs/:jobId to avoid "running" being captured as a jobId param
workbenchRouter.get("/jobs/running", async (req, res) => {
  try {
    const categoryId = req.query.categoryId;
    if (categoryId && typeof categoryId === "string") {
      // Single category mode (used by category page)
      const job = getRunningJobForCategory(categoryId);
      res.status(200).json(job);
    } else {
      // All running jobs (used by overview page)
      const jobs = getRunningJobs();
      res.status(200).json(jobs);
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to check running jobs", detail: String(error) });
  }
});

workbenchRouter.get("/jobs/:jobId", async (req, res) => {
  try {
    const job = getJobStatus(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ error: "Failed to get job status", detail: String(error) });
  }
});

workbenchRouter.get("/jobs/:jobId/details", async (req, res) => {
  try {
    const job = getJobDetails(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ error: "Failed to get job details", detail: String(error) });
  }
});

workbenchRouter.post("/jobs/:jobId/cancel", async (req, res) => {
  try {
    const cancelled = cancelJob(req.params.jobId);
    if (!cancelled) {
      res.status(404).json({ error: "Job not found or not running" });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to cancel job", detail: String(error) });
  }
});

// ── Embeddings ──────────────────────────────────────────────────────

workbenchRouter.post("/embeddings/backfill", async (_req, res) => {
  try {
    console.log("[embeddings] backfill requested");
    const result = await backfillEmbeddings();
    console.log(`[embeddings] backfill complete: embedded=${result.embedded} skipped=${result.skipped}`);
    res.status(200).json(result);
  } catch (error) {
    console.error("[embeddings] backfill failed:", error);
    res.status(500).json({ error: "Embedding backfill failed", detail: String(error) });
  }
});

workbenchRouter.get("/embeddings/status", async (_req, res) => {
  try {
    const status = await getEmbeddingStatus();
    res.status(200).json(status);
  } catch (error) {
    res.status(500).json({ error: "Failed to get embedding status", detail: String(error) });
  }
});

// ── Delete Examples ─────────────────────────────────────────────────

workbenchRouter.delete("/examples/:id", async (req, res) => {
  try {
    await deleteExample(req.params.id);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to delete example", detail: String(error) });
  }
});

workbenchRouter.delete("/prompts/:promptId/examples", async (req, res) => {
  try {
    const result = await deleteExamplesForPrompt(req.params.promptId);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to delete examples", detail: String(error) });
  }
});

workbenchRouter.delete("/categories/:categoryId/examples", async (req, res) => {
  try {
    const result = await deleteExamplesForCategory(req.params.categoryId);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to delete category examples", detail: String(error) });
  }
});

// ── Export ────────────────────────────────────────────────────────────

workbenchRouter.get("/export/stats", async (_req, res) => {
  try {
    const stats = await getExportStats();
    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ error: "Failed to get export stats", detail: String(error) });
  }
});

workbenchRouter.get("/export/jsonl", async (_req, res) => {
  try {
    const jsonl = await exportApprovedJsonl();
    res.setHeader("Content-Type", "application/jsonl");
    res.setHeader("Content-Disposition", "attachment; filename=training-data.jsonl");
    res.status(200).send(jsonl);
  } catch (error) {
    if (error instanceof WorkbenchSeederError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});
