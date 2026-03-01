import type { QueryState } from "../../hooks/useStreamingQuery";

export interface TypingIndicatorProps {
  queryState: QueryState | null;
  /** Optional detail from the backend SSE event (e.g. "Improving model (attempt 2/5, score: 3/10)..."). */
  detail?: string | null;
  /** Whether the pipeline has been running for more than 60 seconds. */
  isLongRunning?: boolean;
}

/** Fallback labels when the backend doesn't send a detail string. */
const STATE_LABELS: Partial<Record<QueryState, string>> = {
  queued: "Queued...",
  conversation: "Thinking...",
  codegen: "Generating code...",
  rendering: "Rendering model...",
  evaluating: "Evaluating quality...",
  fixing: "Improving model...",
  retrying: "Retrying with error feedback...",
};

const VISIBLE_STATES = new Set<QueryState>([
  "queued",
  "conversation",
  "codegen",
  "rendering",
  "evaluating",
  "fixing",
  "retrying",
]);

/**
 * Animated typing indicator displayed in the Chat_Thread while the backend
 * is processing a query. Shows state-aware labels and animated dots.
 * Prefers the backend-provided detail message over static fallback labels.
 *
 * When the pipeline has been running for >60s, shows a reassuring message
 * encouraging the user to come back later.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */
export function TypingIndicator({ queryState, detail, isLongRunning }: TypingIndicatorProps) {
  if (!queryState || !VISIBLE_STATES.has(queryState)) {
    return null;
  }

  const label = detail || STATE_LABELS[queryState] || "Processing...";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="animate-fade-in space-y-2 rounded-lg border border-[hsl(var(--border)_/_0.4)] bg-[hsl(var(--surface-1))] px-3.5 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
          <span className="typing-dot typing-dot-delay-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
          <span className="typing-dot typing-dot-delay-2 h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
        </span>
        <span className="text-sm text-[hsl(var(--muted-foreground))]">{label}</span>
      </div>
      {isLongRunning ? (
        <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground)_/_0.7)]">
          This is taking a while — your model is still being generated. Feel free to leave and come back. You'll get a notification when it's ready.
        </p>
      ) : null}
    </div>
  );
}
