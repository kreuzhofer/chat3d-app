import { Router } from "express";
import { isWaitlistEnabled } from "../services/app-settings.service.js";

export const publicRouter = Router();

publicRouter.get("/config", async (_req, res) => {
  try {
    const waitlistEnabled = await isWaitlistEnabled();
    res.status(200).json({ waitlistEnabled });
  } catch (error) {
    res.status(500).json({ error: "Failed to load public configuration", detail: String(error) });
  }
});
