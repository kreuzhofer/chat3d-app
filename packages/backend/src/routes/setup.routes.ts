import { Router } from "express";
import { completeInitialSetup } from "../services/setup.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("setup-routes");

export const setupRouter = Router();

setupRouter.post("/init", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName : undefined;

  try {
    const result = await completeInitialSetup({ email, password, displayName });
    res.status(201).json(result);
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode) {
      res.status(statusCode).json({ error: (error as Error).message });
      return;
    }
    logger.error({ err: error }, "initial setup failed");
    res.status(500).json({ error: req.t("errors:setup.failed"), detail: String(error) });
  }
});
