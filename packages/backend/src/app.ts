import express, { type NextFunction, type Request, type Response } from "express";
import { prisma } from "./db/prisma.js";
import { createLogger } from "./utils/logger.js";
import { corsMiddleware } from "./middleware/cors.js";
import { languageDetection } from "./middleware/languageDetection.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { eventsRouter } from "./routes/events.routes.js";
import { filesRouter } from "./routes/files.routes.js";
import { invitationsRouter } from "./routes/invitations.routes.js";
import { llmRouter } from "./routes/llm.routes.js";
import { publicRouter } from "./routes/public.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { queryRouter } from "./routes/query.routes.js";
import { setupRouter } from "./routes/setup.routes.js";
import { waitlistRouter } from "./routes/waitlist.routes.js";
import { pushRouter } from "./routes/push.routes.js";
import { workbenchRouter } from "./routes/workbench.routes.js";
import { backupRouter } from "./routes/backup.routes.js";
import { galleryRouter } from "./routes/gallery.routes.js";
import { experimentRouter } from "./routes/experiment.routes.js";
import { vlmExperimentRouter } from "./routes/vlm-experiment.routes.js";
import { systemBackupRouter } from "./routes/system-backup.routes.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", true);
  app.use(corsMiddleware);
  app.use(securityHeaders);
  app.use(express.json({ limit: "50mb" }));
  app.use(languageDetection);
  app.use(rateLimitMiddleware);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "backend" });
  });

  app.get("/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: "ready" });
    } catch (error) {
      res.status(503).json({ status: "not_ready", error: String(error) });
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/files", filesRouter);
  app.use("/api/invitations", invitationsRouter);
  app.use("/api/llm", llmRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/push", pushRouter);
  app.use("/api/setup", setupRouter);
  app.use("/api/query", queryRouter);
  app.use("/api/waitlist", waitlistRouter);
  app.use("/api/admin/workbench", workbenchRouter);
  app.use("/api/admin/backups", backupRouter);
  app.use("/api/gallery", galleryRouter);
  app.use("/api/admin/experiments", experimentRouter);
  app.use("/api/admin/vlm-experiments", vlmExperimentRouter);
  app.use("/api/admin/system-backup", systemBackupRouter);

  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  const appLogger = createLogger("app");
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    appLogger.error({ err: error, method: req.method, path: req.path }, "unhandled route error");
    res.status(500).json({ error: "Internal server error", detail: String(error) });
  });

  return app;
}
