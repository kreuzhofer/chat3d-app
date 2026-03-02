import { useCallback, useEffect, useRef, useState } from "react";
import { useNotifications, type SseSubscriber } from "../contexts/NotificationsContext";
import type { QueryState } from "./useStreamingQuery";

// ── Types ────────────────────────────────────────────────────────────────────

interface WorkbenchJobProgressPayload {
  jobId: string;
  promptId: string;
  state: string;
  detail: string;
}

/** Map workbench pipeline states to TypingIndicator-compatible QueryState. */
const STATE_MAP: Record<string, QueryState> = {
  validating: "queued",
  codegen: "codegen",
  rendering: "rendering",
  screenshots: "rendering",
  evaluating: "evaluating",
  fixing: "fixing",
  completed: "completed",
  failed: "failed",
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseWorkbenchJobProgressResult {
  /** QueryState compatible with TypingIndicator. */
  queryState: QueryState | null;
  /** Detail string from backend (e.g. "Improving model (attempt 2/5)..."). */
  detail: string | null;
}

/**
 * Subscribe to workbench.job.progress SSE events for a specific job.
 * Returns queryState + detail compatible with <TypingIndicator>.
 */
export function useWorkbenchJobProgress(jobId: string | null): UseWorkbenchJobProgressResult {
  const [queryState, setQueryState] = useState<QueryState | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const { subscribe } = useNotifications();
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  const handleMessage: SseSubscriber = useCallback((message) => {
    if (message.eventType !== "workbench.job.progress") return;
    const payload = message.payload as unknown as WorkbenchJobProgressPayload;
    if (payload.jobId !== jobIdRef.current) return;

    const mapped = STATE_MAP[payload.state] ?? null;
    setQueryState(mapped);
    setDetail(payload.detail);
  }, []);

  useEffect(() => {
    // Reset when jobId changes
    setQueryState(null);
    setDetail(null);

    if (!jobId) return;

    return subscribe(handleMessage);
  }, [jobId, subscribe, handleMessage]);

  return { queryState, detail };
}
