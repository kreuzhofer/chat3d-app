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
  "chat.context.renamed",
  "notification.created",
  "admin.settings.updated",
  "account.status.changed",
  "stream-token",
  "workbench.job.progress",
] as const;

/** Reconnect delays: 1s, 2s, 4s, 8s, 15s, 30s (capped). */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);
  // Stable refs so the connect function always sees current values
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    function cleanup() {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    }

    function connect() {
      const currentToken = tokenRef.current;
      if (!enabledRef.current || !currentToken) {
        setState(enabledRef.current ? "closed" : "idle");
        return;
      }

      setState("connecting");

      const url = `/api/events/stream?${toQueryString(currentToken, getStoredLastEventId())}`;
      const source = new EventSource(url);
      sourceRef.current = source;

      source.onopen = () => {
        setState("open");
        retriesRef.current = 0; // Reset backoff on successful connection
      };

      source.onerror = () => {
        // EventSource fires onerror for both transient disconnects and fatal
        // failures (e.g. HTTP 502). When readyState is CLOSED the browser will
        // NOT auto-reconnect, so we handle it ourselves with backoff.
        if (source.readyState === EventSource.CLOSED) {
          setState("error");
          cleanup();
          scheduleReconnect();
        } else {
          // CONNECTING — browser is auto-reconnecting
          setState("connecting");
        }
      };

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

          onMessageRef.current?.({
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
    }

    function scheduleReconnect() {
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** retriesRef.current, RECONNECT_MAX_MS);
      retriesRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    if (!enabled || !token) {
      cleanup();
      setState(enabled ? "closed" : "idle");
      return cleanup;
    }

    connect();
    return cleanup;
  }, [enabled, token]);

  return useMemo(
    () => ({
      state,
      close: () => {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        sourceRef.current?.close();
        sourceRef.current = null;
        setState("closed");
      },
    }),
    [state],
  );
}
