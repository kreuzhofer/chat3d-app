import { Router } from "express";
import { pool } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import { isWaitlistEnabled } from "../services/app-settings.service.js";
import { listRecentApprovedExamples } from "../services/workbench-examples.service.js";
import { FileStorageError, readStorageFile } from "../services/file-storage.service.js";

const logger = createLogger("public-routes");

export const publicRouter = Router();

publicRouter.get("/config", async (_req, res) => {
  try {
    const waitlistEnabled = await isWaitlistEnabled();
    res.status(200).json({ waitlistEnabled });
  } catch (error) {
    res.status(500).json({ error: "Failed to load public configuration", detail: String(error) });
  }
});

// ── Recent approved models (public, no auth) ────────────────────────

publicRouter.get("/recent-models", async (_req, res) => {
  try {
    const models = await listRecentApprovedExamples(20);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(models);
  } catch (error) {
    logger.error({ err: error }, "failed to fetch recent models");
    res.status(500).json({ error: "Failed to load recent models" });
  }
});

publicRouter.get("/recent-models/:id/screenshot", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query<{ screenshot_iso: string }>(
      `SELECT screenshot_iso FROM workbench_examples
       WHERE id = $1
         AND approval_status IN ('auto_approved', 'human_approved')
         AND render_status = 'success'
         AND screenshot_iso IS NOT NULL`,
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Screenshot not found" });
      return;
    }

    const screenshotValue = result.rows[0].screenshot_iso;
    let buffer: Buffer;
    if (screenshotValue.startsWith("workbench/")) {
      buffer = await readStorageFile({ relativePath: screenshotValue });
    } else {
      buffer = Buffer.from(screenshotValue, "base64");
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof FileStorageError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "failed to serve public screenshot");
    res.status(500).json({ error: "Failed to load screenshot" });
  }
});
