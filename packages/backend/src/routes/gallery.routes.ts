import { Router } from "express";
import { createLogger } from "../utils/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { remixGalleryModel, GalleryServiceError } from "../services/gallery.service.js";

const logger = createLogger("gallery-routes");

export const galleryRouter = Router();

// ── Remix (requires auth) ───────────────────────────────────────────

galleryRouter.post("/remix", requireAuth, async (req, res) => {
  try {
    const { exampleId } = req.body;
    if (typeof exampleId !== "string" || exampleId.trim().length === 0) {
      res.status(400).json({ error: "exampleId is required" });
      return;
    }

    const result = await remixGalleryModel({
      userId: req.authUser!.id,
      exampleId: exampleId.trim(),
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof GalleryServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "remix failed");
    res.status(500).json({ error: "Failed to remix model" });
  }
});
