/**
 * Push Notification Routes
 * Endpoints for managing Web Push subscriptions.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { pushNotificationService } from "../services/push-notification.service.js";

export const pushRouter = Router();

pushRouter.use(requireAuth);

/**
 * GET /api/push/vapid-key
 * Returns the VAPID public key needed by the browser to subscribe.
 * Returns 404 if push is not configured.
 */
pushRouter.get("/vapid-key", (_req, res) => {
  const publicKey = pushNotificationService.getPublicKey();
  if (!publicKey) {
    res.status(404).json({ error: { code: "NOT_CONFIGURED", message: "Push notifications are not configured." } });
    return;
  }
  res.json({ publicKey });
});

/**
 * POST /api/push/subscribe
 * Register a push subscription for the authenticated user.
 * Body: { endpoint, keys: { p256dh, auth } }
 */
pushRouter.post("/subscribe", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { endpoint, keys } = req.body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "endpoint, keys.p256dh, and keys.auth are required." },
    });
    return;
  }

  if (!pushNotificationService.isEnabled()) {
    res.status(404).json({ error: { code: "NOT_CONFIGURED", message: "Push notifications are not configured." } });
    return;
  }

  await pushNotificationService.subscribe(authUser.id, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  res.status(201).json({ subscribed: true });
});

/**
 * POST /api/push/unsubscribe
 * Remove a push subscription for the authenticated user.
 * Body: { endpoint }
 */
pushRouter.post("/unsubscribe", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { endpoint } = req.body as { endpoint?: string };

  if (!endpoint) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "endpoint is required." } });
    return;
  }

  const removed = await pushNotificationService.unsubscribe(authUser.id, endpoint);
  res.json({ removed });
});

/**
 * GET /api/push/status
 * Returns whether push is configured and the user's active subscription count.
 */
pushRouter.get("/status", async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!pushNotificationService.isEnabled()) {
    res.json({ enabled: false, subscriptionCount: 0 });
    return;
  }

  const subscriptions = await pushNotificationService.getSubscriptions(authUser.id);
  res.json({ enabled: true, subscriptionCount: subscriptions.length });
});
