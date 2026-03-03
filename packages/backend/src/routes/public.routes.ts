import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { isEmailConfirmationEnabled, isWaitlistEnabled } from "../services/app-settings.service.js";
import { isSetupRequired } from "../services/setup.service.js";
import { listTopRatedByCategory } from "../services/workbench-examples.service.js";
import { FileStorageError, readStorageFile } from "../services/file-storage.service.js";
import { verifyAuthToken, findUserById } from "../services/auth.service.js";
import {
  listGalleryCategories,
  listGalleryModels,
  getGalleryModel,
  searchGalleryModels,
  getModelPosition,
  GalleryServiceError,
} from "../services/gallery.service.js";

const logger = createLogger("public-routes");

export const publicRouter = Router();

publicRouter.get("/config", async (_req, res) => {
  try {
    const setupRequired = await isSetupRequired();
    const waitlistEnabled = setupRequired ? false : await isWaitlistEnabled();
    const emailConfirmationEnabled = setupRequired ? false : await isEmailConfirmationEnabled();
    res.status(200).json({ setupRequired, waitlistEnabled, emailConfirmationEnabled });
  } catch (error) {
    res.status(500).json({ error: "Failed to load public configuration", detail: String(error) });
  }
});

// ── Recent approved models (public, no auth) ────────────────────────

publicRouter.get("/recent-models", async (_req, res) => {
  try {
    const models = await listTopRatedByCategory(2, 20);
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

    const example = await prisma.workbenchExample.findFirst({
      where: {
        id,
        approvalStatus: { in: ["auto_approved", "human_approved"] },
        renderStatus: "success",
        screenshotIso: { not: null },
      },
      select: { screenshotIso: true },
    });

    if (!example || !example.screenshotIso) {
      res.status(404).json({ error: "Screenshot not found" });
      return;
    }

    const screenshotValue = example.screenshotIso;
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

// ── Gallery: categories ─────────────────────────────────────────────

publicRouter.get("/gallery/categories", async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 20;
    const result = await listGalleryCategories(page, pageSize);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(result);
  } catch (error) {
    logger.error({ err: error }, "failed to fetch gallery categories");
    res.status(500).json({ error: "Failed to load categories" });
  }
});

// ── Gallery: models in a category ───────────────────────────────────

publicRouter.get("/gallery/categories/:categoryId/models", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 20;
    const result = await listGalleryModels(categoryId, page, pageSize);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(result);
  } catch (error) {
    logger.error({ err: error }, "failed to fetch gallery models");
    res.status(500).json({ error: "Failed to load models" });
  }
});

// ── Gallery: single model detail ────────────────────────────────────

publicRouter.get("/gallery/models/:id", async (req, res) => {
  try {
    const model = await getGalleryModel(req.params.id);
    res.setHeader("Cache-Control", "public, max-age=600");
    res.status(200).json(model);
  } catch (error) {
    if (error instanceof GalleryServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "failed to fetch gallery model detail");
    res.status(500).json({ error: "Failed to load model" });
  }
});

// ── Gallery: model position (for deep-linking) ─────────────────────

publicRouter.get("/gallery/models/:id/position", async (req, res) => {
  try {
    const pageSize = Number(req.query.pageSize) || 20;
    const result = await getModelPosition(req.params.id, pageSize);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof GalleryServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "failed to get model position");
    res.status(500).json({ error: "Failed to get model position" });
  }
});

// ── Gallery: search ─────────────────────────────────────────────────

publicRouter.get("/gallery/search", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 3) {
      res.status(400).json({ error: "Search query must be at least 3 characters" });
      return;
    }
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 20;
    const result = await searchGalleryModels(q, page, pageSize);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json(result);
  } catch (error) {
    logger.error({ err: error }, "gallery search failed");
    res.status(503).json({ error: "Search is temporarily unavailable" });
  }
});

// ── Gallery: screenshot by model ID ─────────────────────────────────

const ALLOWED_SCREENSHOT_ANGLES = [
  "iso", "iso_back", "front", "back", "left", "right",
  "top", "bottom", "ortho_45", "ortho_45_bottom",
] as const;

type ScreenshotAngle = typeof ALLOWED_SCREENSHOT_ANGLES[number];

const ANGLE_TO_FIELD: Record<ScreenshotAngle, string> = {
  iso: "screenshotIso",
  iso_back: "screenshotIsoBack",
  front: "screenshotFront",
  back: "screenshotBack",
  left: "screenshotLeft",
  right: "screenshotRight",
  top: "screenshotTop",
  bottom: "screenshotBottom",
  ortho_45: "screenshotOrtho45",
  ortho_45_bottom: "screenshotOrtho45Bottom",
};

publicRouter.get("/gallery/models/:id/screenshot", async (req, res) => {
  try {
    const { id } = req.params;
    const example = await prisma.workbenchExample.findFirst({
      where: {
        id,
        approvalStatus: { in: ["auto_approved", "human_approved"] },
        renderStatus: "success",
        screenshotIso: { not: null },
      },
      select: { screenshotIso: true },
    });

    if (!example || !example.screenshotIso) {
      res.status(404).json({ error: "Screenshot not found" });
      return;
    }

    const value = example.screenshotIso;
    let buffer: Buffer;
    if (value.startsWith("workbench/")) {
      buffer = await readStorageFile({ relativePath: value });
    } else {
      buffer = Buffer.from(value, "base64");
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof FileStorageError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "failed to serve gallery screenshot");
    res.status(500).json({ error: "Failed to load screenshot" });
  }
});

publicRouter.get("/gallery/models/:id/screenshot/:angle", async (req, res) => {
  try {
    const { id, angle } = req.params;

    if (!ALLOWED_SCREENSHOT_ANGLES.includes(angle as ScreenshotAngle)) {
      res.status(400).json({ error: `Invalid angle. Allowed: ${ALLOWED_SCREENSHOT_ANGLES.join(", ")}` });
      return;
    }

    const fieldName = ANGLE_TO_FIELD[angle as ScreenshotAngle];
    const example = await prisma.workbenchExample.findFirst({
      where: {
        id,
        approvalStatus: { in: ["auto_approved", "human_approved"] },
        renderStatus: "success",
      },
      select: { [fieldName]: true },
    });

    const value = example?.[fieldName as keyof typeof example] as string | null;
    if (!example || !value) {
      res.status(404).json({ error: "Screenshot not found" });
      return;
    }

    let buffer: Buffer;
    if (value.startsWith("workbench/")) {
      buffer = await readStorageFile({ relativePath: value });
    } else {
      buffer = Buffer.from(value, "base64");
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof FileStorageError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "failed to serve gallery angle screenshot");
    res.status(500).json({ error: "Failed to load screenshot" });
  }
});

// ── Gallery: file downloads (tiered auth) ───────────────────────────

const FORMAT_FIELD_MAP: Record<string, string> = {
  stl: "stlPath",
  "3mf": "threemfPath",
  step: "stepPath",
};

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  stl: "application/vnd.ms-pki.stl",
  "3mf": "model/3mf",
  step: "application/step",
  b123d: "text/plain",
};

const AUTH_REQUIRED_FORMATS = new Set(["step", "b123d"]);

publicRouter.get("/gallery/models/:id/download/:format", async (req, res) => {
  try {
    const { id, format } = req.params;

    if (!["stl", "3mf", "step", "b123d"].includes(format)) {
      res.status(400).json({ error: "Invalid format. Allowed: stl, 3mf, step, b123d" });
      return;
    }

    // Auth check for protected formats
    if (AUTH_REQUIRED_FORMATS.has(format)) {
      const rawHeader = req.header("authorization");
      const token = rawHeader?.startsWith("Bearer ") ? rawHeader.slice(7) : null;
      if (!token) {
        res.status(401).json({ error: "Login required to download this file format" });
        return;
      }
      try {
        const claims = await verifyAuthToken(token);
        const user = await findUserById(claims.sub);
        if (!user || user.status !== "active") {
          res.status(401).json({ error: "Invalid or inactive account" });
          return;
        }
      } catch {
        res.status(401).json({ error: "Invalid authentication token" });
        return;
      }
    }

    // Fetch the approved example
    const example = await prisma.workbenchExample.findFirst({
      where: {
        id,
        approvalStatus: { in: ["auto_approved", "human_approved"] },
        renderStatus: "success",
      },
      include: { promptRef: true },
    });

    if (!example) {
      res.status(404).json({ error: "Model not found" });
      return;
    }

    // Resolve the file path
    let filePath: string | null = null;
    let filename: string;

    if (format === "b123d") {
      // b123d is the code field — serve as file
      if (!example.code?.trim()) {
        res.status(404).json({ error: "Source code not available for this model" });
        return;
      }
      const buffer = Buffer.from(example.code, "utf-8");
      filename = `${example.promptRef.prompt.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "_")}.b123d`;
      res.setHeader("Content-Type", FORMAT_CONTENT_TYPE[format]);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.status(200).send(buffer);
      return;
    }

    filePath = example[FORMAT_FIELD_MAP[format] as keyof typeof example] as string | null;
    if (!filePath) {
      res.status(404).json({ error: `${format.toUpperCase()} file not available for this model` });
      return;
    }

    const buffer = await readStorageFile({ relativePath: filePath });
    filename = `${example.promptRef.prompt.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "_")}.${format}`;
    res.setHeader("Content-Type", FORMAT_CONTENT_TYPE[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", AUTH_REQUIRED_FORMATS.has(format) ? "private, max-age=3600" : "public, max-age=3600");
    res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof FileStorageError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "failed to serve gallery download");
    res.status(500).json({ error: "Failed to download file" });
  }
});
