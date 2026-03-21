/**
 * Custom React Flow node for trace visualization.
 * Shows type icon, label, duration badge, and cost heat-map color.
 */

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { TraceNode, TraceNodeType } from "@chat3d/shared";
import { costColor } from "./traceLayout";

const TYPE_ICONS: Record<TraceNodeType, string> = {
  root: "🔄",
  prompt_validation: "✅",
  spec_generation: "📋",
  agent_codegen: "🤖",
  agent_step: "⚡",
  sub_agent: "🔧",
  assembly_agent: "🏗️",
  decomposition: "📐",
  eval_orchestration: "📊",
  eval_assertions: "🔍",
  eval_code_review: "💻",
  eval_vlm: "👁️",
  screenshots: "📷",
  rendering: "🎨",
};

function formatDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatCost(usd?: number): string {
  if (usd == null || usd === 0) return "";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

interface TraceNodeComponentProps {
  data: { traceNode: TraceNode; maxCost: number };
  selected?: boolean;
}

function TraceNodeInner({ data, selected }: TraceNodeComponentProps) {
  const { traceNode: node, maxCost } = data;
  const icon = TYPE_ICONS[node.type] ?? "❓";
  const duration = formatDuration(node.durationMs);
  const cost = formatCost(node.usage?.costUsd);
  const isFailed = node.status === "failed";
  const isSkipped = node.status === "skipped";
  const isRunning = node.status === "running";

  const bgColor = isFailed
    ? "rgba(239, 68, 68, 0.15)"
    : isRunning
      ? "rgba(59, 130, 246, 0.1)"
      : node.usage?.costUsd
        ? `${costColor(node.usage.costUsd, maxCost)}22`
        : "rgba(255, 255, 255, 0.05)";

  const borderColor = isFailed
    ? "#ef4444"
    : isRunning
      ? "#3b82f6"
      : isSkipped
        ? "#6b7280"
        : selected
          ? "#3b82f6"
          : node.usage?.costUsd
            ? costColor(node.usage.costUsd, maxCost)
            : "#374151";

  return (
    <div
      style={{
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 180,
        cursor: "pointer",
        opacity: isSkipped ? 0.5 : 1,
        animation: isRunning ? "trace-pulse 1.5s ease-in-out infinite" : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {isRunning ? (
          <span style={{ fontSize: 14, display: "inline-block", animation: "spin 1s linear infinite" }}>⏳</span>
        ) : isFailed ? (
          <span style={{ fontSize: 14, color: "#ef4444" }}>⚡</span>
        ) : (
          <span style={{ fontSize: 14 }}>{icon}</span>
        )}
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "hsl(var(--foreground))",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 140,
          }}
        >
          {node.label}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {duration ? (
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", background: "rgba(255,255,255,0.08)", borderRadius: 4, padding: "1px 4px" }}>
            {duration}
          </span>
        ) : null}
        {cost ? (
          <span style={{ fontSize: 10, color: costColor(node.usage?.costUsd ?? 0, maxCost), background: "rgba(255,255,255,0.08)", borderRadius: 4, padding: "1px 4px" }}>
            {cost}
          </span>
        ) : null}
        {node.toolCalls && node.toolCalls.length > 0 ? (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
            {node.toolCalls.map((tc, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ color: tc.success ? "#4ade80" : "#f87171" }}>{tc.success ? "✓" : "✗"}</span>
                <span style={{ fontFamily: "monospace", fontSize: 9 }}>{tc.toolName}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {node.model ? (
        <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.model}
        </div>
      ) : null}

      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}

// Inject keyframes for running node animation
if (typeof document !== "undefined" && !document.getElementById("trace-node-styles")) {
  const style = document.createElement("style");
  style.id = "trace-node-styles";
  style.textContent = `
    @keyframes trace-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
      50% { box-shadow: 0 0 8px 4px rgba(59, 130, 246, 0.2); }
    }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
}

export const TraceNodeComponent = memo(TraceNodeInner);
