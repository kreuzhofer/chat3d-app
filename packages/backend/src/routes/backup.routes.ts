import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { createLogger } from "../utils/logger.js";
import { listBackups, getBackup, deleteBackup } from "../services/backup.service.js";

const logger = createLogger("backup-routes");

export const backupRouter = Router();
backupRouter.use(requireAuth, requireRole("admin"));

// GET /api/admin/backups — list all backups, optional ?type= filter
backupRouter.get("/", async (req, res) => {
  try {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const backups = await listBackups(type);
    res.json(backups);
  } catch (error) {
    logger.error({ err: error }, "failed to list backups");
    res.status(500).json({ error: "Failed to list backups" });
  }
});

// GET /api/admin/backups/:id/download — stream file
backupRouter.get("/:id/download", async (req, res) => {
  try {
    const backup = await getBackup(req.params.id);
    if (!backup) {
      res.status(404).json({ error: "Backup not found" });
      return;
    }

    // Verify file exists on disk
    try {
      await stat(backup.filePath);
    } catch {
      res.status(404).json({ error: "Backup file not found on disk" });
      return;
    }

    res.setHeader("Content-Disposition", `attachment; filename="${backup.fileName}"`);
    res.setHeader("Content-Type", "application/octet-stream");

    const stream = createReadStream(backup.filePath);
    stream.pipe(res);
    stream.on("error", (err) => {
      logger.error({ err, id: req.params.id }, "error streaming backup file");
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming file" });
      }
    });
  } catch (error) {
    logger.error({ err: error, id: req.params.id }, "failed to download backup");
    res.status(500).json({ error: "Failed to download backup" });
  }
});

// DELETE /api/admin/backups/:id — delete backup record + file
backupRouter.delete("/:id", async (req, res) => {
  try {
    const result = await deleteBackup(req.params.id);
    if (result === "not_found") {
      res.status(404).json({ error: "Backup not found" });
      return;
    }
    res.json({ status: "deleted" });
  } catch (error) {
    logger.error({ err: error, id: req.params.id }, "failed to delete backup");
    res.status(500).json({ error: "Failed to delete backup" });
  }
});
