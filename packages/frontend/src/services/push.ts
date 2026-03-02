/**
 * Push notification subscription management.
 * Handles service worker registration, permission requests,
 * and push subscription lifecycle.
 */

/**
 * Check if Web Push is supported in this browser.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Get the VAPID public key from the backend.
 * Returns null if push is not configured on the server.
 */
async function getVapidKey(token: string): Promise<string | null> {
  try {
    const response = await fetch("/api/push/vapid-key", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.publicKey || null;
  } catch {
    return null;
  }
}

/**
 * Convert a base64url string to a Uint8Array (for applicationServerKey).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

/**
 * Register the service worker and subscribe to push notifications.
 * Returns true if subscription succeeded, false otherwise.
 */
export async function subscribeToPush(token: string): Promise<boolean> {
  if (!isPushSupported()) return false;

  // 1. Request notification permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  // 2. Get VAPID key from server
  const vapidKey = await getVapidKey(token);
  if (!vapidKey) return false;

  // 3. Register service worker
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  // 4. Subscribe to push
  const applicationServerKey = urlBase64ToUint8Array(vapidKey);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
  });

  // 5. Send subscription to backend
  const subJson = subscription.toJSON();
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
    }),
  });

  return response.ok;
}

/**
 * Unsubscribe from push notifications.
 * Returns true if unsubscription succeeded.
 */
export async function unsubscribeFromPush(token: string): Promise<boolean> {
  if (!isPushSupported()) return false;

  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!registration) return false;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  // Unsubscribe locally
  await subscription.unsubscribe();

  // Tell backend to remove subscription
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });

  return true;
}

/**
 * Get the current browser notification permission state.
 * Returns "unsupported" if push is not available in this browser.
 */
export function getNotificationPermission(): "granted" | "denied" | "default" | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Check if user currently has an active push subscription.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!registration) return false;

  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}
