import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { notificationService } from "../services/notification.service.js";
import { sseService } from "../services/sse.service.js";

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error("Expected a numeric string");
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Expected a non-negative integer");
  }

  return parsed;
}

export const eventsRouter = Router();

eventsRouter.get("/stream", requireAuth, async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const lastEventId = parseOptionalPositiveInt(
      req.header("last-event-id") ??
        (typeof req.query.lastEventId === "string" ? req.query.lastEventId : undefined),
    );

    const replayEvents = await notificationService.listNotificationsForUser(user.id, {
      afterId: lastEventId,
      limit: 200,
    });

    sseService.connect({
      request: req,
      response: res,
      userId: user.id,
      replayEvents,
    });
  } catch (error) {
    res.status(400).json({ error: "Invalid stream request", detail: String(error) });
  }
});

eventsRouter.get("/replay", requireAuth, async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const afterId = parseOptionalPositiveInt(req.query.afterId);
    const limit = parseOptionalPositiveInt(req.query.limit);

    const notifications = await notificationService.listNotificationsForUser(user.id, {
      afterId,
      limit,
    });

    res.status(200).json({ notifications });
  } catch (error) {
    res.status(400).json({ error: "Invalid replay request", detail: String(error) });
  }
});
