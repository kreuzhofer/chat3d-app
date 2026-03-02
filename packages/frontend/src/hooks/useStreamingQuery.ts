import { useCallback, useEffect, useRef, useState } from "react";
import { useNotifications, type SseSubscriber } from "../contexts/NotificationsContext";

// ── Types ────────────────────────────────────────────────────────────────────

export type QueryState =
  | "queued"
  | "conversation"
  | "codegen"
  | "rendering"
  | "evaluating"
  | "fixing"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

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
  /** ISO timestamp of when the pipeline started (item createdAt). Used to compute
   *  elapsed time so `isLongRunning` fires correctly after a page reload. */
  startedAt?: string | null;
}

export interface UseStreamingQueryResult {
  /** Accumulated streaming text from stream-token events. */
  streamingText: string;
  /** Current query pipeline state. */
  queryState: QueryState | null;
  /** Detail message from the backend for the current state (e.g. "Improving model (attempt 2/5, score: 3/10)..."). */
  queryStateDetail: string | null;
  /** True while the streaming connection is active and not yet completed/failed. */
  isStreaming: boolean;
  /** True when the pipeline has been running for more than 60 seconds. */
  isLongRunning: boolean;
  /** Error message if the stream was interrupted or the query failed. */
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATES = new Set<QueryState>(["queued", "conversation", "codegen", "rendering", "evaluating", "fixing", "retrying"]);

/** Threshold in ms after which the pipeline is considered "long-running". */
const LONG_RUNNING_THRESHOLD_MS = 10_000;

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
  startedAt,
}: UseStreamingQueryOptions): UseStreamingQueryResult {
  const [streamingText, setStreamingText] = useState("");
  const [queryState, setQueryState] = useState<QueryState | null>(null);
  const [queryStateDetail, setQueryStateDetail] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLongRunning, setIsLongRunning] = useState(false);
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
      setQueryStateDetail(payload.detail ?? null);

      if (state === "completed" || state === "cancelled") {
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
    setQueryStateDetail(null);
    setIsStreaming(false);
    setIsLongRunning(false);
    setError(null);

    if (!token || !assistantItemId) {
      return;
    }

    setIsStreaming(true);

    const unsubscribe = subscribe(handleMessage);
    return unsubscribe;
  }, [token, assistantItemId, subscribe, handleMessage]);

  // Track long-running pipelines: set isLongRunning after 60s since pipeline start.
  // Uses startedAt (item createdAt) so the timer survives page reloads — if the
  // pipeline has already been running for >60s, isLongRunning fires immediately.
  useEffect(() => {
    if (!isStreaming) {
      setIsLongRunning(false);
      return;
    }
    const elapsed = startedAt ? Date.now() - Date.parse(startedAt) : 0;
    if (elapsed >= LONG_RUNNING_THRESHOLD_MS) {
      setIsLongRunning(true);
      return; // no timer needed — already past threshold
    }
    const remaining = LONG_RUNNING_THRESHOLD_MS - elapsed;
    const timer = setTimeout(() => setIsLongRunning(true), remaining);
    return () => clearTimeout(timer);
  }, [isStreaming, startedAt]);

  return { streamingText, queryState, queryStateDetail, isStreaming, isLongRunning, error };
}
