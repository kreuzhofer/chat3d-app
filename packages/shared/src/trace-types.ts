/**
 * Generation Trace Types
 *
 * Shared type definitions for the execution trace graph stored per generation.
 * Used by backend (trace-builder, trace-persistence) and frontend (TraceViewer).
 */

// ── Node types ─────────────────────────────────────────────────────────

export type TraceNodeType =
  | "root"
  | "prompt_validation"
  | "spec_generation"
  | "agent_codegen"
  | "agent_step"
  | "sub_agent"
  | "assembly_agent"
  | "decomposition"
  | "eval_orchestration"
  | "eval_assertions"
  | "eval_code_review"
  | "eval_vlm"
  | "screenshots"
  | "rendering";

export interface TraceNodeUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd: number;
}

export interface TraceToolCall {
  toolName: string;
  durationMs?: number;
  success: boolean;
  inputSummary?: string;
  outputSummary?: string;
}

export interface TraceAgentMeta {
  stepNumber?: number;
  maxSteps?: number;
  submitted?: boolean;
  renderSuccess?: boolean;
  evalScore?: number;
  codeSnapshotHash?: string;
}

export interface TraceNode {
  id: string;
  type: TraceNodeType;
  label: string;
  parentId: string | null;
  status: "running" | "completed" | "failed" | "skipped";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  usage?: TraceNodeUsage;
  model?: string;
  provider?: string;
  toolCalls?: TraceToolCall[];
  agentMeta?: TraceAgentMeta;
  /** LLM text response for this node (truncated for large responses). */
  llmResponseText?: string;
  error?: string;
}

// ── Edge types ─────────────────────────────────────────────────────────

export type TraceEdgeType =
  | "sequence"
  | "triggers"
  | "data_flow"
  | "parallel"
  | "caused_skip"
  | "retry"
  | "rejection";

export interface TraceEdge {
  from: string;
  to: string;
  type: TraceEdgeType;
  label?: string;
}

// ── Top-level trace ────────────────────────────────────────────────────

export type TracePipelineType = "single_agent" | "multi_agent" | "chat";

export interface GenerationTrace {
  version: 1;
  pipelineType: TracePipelineType;
  nodes: TraceNode[];
  edges: TraceEdge[];
}

// ── Trace summary (for DB summary columns) ─────────────────────────────

export interface TraceSummary {
  totalDurationMs: number;
  totalCostUsd: number;
  totalSteps: number;
  totalLlmCalls: number;
  finalStatus: "completed" | "failed" | "aborted";
}
