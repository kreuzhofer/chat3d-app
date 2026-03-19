/**
 * Side panel showing detailed info for a selected trace node.
 * Shows tool calls, token breakdown, error details, agent metadata.
 */

import type { TraceNode } from "@chat3d/shared";
import { Badge } from "../ui/badge";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function statusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "skipped") return "neutral";
  return "warning";
}

export function TraceNodeDetail({ node, onClose }: { node: TraceNode; onClose: () => void }) {
  return (
    <div className="w-80 shrink-0 overflow-y-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{node.label}</h3>
        <button onClick={onClose} className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
          Close
        </button>
      </div>

      <div className="space-y-3 text-xs">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="text-[hsl(var(--muted-foreground))]">Status:</span>
          <Badge tone={statusTone(node.status)}>{node.status}</Badge>
        </div>

        {/* Duration */}
        <div className="flex items-center gap-2">
          <span className="text-[hsl(var(--muted-foreground))]">Duration:</span>
          <span>{formatDuration(node.durationMs)}</span>
        </div>

        {/* Model */}
        {node.model ? (
          <div>
            <span className="text-[hsl(var(--muted-foreground))]">Model: </span>
            <span>{node.model}</span>
            {node.provider ? <span className="text-[hsl(var(--muted-foreground))]"> ({node.provider})</span> : null}
          </div>
        ) : null}

        {/* Token breakdown */}
        {node.usage ? (
          <div>
            <p className="mb-1 font-medium uppercase text-[hsl(var(--muted-foreground))]">Tokens</p>
            <div className="grid grid-cols-2 gap-1">
              <span className="text-[hsl(var(--muted-foreground))]">Input:</span>
              <span>{formatTokens(node.usage.inputTokens)}</span>
              <span className="text-[hsl(var(--muted-foreground))]">Output:</span>
              <span>{formatTokens(node.usage.outputTokens)}</span>
              {node.usage.reasoningTokens ? (
                <>
                  <span className="text-[hsl(var(--muted-foreground))]">Reasoning:</span>
                  <span>{formatTokens(node.usage.reasoningTokens)}</span>
                </>
              ) : null}
              {node.usage.cacheReadTokens ? (
                <>
                  <span className="text-[hsl(var(--muted-foreground))]">Cache read:</span>
                  <span>{formatTokens(node.usage.cacheReadTokens)}</span>
                </>
              ) : null}
              <span className="text-[hsl(var(--muted-foreground))]">Cost:</span>
              <span className="font-medium">${node.usage.costUsd.toFixed(6)}</span>
            </div>
          </div>
        ) : null}

        {/* Agent metadata */}
        {node.agentMeta ? (
          <div>
            <p className="mb-1 font-medium uppercase text-[hsl(var(--muted-foreground))]">Agent</p>
            <div className="grid grid-cols-2 gap-1">
              {node.agentMeta.stepNumber != null ? (
                <>
                  <span className="text-[hsl(var(--muted-foreground))]">Step:</span>
                  <span>{node.agentMeta.stepNumber}{node.agentMeta.maxSteps ? ` / ${node.agentMeta.maxSteps}` : ""}</span>
                </>
              ) : null}
              {node.agentMeta.submitted != null ? (
                <>
                  <span className="text-[hsl(var(--muted-foreground))]">Submitted:</span>
                  <span>{node.agentMeta.submitted ? "Yes" : "No"}</span>
                </>
              ) : null}
              {node.agentMeta.renderSuccess != null ? (
                <>
                  <span className="text-[hsl(var(--muted-foreground))]">Render:</span>
                  <span>{node.agentMeta.renderSuccess ? "Success" : "Failed"}</span>
                </>
              ) : null}
              {node.agentMeta.evalScore != null ? (
                <>
                  <span className="text-[hsl(var(--muted-foreground))]">Eval score:</span>
                  <span>{node.agentMeta.evalScore}</span>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Tool calls */}
        {node.toolCalls && node.toolCalls.length > 0 ? (
          <div>
            <p className="mb-1 font-medium uppercase text-[hsl(var(--muted-foreground))]">Tool Calls ({node.toolCalls.length})</p>
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {node.toolCalls.map((tc, i) => (
                <div
                  key={i}
                  className="rounded border border-[hsl(var(--border))] p-1.5"
                >
                  <div className="flex items-center gap-1">
                    <span className={tc.success ? "text-emerald-400" : "text-red-400"}>
                      {tc.success ? "✓" : "✗"}
                    </span>
                    <span className="font-mono">{tc.toolName}</span>
                    {tc.durationMs != null ? (
                      <span className="ml-auto text-[hsl(var(--muted-foreground))]">{formatDuration(tc.durationMs)}</span>
                    ) : null}
                  </div>
                  {tc.inputSummary ? (
                    <div className="mt-0.5 whitespace-pre-wrap break-all text-[hsl(var(--muted-foreground))]">
                      → {tc.inputSummary}
                    </div>
                  ) : null}
                  {tc.outputSummary ? (
                    <div className="mt-0.5 whitespace-pre-wrap break-all text-[hsl(var(--muted-foreground))]">
                      ← {tc.outputSummary}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* LLM Response */}
        {node.llmResponseText ? (
          <div>
            <p className="mb-1 font-medium uppercase text-[hsl(var(--muted-foreground))]">LLM Response</p>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-[hsl(var(--muted)/0.3)] p-2 font-mono text-[10px] leading-relaxed text-[hsl(var(--foreground)/0.8)]">
              {node.llmResponseText}
            </div>
          </div>
        ) : null}

        {/* Error */}
        {node.error ? (
          <div>
            <p className="mb-1 font-medium uppercase text-red-400">Error</p>
            <p className="whitespace-pre-wrap break-all rounded bg-red-950/30 p-2 text-red-300">
              {node.error}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
