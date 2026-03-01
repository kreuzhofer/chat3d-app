/**
 * Push Notification Service
 * Manages Web Push subscriptions and sends push notifications
 * for pipeline completion events.
 *
 * Push is inactive unless VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set.
 */

import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { query } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("push");

// ── Types ───────────────────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  tag: string; // prevents duplicate notifications (same tag replaces)
  url?: string; // URL to open on click
}

export interface SubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

// ── Service ─────────────────────────────────────────────────────────────────

class PushNotificationService {
  private initialized = false;

  /**
   * Check if push notifications are configured (VAPID keys present).
   */
  isEnabled(): boolean {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  /**
   * Get the VAPID public key (for frontend subscription).
   */
  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  /**
   * Initialize web-push with VAPID details (idempotent).
   */
  private ensureInitialized(): void {
    if (this.initialized || !this.isEnabled()) return;
    const subject = process.env.VAPID_SUBJECT || "mailto:admin@chat3d.local";
    webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    this.initialized = true;
  }

  /**
   * Save a push subscription for a user.
   * Upserts to handle re-subscriptions from the same browser.
   */
  async subscribe(userId: string, subscription: SubscriptionInput): Promise<void> {
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth],
    );
    logger.info({ userId }, "push subscription saved");
  }

  /**
   * Remove a push subscription for a user.
   * Returns true if a subscription was deleted, false if not found.
   */
  async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [userId, endpoint],
    );
    const removed = (result.rowCount ?? 0) > 0;
    if (removed) logger.info({ userId }, "push subscription removed");
    return removed;
  }

  /**
   * Get all push subscriptions for a user.
   */
  async getSubscriptions(userId: string): Promise<Array<{ endpoint: string }>> {
    const result = await query<PushSubscriptionRow>(
      `SELECT endpoint FROM push_subscriptions WHERE user_id = $1`,
      [userId],
    );
    return result.rows.map((row) => ({ endpoint: row.endpoint }));
  }

  /**
   * Send a push notification to all subscriptions for a user.
   * Silently removes subscriptions that return 404/410 (expired/unsubscribed).
   * Returns the number of notifications successfully sent.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    if (!this.isEnabled()) return 0;
    this.ensureInitialized();

    const result = await query<PushSubscriptionRow>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) return 0;

    let sent = 0;

    for (const sub of result.rows) {
      const pushSub: WebPushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };

      try {
        await webpush.sendNotification(pushSub, JSON.stringify(payload));
        sent++;
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or unsubscribed — clean up
          await query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
          logger.info({ subscriptionId: sub.id }, "removed expired push subscription");
        } else {
          logger.error({ err: error instanceof Error ? error : new Error(String(error)), subscriptionId: sub.id }, "push notification failed");
        }
      }
    }

    if (sent > 0) logger.info({ userId, sent, total: result.rows.length }, "push notifications sent");
    return sent;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

export const pushNotificationService = new PushNotificationService();
