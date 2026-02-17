import { useEffect, useMemo, useRef, useState } from "react";

export type SseConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

export interface SseMessage {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface UseSseOptions {
  token: string | null;
  enabled?: boolean;
  onMessage?: (message: SseMessage) => void;
}

const LAST_EVENT_ID_STORAGE_KEY = "chat3d.sse.last_event_id";
const SUPPORTED_EVENTS = [
  "chat.item.updated",
  "chat.query.state",
  "notification.created",
  "admin.settings.updated",
  "account.status.changed",
] as const;

function toQueryString(token: string, lastEventId: string | null): string {
  const params = new URLSearchParams({ token });
  if (lastEventId) {
    params.set("lastEventId", lastEventId);
  }
  return params.toString();
}

function getStoredLastEventId(): string | null {
  return localStorage.getItem(LAST_EVENT_ID_STORAGE_KEY);
}

function setStoredLastEventId(id: string | null) {
  if (!id) {
    return;
  }
  localStorage.setItem(LAST_EVENT_ID_STORAGE_KEY, id);
}

export function useSSE({ token, enabled = true, onMessage }: UseSseOptions) {
  const [state, setState] = useState<SseConnectionState>(enabled ? "connecting" : "idle");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !token) {
      setState(enabled ? "closed" : "idle");
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }

    setState("connecting");

    const url = `/api/events/stream?${toQueryString(token, getStoredLastEventId())}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    const onOpen = () => setState("open");
    const onError = () => setState("error");

    source.onopen = onOpen;
    source.onerror = onError;

    const onEvent = (event: MessageEvent) => {
      const eventId = event.lastEventId || null;
      setStoredLastEventId(eventId);

      try {
        const data = JSON.parse(event.data) as {
          notificationId: number;
          eventType: string;
          payload: Record<string, unknown>;
          createdAt: string;
        };

        onMessage?.({
          id: data.notificationId,
          eventType: data.eventType,
          payload: data.payload,
          createdAt: data.createdAt,
        });
      } catch {
        // Ignore malformed SSE payloads and keep stream active.
      }
    };

    for (const eventName of SUPPORTED_EVENTS) {
      source.addEventListener(eventName, onEvent as EventListener);
    }

    return () => {
      source.close();
      sourceRef.current = null;
      setState("closed");
    };
  }, [enabled, onMessage, token]);

  return useMemo(
    () => ({
      state,
      close: () => {
        sourceRef.current?.close();
        sourceRef.current = null;
        setState("closed");
      },
    }),
    [state],
  );
}
