import { useCallback, useEffect, useRef, useState } from "react";
import { useNotifications, type SseSubscriber } from "../contexts/NotificationsContext";

// ── Types ────────────────────────────────────────────────────────────────────

export type QueryState =
  | "queued"
  | "conversation"
  | "codegen"
  | "rendering"
  | "retrying"
  | "completed"
  | "failed";

export interface StreamTokenPayload {
  contextId: string;
  assistantItemId: string;
  token: string;
  done: boolean;
}

export interface QueryStatePayload {
  contextId: string;
  assistantItemId: string | null;
  state: QueryState;
  detail?: string | null;
}

export interface UseStreamingQueryOptions {
  /** JWT token for SSE authentication. Streaming is disabled when null. */
  token: string | null;
  /** The assistant item ID to filter events for. Streaming is disabled when null. */
  assistantItemId: string | null;
}

export interface UseStreamingQueryResult {
  /** Accumulated streaming text from stream-token events. */
  streamingText: string;
  /** Current query pipeline state. */
  queryState: QueryState | null;
  /** True while the streaming connection is active and not yet completed/failed. */
  isStreaming: boolean;
  /** Error message if the stream was interrupted or the query failed. */
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATES = new Set<QueryState>(["queued", "conversation", "codegen", "rendering", "retrying"]);

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Listens to SSE `stream-token` and `chat.query.state` events filtered by
 * `assistantItemId` via the shared SSE connection managed by NotificationsProvider.
 * No separate EventSource is created — this eliminates the race condition where
 * tokens could arrive before a second connection finishes its handshake.
 *
 * Validates: Requirements 1.2, 1.4, 1.5
 */
export function useStreamingQuery({
  token,
  assistantItemId,
}: UseStreamingQueryOptions): UseStreamingQueryResult {
  const [streamingText, setStreamingText] = useState("");
  const [queryState, setQueryState] = useState<QueryState | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { subscribe } = useNotifications();

  // Use refs to avoid stale closures in the subscriber callback
  const assistantItemIdRef = useRef(assistantItemId);
  assistantItemIdRef.current = assistantItemId;

  const handleMessage: SseSubscriber = useCallback((message) => {
    const currentId = assistantItemIdRef.current;
    if (!currentId) return;

    if (message.eventType === "stream-token") {
      const payload = message.payload as unknown as StreamTokenPayload;
      if (payload.assistantItemId !== currentId) return;

      if (payload.token) {
        setStreamingText((prev) => prev + payload.token);
      }
      // payload.done means conversation tokens finished, but pipeline may continue
      // isStreaming stays true until query-state reaches completed/failed
    } else if (message.eventType === "chat.query.state") {
      const payload = message.payload as unknown as QueryStatePayload;
      if (payload.assistantItemId !== currentId) return;

      const state = payload.state;
      setQueryState(state);

      if (state === "completed") {
        setIsStreaming(false);
      } else if (state === "failed") {
        setIsStreaming(false);
        setError(payload.detail ?? "Query failed");
      }
    }
  }, []);

  useEffect(() => {
    // Reset state when assistantItemId changes
    setStreamingText("");
    setQueryState(null);
    setIsStreaming(false);
    setError(null);

    if (!token || !assistantItemId) {
      return;
    }

    setIsStreaming(true);

    const unsubscribe = subscribe(handleMessage);
    return unsubscribe;
  }, [token, assistantItemId, subscribe, handleMessage]);

  return { streamingText, queryState, isStreaming, error };
}
