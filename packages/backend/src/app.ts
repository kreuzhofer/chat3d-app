import express, { type NextFunction, type Request, type Response } from "express";
import { query } from "./db/connection.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { eventsRouter } from "./routes/events.routes.js";
import { invitationsRouter } from "./routes/invitations.routes.js";
import { waitlistRouter } from "./routes/waitlist.routes.js";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "backend" });
  });

  app.get("/ready", async (_req, res) => {
    try {
      await query("SELECT 1");
      res.status(200).json({ status: "ready" });
    } catch (error) {
      res.status(503).json({ status: "not_ready", error: String(error) });
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/invitations", invitationsRouter);
  app.use("/api/waitlist", waitlistRouter);

  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "Internal server error", detail: String(error) });
  });

  return app;
}
