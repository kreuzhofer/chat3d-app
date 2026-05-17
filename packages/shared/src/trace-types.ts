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
  errorInfo?: TraceErrorInfo;
}

export interface TraceAgentMeta {
  stepNumber?: number;
  maxSteps?: number;
  submitted?: boolean;
  renderSuccess?: boolean | "skipped";
  evalScore?: number;
  codeSnapshotHash?: string;
  finishReason?: string;
}

// ── Error classification ───────────────────────────────────────────────

export type TraceErrorCategory =
  | "timeout"
  | "abort"
  | "step_limit"
  | "exception"
  | "render_failure"
  | "validation_failure"
  | "rate_limit"
  | "quota_exhausted"
  | "unknown";

export interface TraceErrorInfo {
  category: TraceErrorCategory;
  message: string;
  stack?: string;
  errorName?: string;
}

// ── Node ──────────────────────────────────────────────────────────────

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
  /** Simple error message string (kept for backward compat with stored traces). */
  error?: string;
  /** Rich error info with classification. */
  errorInfo?: TraceErrorInfo;
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

/**
 * Why a generation run was routed to single-agent vs multi-agent.
 *
 * - `spec_llm_decision`: the spec LLM emitted `requiresDecomposition: true`
 * - `multi_part_pattern`: prompt or interpretation matched the multi-part regex
 *   (snap-fit, hinged lid, clamshell, etc.) — fires without paying the LLM cost
 * - `single_agent_default`: none of the above — routed single-agent
 * - `spec_unavailable`: spec generation was disabled or failed; routing defaulted
 *   to single-agent without any signal
 * - `forced_override`: caller passed `forceMultiAgent: true` — bypasses the spec
 *   resolver entirely. Used by debug probes (scripts/probe-multi-agent.ts) to
 *   measure counterfactual "what if this prompt had been decomposed?" results.
 */
export type ComplexityTriggerReason =
  | "spec_llm_decision"
  | "multi_part_pattern"
  | "single_agent_default"
  | "spec_unavailable"
  | "forced_override";

export interface GenerationTrace {
  version: 1;
  pipelineType: TracePipelineType;
  /**
   * Why the pipeline routed to multi-agent vs single-agent.
   * Absent on traces that predate this field.
   */
  complexityTriggerReason?: ComplexityTriggerReason;
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
