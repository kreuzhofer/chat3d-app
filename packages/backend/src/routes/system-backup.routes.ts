import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import {
  startSystemExport,
  startSystemRestore,
  getSystemBackupJob,
  listSystemBackupJobs,
} from "../services/system-backup.service.js";

const logger = createLogger("system-backup-routes");

export const systemBackupRouter = Router();
systemBackupRouter.use(requireAuth, requireRole("admin"));

const restoreUpload = multer({
  dest: path.join(config.storage.rootDir, "system-backups"),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
});

// POST /api/admin/system-backup/export — start a full system export job
systemBackupRouter.post("/export", async (_req, res) => {
  try {
    const job = startSystemExport();
    res.status(202).json(job);
  } catch (error) {
    logger.error({ err: error }, "failed to start system export");
    res.status(500).json({ error: "Failed to start system export" });
  }
});

// GET /api/admin/system-backup/jobs — list all system backup jobs
systemBackupRouter.get("/jobs", async (_req, res) => {
  try {
    const jobs = listSystemBackupJobs();
    res.status(200).json(jobs);
  } catch (error) {
    logger.error({ err: error }, "failed to list system backup jobs");
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

// GET /api/admin/system-backup/jobs/:jobId — get job status
systemBackupRouter.get("/jobs/:jobId", async (req, res) => {
  try {
    const job = getSystemBackupJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.status(200).json(job);
  } catch (error) {
    logger.error({ err: error, jobId: req.params.jobId }, "failed to get job");
    res.status(500).json({ error: "Failed to get job" });
  }
});

// POST /api/admin/system-backup/restore — upload archive + start restore
systemBackupRouter.post("/restore", restoreUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }
    const job = startSystemRestore(req.file.path);
    res.status(202).json(job);
  } catch (error) {
    logger.error({ err: error }, "failed to start system restore");
    res.status(500).json({ error: "Failed to start system restore" });
  }
});
