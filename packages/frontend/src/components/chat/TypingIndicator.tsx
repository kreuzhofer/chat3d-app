import type { QueryState } from "../../hooks/useStreamingQuery";

export interface TypingIndicatorProps {
  queryState: QueryState | null;
}

const STATE_LABELS: Partial<Record<QueryState, string>> = {
  queued: "Queued...",
  conversation: "Thinking...",
  codegen: "Generating code...",
  rendering: "Rendering model...",
  retrying: "Retrying with error feedback...",
};

const VISIBLE_STATES = new Set<QueryState>([
  "queued",
  "conversation",
  "codegen",
  "rendering",
  "retrying",
]);

/**
 * Animated typing indicator displayed in the Chat_Thread while the backend
 * is processing a query. Shows state-aware labels and animated dots.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */
export function TypingIndicator({ queryState }: TypingIndicatorProps) {
  if (!queryState || !VISIBLE_STATES.has(queryState)) {
    return null;
  }

  const label = STATE_LABELS[queryState] ?? "Processing...";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="animate-fade-in flex items-center gap-2 rounded-lg border border-[hsl(var(--border)_/_0.4)] bg-[hsl(var(--surface-1))] px-3.5 py-2.5"
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
        <span className="typing-dot typing-dot-delay-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
        <span className="typing-dot typing-dot-delay-2 h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
      </span>
      <span className="text-sm text-[hsl(var(--muted-foreground))]">{label}</span>
    </div>
  );
}
