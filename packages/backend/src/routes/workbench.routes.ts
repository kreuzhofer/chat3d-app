import { Router } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { FileStorageError, readStorageFile } from "../services/file-storage.service.js";
import {
  createCategory,
  createPrompts,
  deleteCategory,
  deletePrompt,
  listCategories,
  listPromptsForCategory,
  updateCategory,
  updatePromptText,
  WorkbenchCatalogError,
} from "../services/workbench-catalog.service.js";
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
  backfillDetectedOperations,
  getEmbeddingStatus,
} from "../services/workbench-embeddings.service.js";
import {
  setFeaturedExample,
  clearFeaturedExample,
  GalleryServiceError,
} from "../services/gallery.service.js";
import {
  cancelJob,
  getActiveJobForPrompt,
  getAllRunningJobsForCategory,
  getJobDetails,
  getJobStatus,
  getRunningJobs,
  listJobs,
  startBatchCleanup,
  startBatchJob,
  startBatchReRender,
  startSingleJob,
} from "../services/workbench-batch.service.js";
import {
  deleteTransferJob,
  getExportFilePath,
  getTransferJob,
  listTransferJobs,
  startExport,
  startImport,
} from "../services/workbench-data-transfer.service.js";
import { improvePrompt } from "../services/workbench-prompt-improve.service.js";
import {
  assembleChunks,
  deleteUpload,
  getUploadStatus,
  initUpload,
  receiveChunk,
} from "../services/chunked-upload.service.js";
import { prisma } from "../db/prisma.js";
import express from "express";
import { getTraceRecordForWorkbenchExample } from "../services/trace-persistence.service.js";

const logger = createLogger("workbench-routes");

function parseJsonbArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      // ignore
    }
  }
  return [];
}

export const workbenchRouter = Router();

workbenchRouter.use(requireAuth, requireRole("admin"));

// ── Categories ────────────────────────────────────────────────────────

workbenchRouter.get("/categories", async (_req, res) => {
  try {
    const categories = await listCategories();
    res.status(200).json(categories);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to list categories", detail: String(error) });
  }
});

workbenchRouter.post("/categories", async (req, res) => {
  try {
    const { name, rank, complexity, description } = req.body as {
      name?: string; rank?: number; complexity?: number; description?: string;
    };
    if (!name || rank == null || complexity == null || !description) {
      res.status(400).json({ error: "name, rank, complexity, and description are required" });
      return;
    }
    const cat = await createCategory({ name, rank, complexity, description });
    res.status(201).json(cat);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to create category", detail: String(error) });
  }
});

workbenchRouter.patch("/categories/:id", async (req, res) => {
  try {
    const { name, rank, complexity, description } = req.body as {
      name?: string; rank?: number; complexity?: number; description?: string;
    };
    await updateCategory(req.params.id, { name, rank, complexity, description });
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to update category", detail: String(error) });
  }
});

workbenchRouter.delete("/categories/:id", async (req, res) => {
  try {
    const result = await deleteCategory(req.params.id);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to delete category", detail: String(error) });
  }
});

workbenchRouter.get("/categories/:id/prompts", async (req, res) => {
  try {
    const prompts = await listPromptsForCategory(req.params.id);
    res.status(200).json(prompts);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to list prompts", detail: String(error) });
  }
});

workbenchRouter.post("/categories/:id/prompts", async (req, res) => {
  try {
    const { prompts } = req.body as { prompts?: string[] };
    if (!Array.isArray(prompts) || prompts.length === 0) {
      res.status(400).json({ error: "prompts (non-empty string array) is required" });
      return;
    }
    if (prompts.some((p) => typeof p !== "string" || !p.trim())) {
      res.status(400).json({ error: "All prompts must be non-empty strings" });
      return;
    }
    const created = await createPrompts(req.params.id, prompts);
    res.status(201).json({ created });
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to create prompts", detail: String(error) });
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
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to update prompt", detail: String(error) });
  }
});

workbenchRouter.delete("/prompts/:id", async (req, res) => {
  try {
    await deletePrompt(req.params.id);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to delete prompt", detail: String(error) });
  }
});

// ── Prompt Improvement ───────────────────────────────────────────────

workbenchRouter.post("/prompts/:id/improve", async (req, res) => {
  try {
    const promptId = req.params.id;

    // Look up prompt text
    const prompt = await prisma.workbenchExamplePrompt.findUnique({
      where: { id: promptId },
      select: { prompt: true },
    });
    if (!prompt) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }
    const promptText = prompt.prompt;

    // Find best evaluated example for this prompt
    const example = await prisma.workbenchExample.findFirst({
      where: {
        promptId,
        renderStatus: "success",
        evalScore: { not: null },
      },
      select: { code: true, evalIssues: true, evalSuggestions: true },
      orderBy: [{ evalScore: "desc" }, { createdAt: "desc" }],
    });
    const evalIssues = parseJsonbArray(example?.evalIssues);
    const evalSuggestions = parseJsonbArray(example?.evalSuggestions);
    const code = example?.code ?? "";

    const result = await improvePrompt({
      promptText,
      evalIssues,
      evalSuggestions,
      code,
    });

    res.status(200).json({ variations: result.variations });
  } catch (error) {
    logger.error({ err: error }, "Failed to generate prompt improvements");
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to generate prompt improvements", detail: String(error) });
  }
});

// ── Generation (async — fire-and-forget with polling) ────────────────

workbenchRouter.post("/generate", async (req, res) => {
  try {
    const { promptId } = req.body as { promptId?: string };
    if (!promptId || typeof promptId !== "string") {
      res.status(400).json({ error: "promptId is required" });
      return;
    }
    const job = await startSingleJob(promptId, "generate", undefined, req.authUser!.id);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Generation failed", detail: String(error) });
  }
});

workbenchRouter.get("/generate/jobs/:jobId", async (req, res) => {
  try {
    // Unified: all jobs (batch and single) are in the same store
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

// ── Examples ─────────────────────────────────────────────────────────

workbenchRouter.get("/prompts/:promptId/examples", async (req, res) => {
  try {
    const examples = await listExamplesForPrompt(req.params.promptId);
    res.status(200).json(examples);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
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
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to get example", detail: String(error) });
  }
});

workbenchRouter.get("/examples/:id/screenshot/:angle", async (req, res) => {
  try {
    const { id, angle } = req.params;
    const validAngles = ["front", "back", "left", "right", "top", "bottom", "ortho_45", "ortho_45_bottom", "iso", "iso_back"];
    if (!validAngles.includes(angle)) {
      res.status(400).json({ error: `angle must be one of: ${validAngles.join(", ")}` });
      return;
    }
    const example = await getExample(id);
    const columnMap: Record<string, keyof typeof example> = {
      front: "screenshotFront",
      back: "screenshotBack",
      left: "screenshotLeft",
      right: "screenshotRight",
      top: "screenshotTop",
      bottom: "screenshotBottom",
      ortho_45: "screenshotOrtho45",
      ortho_45_bottom: "screenshotOrtho45Bottom",
      iso: "screenshotIso",
      iso_back: "screenshotIsoBack",
    };
    const column = columnMap[angle] ?? "screenshotFront";
    const screenshotValue = example[column as keyof typeof example] as string | null;
    if (!screenshotValue) {
      res.status(404).json({ error: "No screenshot available" });
      return;
    }

    // Column may contain a file path (new format) or base64 (legacy pre-migration)
    let buffer: Buffer;
    if (screenshotValue.startsWith("workbench/")) {
      // File path — read from storage
      buffer = await readStorageFile({ relativePath: screenshotValue });
    } else {
      // Legacy base64 (pre-migration data)
      buffer = Buffer.from(screenshotValue, "base64");
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof FileStorageError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to get screenshot", detail: String(error) });
  }
});

// ── Trace ──────────────────────────────────────────────────────────

workbenchRouter.get("/examples/:id/trace", async (req, res) => {
  try {
    const trace = await getTraceRecordForWorkbenchExample(req.params.id);
    if (!trace) {
      res.status(404).json({ error: "No trace found for this example" });
      return;
    }
    res.status(200).json(trace);
  } catch (error) {
    res.status(500).json({ error: "Failed to get trace", detail: String(error) });
  }
});

workbenchRouter.patch("/examples/:id/approve", async (req, res) => {
  try {
    await approveExample(req.params.id);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
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
    if (error instanceof WorkbenchCatalogError) {
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
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Failed to update example code", detail: String(error) });
  }
});

workbenchRouter.post("/examples/:id/retry", async (req, res) => {
  try {
    const example = await getExample(req.params.id);
    const job = await startSingleJob(example.promptId, "retry", undefined, req.authUser!.id);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Retry failed", detail: String(error) });
  }
});

workbenchRouter.post("/examples/:id/re-render", async (req, res) => {
  try {
    const example = await getExample(req.params.id);
    const job = await startSingleJob(example.promptId, "re-render", req.params.id, req.authUser!.id);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Re-render failed", detail: String(error) });
  }
});

// ── Batch Generation ──────────────────────────────────────────────────

workbenchRouter.post("/generate/batch", async (req, res) => {
  try {
    const { categoryId, skipApproved, onlyMissing } = req.body as {
      categoryId?: string;
      skipApproved?: boolean;
      onlyMissing?: boolean;
    };
    if (!categoryId || typeof categoryId !== "string") {
      res.status(400).json({ error: "categoryId is required" });
      return;
    }
    const job = await startBatchJob(categoryId, { skipApproved: skipApproved ?? true, onlyMissing }, req.authUser!.id);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
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

workbenchRouter.post("/re-render/batch", async (req, res) => {
  try {
    const { categoryId } = req.body as { categoryId?: string };
    if (!categoryId || typeof categoryId !== "string") {
      res.status(400).json({ error: "categoryId is required" });
      return;
    }
    const job = await startBatchReRender(categoryId);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 600) {
      res.status(statusCode).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    res.status(500).json({ error: "Batch re-render failed", detail: String(error) });
  }
});

workbenchRouter.post("/cleanup/batch", async (req, res) => {
  try {
    const { categoryId } = req.body as { categoryId?: string };
    if (!categoryId || typeof categoryId !== "string") {
      res.status(400).json({ error: "categoryId is required" });
      return;
    }
    const job = await startBatchCleanup(categoryId);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 600) {
      res.status(statusCode).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    logger.error({ err: error }, "batch cleanup failed");
    res.status(500).json({ error: "Batch cleanup failed", detail: String(error) });
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
    const promptId = req.query.promptId;

    if (promptId && typeof promptId === "string") {
      // Single prompt mode — find any running job involving this prompt
      const job = getActiveJobForPrompt(promptId);
      res.status(200).json(job);
    } else if (categoryId && typeof categoryId === "string") {
      // Category mode — return ALL running jobs (batch + single-prompt)
      // so the category page can reconnect to jobs started from the prompt detail page
      const categoryJobs = getAllRunningJobsForCategory(categoryId);
      res.status(200).json(categoryJobs);
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
    logger.info("backfill requested");
    const result = await backfillEmbeddings();
    logger.info("backfill complete: embedded=%d skipped=%d", result.embedded, result.skipped);
    res.status(200).json(result);
  } catch (error) {
    logger.error({ err: error }, "backfill failed");
    res.status(500).json({ error: "Embedding backfill failed", detail: String(error) });
  }
});

workbenchRouter.post("/operations/backfill", async (_req, res) => {
  try {
    logger.info("operations backfill requested");
    const result = await backfillDetectedOperations();
    logger.info({ updated: result.updated }, "operations backfill complete");
    res.status(200).json(result);
  } catch (error) {
    logger.error({ err: error }, "operations backfill failed");
    res.status(500).json({ error: "Operations backfill failed", detail: String(error) });
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
    if (error instanceof WorkbenchCatalogError) {
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
    if (error instanceof WorkbenchCatalogError) {
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
    if (error instanceof WorkbenchCatalogError) {
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
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});

// ── Data Transfer (Full Export / Import) ─────────────────────────────

const importUpload = multer({
  dest: path.join(config.storage.rootDir, "workbench-exports"),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

workbenchRouter.post("/export/full", async (_req, res) => {
  try {
    const job = startExport();
    res.status(202).json(job);
  } catch (error) {
    res.status(500).json({ error: "Failed to start export", detail: String(error) });
  }
});

workbenchRouter.post("/import/full", importUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }
    const job = startImport(req.file.path);
    res.status(202).json(job);
  } catch (error) {
    res.status(500).json({ error: "Failed to start import", detail: String(error) });
  }
});

workbenchRouter.get("/transfer-jobs", async (_req, res) => {
  try {
    const jobs = listTransferJobs();
    res.status(200).json(jobs);
  } catch (error) {
    res.status(500).json({ error: "Failed to list transfer jobs", detail: String(error) });
  }
});

workbenchRouter.get("/transfer-jobs/:jobId", async (req, res) => {
  try {
    const job = getTransferJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Transfer job not found" });
      return;
    }
    res.status(200).json(job);
  } catch (error) {
    res.status(500).json({ error: "Failed to get transfer job", detail: String(error) });
  }
});

workbenchRouter.get("/transfer-jobs/:jobId/download", async (req, res) => {
  try {
    const filePath = getExportFilePath(req.params.jobId);
    if (!filePath) {
      res.status(404).json({ error: "Export file not found or job not completed" });
      return;
    }
    const fileStat = await stat(filePath);
    const fileName = path.basename(filePath);
    const contentType = fileName.endsWith(".zip") ? "application/zip" : "application/json";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", fileStat.size);
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.status(500).json({ error: "Failed to download export", detail: String(error) });
  }
});

workbenchRouter.delete("/transfer-jobs/:jobId", async (req, res) => {
  try {
    const result = await deleteTransferJob(req.params.jobId);
    switch (result) {
      case "deleted":
        res.status(200).json({ ok: true });
        return;
      case "not_found":
        res.status(404).json({ error: "Transfer job not found" });
        return;
      case "still_running":
        res.status(409).json({ error: "Cannot delete a running job" });
        return;
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to delete transfer job", detail: String(error) });
  }
});

// ── Chunked Upload Import ────────────────────────────────────────────

workbenchRouter.post("/import/upload/init", async (req, res) => {
  try {
    const { fileName, fileSize, chunkSize } = req.body as {
      fileName?: string;
      fileSize?: number;
      chunkSize?: number;
    };
    if (!fileName || typeof fileName !== "string") {
      res.status(400).json({ error: "fileName is required" });
      return;
    }
    if (!fileSize || typeof fileSize !== "number" || fileSize <= 0) {
      res.status(400).json({ error: "fileSize must be a positive number" });
      return;
    }

    const result = await initUpload(fileName, fileSize, chunkSize);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to init upload", detail: String(error) });
  }
});

workbenchRouter.put(
  "/import/upload/:uploadId/chunk/:index",
  express.raw({ type: "application/octet-stream", limit: "25mb" }),
  async (req, res) => {
    try {
      const { uploadId, index } = req.params;
      const chunkIndex = parseInt(index, 10);
      if (isNaN(chunkIndex)) {
        res.status(400).json({ error: "chunk index must be a number" });
        return;
      }

      const data = req.body as Buffer;
      if (!Buffer.isBuffer(data) || data.length === 0) {
        res.status(400).json({ error: "chunk data is required (application/octet-stream)" });
        return;
      }

      const result = await receiveChunk(uploadId, chunkIndex, data);
      res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: message });
    }
  },
);

workbenchRouter.get("/import/upload/:uploadId/status", async (req, res) => {
  try {
    const status = getUploadStatus(req.params.uploadId);
    if (!status) {
      res.status(404).json({ error: "Upload session not found" });
      return;
    }
    res.status(200).json(status);
  } catch (error) {
    res.status(500).json({ error: "Failed to get upload status", detail: String(error) });
  }
});

workbenchRouter.post("/import/upload/:uploadId/complete", async (req, res) => {
  try {
    const assembledPath = await assembleChunks(req.params.uploadId);
    const job = startImport(assembledPath);
    res.status(202).json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not found") ? 404
      : message.includes("Missing chunk") ? 400
      : 500;
    res.status(status).json({ error: message });
  }
});

// ── Featured model management ───────────────────────────────────────

workbenchRouter.patch("/examples/:id/feature", async (req, res) => {
  try {
    await setFeaturedExample(req.params.id);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof GalleryServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "failed to set featured example");
    res.status(500).json({ error: "Failed to set featured example" });
  }
});

workbenchRouter.delete("/examples/:id/feature", async (req, res) => {
  try {
    // Find the example's category to clear featured flag
    const example = await prisma.workbenchExample.findUnique({
      where: { id: req.params.id },
      include: { promptRef: true },
    });
    if (!example) {
      res.status(404).json({ error: "Example not found" });
      return;
    }
    await clearFeaturedExample(example.promptRef.categoryId);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof GalleryServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "failed to clear featured example");
    res.status(500).json({ error: "Failed to clear featured example" });
  }
});
