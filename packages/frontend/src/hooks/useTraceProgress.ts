/**
 * Hook that subscribes to live trace updates via SSE during generation.
 * Returns the latest trace snapshot for real-time DAG visualization.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationTrace } from "@chat3d/shared";
import { useNotifications, type SseSubscriber } from "../contexts/NotificationsContext";

interface TraceUpdatePayload {
  jobId: string;
  promptId: string;
  trace: GenerationTrace;
}

export function useTraceProgress(jobId: string | null): GenerationTrace | null {
  const { subscribe } = useNotifications();
  const [trace, setTrace] = useState<GenerationTrace | null>(null);
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  const handleMessage: SseSubscriber = useCallback((message) => {
    if (message.eventType !== "workbench.trace.update") return;
    const payload = message.payload as unknown as TraceUpdatePayload;
    if (payload.jobId !== jobIdRef.current) return;
    setTrace(payload.trace);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setTrace(null);
      return;
    }
    return subscribe(handleMessage);
  }, [jobId, subscribe, handleMessage]);

  return trace;
}
