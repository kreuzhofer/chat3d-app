import { useCallback, useEffect, useRef, useState } from "react";

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

function parseEventData(raw: string): { eventType: string; payload: Record<string, unknown> } | null {
  try {
    const data = JSON.parse(raw) as {
      eventType?: string;
      payload?: Record<string, unknown>;
    };
    if (typeof data.eventType === "string" && data.payload && typeof data.payload === "object") {
      return { eventType: data.eventType, payload: data.payload };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Listens to SSE `stream-token` and `chat.query.state` events filtered by
 * `assistantItemId`. Accumulates streaming text and tracks query state.
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

  // Use refs to avoid stale closures in event handlers
  const assistantItemIdRef = useRef(assistantItemId);
  assistantItemIdRef.current = assistantItemId;

  const sourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Reset state when assistantItemId changes
    setStreamingText("");
    setQueryState(null);
    setIsStreaming(false);
    setError(null);

    if (!token || !assistantItemId) {
      cleanup();
      return;
    }

    setIsStreaming(true);

    const params = new URLSearchParams({ token });
    const source = new EventSource(`/api/events/stream?${params.toString()}`);
    sourceRef.current = source;

    const handleStreamToken = (event: MessageEvent) => {
      const parsed = parseEventData(event.data);
      if (!parsed || parsed.eventType !== "stream-token") return;

      const payload = parsed.payload as unknown as StreamTokenPayload;
      if (payload.assistantItemId !== assistantItemIdRef.current) return;

      if (payload.token) {
        setStreamingText((prev) => prev + payload.token);
      }

      if (payload.done) {
        // Conversation stage complete — tokens finished but pipeline continues
        // isStreaming stays true until query-state reaches completed/failed
      }
    };

    const handleQueryState = (event: MessageEvent) => {
      const parsed = parseEventData(event.data);
      if (!parsed || parsed.eventType !== "chat.query.state") return;

      const payload = parsed.payload as unknown as QueryStatePayload;
      if (payload.assistantItemId !== assistantItemIdRef.current) return;

      const state = payload.state;
      setQueryState(state);

      if (state === "completed") {
        setIsStreaming(false);
        cleanup();
      } else if (state === "failed") {
        setIsStreaming(false);
        setError(payload.detail ?? "Query failed");
        cleanup();
      }
    };

    const handleError = () => {
      // EventSource error — connection interrupted
      setIsStreaming(false);
      setError("Stream interrupted. Your partial response is shown above.");
      cleanup();
    };

    source.addEventListener("stream-token", handleStreamToken as EventListener);
    source.addEventListener("chat.query.state", handleQueryState as EventListener);
    source.onerror = handleError;

    return () => {
      cleanup();
    };
  }, [token, assistantItemId, cleanup]);

  return { streamingText, queryState, isStreaming, error };
}
