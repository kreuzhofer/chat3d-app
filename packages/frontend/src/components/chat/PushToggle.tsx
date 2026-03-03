/**
 * PushToggle Component
 * A bell icon button that toggles push notifications.
 * Shows filled bell when subscribed, bell-off when not.
 * Always tappable — shows a message when push is not supported.
 */

import { useState, useEffect } from "react";
import { Bell, BellOff } from "lucide-react";
import { isPushSupported, isPushSubscribed, subscribeToPush, unsubscribeFromPush } from "../../services/push";

export interface PushToggleProps {
  token: string | null;
  /** Optional external subscription state — when changed (e.g. via inline pill), syncs the toggle. */
  externalSubscribed?: boolean;
}

export function PushToggle({ token, externalSubscribed }: PushToggleProps) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      if (!isPushSupported()) return;
      setSupported(true);
      const sub = await isPushSubscribed();
      setSubscribed(sub);
    };
    void check();
  }, []);

  // Sync with external subscription changes (e.g. inline notification pill)
  useEffect(() => {
    if (externalSubscribed !== undefined) {
      setSubscribed(externalSubscribed);
    }
  }, [externalSubscribed]);

  if (!token) return null;

  const handleToggle = async () => {
    if (busy) return;

    if (!supported) {
      setHint("Notifications are not supported in this browser. Try adding the app to your Home Screen first.");
      return;
    }

    setHint(null);
    setBusy(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush(token);
        setSubscribed(false);
      } else {
        const success = await subscribeToPush(token);
        if (success) {
          setSubscribed(true);
        } else {
          setHint("Could not enable notifications. Check your browser permissions.");
        }
      }
    } catch {
      setHint("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const label = subscribed ? "Notifications on" : "Notifications off";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleToggle()}
        disabled={busy}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] transition active:scale-95 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
        title={subscribed ? "Disable push notifications" : "Enable push notifications"}
        aria-label={subscribed ? "Disable push notifications" : "Enable push notifications"}
      >
        {subscribed ? (
          <Bell className="h-3.5 w-3.5" />
        ) : (
          <BellOff className="h-3.5 w-3.5" />
        )}
        <span>{label}</span>
      </button>
      {hint ? (
        <p className="max-w-[240px] rounded border border-[hsl(var(--warning)_/_0.3)] bg-[hsl(var(--warning)_/_0.08)] px-2 py-1 text-[10px] leading-tight text-[hsl(var(--warning))]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
