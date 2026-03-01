/**
 * PushToggle Component
 * A bell icon button that toggles push notifications.
 * Shows filled bell when subscribed, bell-off when not.
 * Hidden entirely if browser doesn't support push.
 */

import { useState, useEffect } from "react";
import { Bell, BellOff } from "lucide-react";
import { isPushSupported, isPushSubscribed, subscribeToPush, unsubscribeFromPush } from "../../services/push";

export interface PushToggleProps {
  token: string | null;
}

export function PushToggle({ token }: PushToggleProps) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!isPushSupported()) return;
      setSupported(true);
      const sub = await isPushSubscribed();
      setSubscribed(sub);
    };
    void check();
  }, []);

  // Hide entirely if browser doesn't support push or no auth token
  if (!supported || !token) return null;

  const handleToggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush(token);
        setSubscribed(false);
      } else {
        const success = await subscribeToPush(token);
        setSubscribed(success);
      }
    } catch {
      // Silently ignore toggle errors
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleToggle()}
      disabled={busy}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
      title={subscribed ? "Disable push notifications" : "Enable push notifications"}
      aria-label={subscribed ? "Disable push notifications" : "Enable push notifications"}
    >
      {subscribed ? (
        <Bell className="h-3.5 w-3.5" />
      ) : (
        <BellOff className="h-3.5 w-3.5" />
      )}
      <span>{subscribed ? "Notifications on" : "Notifications off"}</span>
    </button>
  );
}
