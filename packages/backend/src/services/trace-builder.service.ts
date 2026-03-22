/**
 * Trace Builder Service
 *
 * Accumulates a structured execution trace (nodes + edges graph) during
 * generation pipelines. Uses AsyncLocalStorage for propagation so inner
 * services can contribute trace data without parameter drilling.
 *
 * All trace operations are null-safe: callers use getTraceBuilder()?.method()
 * which is a no-op when tracing is not active.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type {
  GenerationTrace,
  TracePipelineType,
  TraceNode,
  TraceNodeType,
  TraceNodeUsage,
  TraceEdge,
  TraceEdgeType,
  TraceToolCall,
  TraceAgentMeta,
  TraceSummary,
  TraceErrorInfo,
  TraceErrorCategory,
} from "@chat3d/shared";

// ── AsyncLocalStorage context ────────────────────────────────────────

const traceStore = new AsyncLocalStorage<TraceBuilder>();

/** Run a function with a trace builder in context. */
export function runWithTrace<T>(builder: TraceBuilder, fn: () => T): T {
  return traceStore.run(builder, fn);
}

/** Get the current trace builder (null if none active). */
export function getTraceBuilder(): TraceBuilder | undefined {
  return traceStore.getStore();
}

// ── TraceBuilder ─────────────────────────────────────────────────────

export class TraceBuilder {
  private nodes: TraceNode[] = [];
  private edges: TraceEdge[] = [];
  private nodeStack: string[] = [];
  private pipelineType: TracePipelineType;
  /** Tracks the last sibling added under each parent (keyed by parentId or "__root__"). */
  private lastSiblingByParent = new Map<string, string>();
  /** Optional callback invoked on every state change for live SSE publishing. */
  private onChange?: (trace: GenerationTrace) => void;

  constructor(pipelineType: TracePipelineType) {
    this.pipelineType = pipelineType;
  }

  /** Register a callback that fires on every startPhase/endPhase for live updates. */
  setOnChange(fn: (trace: GenerationTrace) => void): void {
    this.onChange = fn;
  }

  private emitChange(): void {
    this.onChange?.(this.snapshot());
  }

  /** Update pipeline type (e.g. when multi-agent is determined after init). */
  setPipelineType(type: TracePipelineType): void {
    this.pipelineType = type;
  }

  /**
   * Start a new phase node.
   * @param skipAutoEdge — if true, no automatic sequence edge is created (use for parallel nodes with explicit edges)
   */
  startPhase(id: string, type: TraceNodeType, label: string, parentId?: string, skipAutoEdge = false): void {
    const resolvedParent = parentId ?? this.currentNodeId() ?? null;
    const parentKey = resolvedParent ?? "__root__";

    if (!skipAutoEdge) {
      // Add sequence edge: from previous sibling, or from parent if this is the first child
      const prevSibling = this.lastSiblingByParent.get(parentKey);
      if (prevSibling) {
        this.edges.push({ from: prevSibling, to: id, type: "sequence" });
      } else if (resolvedParent) {
        this.edges.push({ from: resolvedParent, to: id, type: "sequence" });
      }
      this.lastSiblingByParent.set(parentKey, id);
    }

    this.nodes.push({
      id,
      type,
      label,
      parentId: resolvedParent,
      status: "running",
      startedAt: new Date().toISOString(),
    });

    this.nodeStack.push(id);
    this.emitChange();
  }

  /** End a phase, setting status and optional metadata. If nodeId is omitted, pops from the stack. */
  endPhase(status: TraceNode["status"], opts?: { error?: string; errorInfo?: TraceErrorInfo; nodeId?: string }): void {
    const resolvedId = opts?.nodeId ?? this.nodeStack.pop();
    if (!resolvedId) return;

    // If explicit nodeId was given, also remove it from the stack if present
    if (opts?.nodeId) {
      const idx = this.nodeStack.indexOf(opts.nodeId);
      if (idx >= 0) this.nodeStack.splice(idx, 1);
    }

    const node = this.findNode(resolvedId);
    if (!node) return;

    node.status = status;
    node.completedAt = new Date().toISOString();
    node.durationMs = new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime();
    if (opts?.error) node.error = opts.error;
    if (opts?.errorInfo) node.errorInfo = opts.errorInfo;
    this.emitChange();
  }

  /** Classify an error into a TraceErrorInfo with category, message, stack, and name. */
  static classifyError(err: unknown): TraceErrorInfo {
    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : undefined;
    const stack = err instanceof Error && err.stack
      ? err.stack.slice(0, 500)
      : undefined;

    let category: TraceErrorCategory = "exception";

    if (errorName === "AbortError" || /\babort/i.test(message)) {
      category = "abort";
    } else if (/\btimeout\b/i.test(message) || /\btimed?\s*out\b/i.test(message)) {
      category = "timeout";
    } else if (errorName === "ProviderRateLimitError" || /rate.?limit/i.test(message)) {
      category = "rate_limit";
    } else if (errorName === "ProviderQuotaExhaustedError" || /quota.?exhaust/i.test(message)) {
      category = "quota_exhausted";
    } else if (/\brender\b/i.test(message) || /\bbuild123d\b/i.test(message)) {
      category = "render_failure";
    } else if (/\bvalidation\b/i.test(message)) {
      category = "validation_failure";
    }

    return { category, message, stack, errorName };
  }

  /** Convenience: classify error, then end the current phase as failed with error info. */
  endPhaseWithError(err: unknown, opts?: { nodeId?: string }): void {
    const errorInfo = TraceBuilder.classifyError(err);
    this.endPhase("failed", {
      error: errorInfo.message,
      errorInfo,
      nodeId: opts?.nodeId,
    });
  }

  /** Set usage on the current (or specified) node. */
  addUsage(usage: TraceNodeUsage, nodeId?: string): void {
    const node = this.findNode(nodeId ?? this.currentNodeId());
    if (!node) return;
    node.usage = usage;
  }

  /** Set LLM response text on a node (truncated to avoid bloating the trace). */
  setLlmResponseText(text: string, nodeId?: string): void {
    const node = this.findNode(nodeId ?? this.currentNodeId());
    if (!node) return;
    node.llmResponseText = text.length > 2000 ? text.slice(0, 2000) + "…" : text;
  }

  /** Set model/provider on the current (or specified) node. */
  setModel(model: string, provider?: string, nodeId?: string): void {
    const node = this.findNode(nodeId ?? this.currentNodeId());
    if (!node) return;
    node.model = model;
    if (provider) node.provider = provider;
  }

  /** Append a tool call to the current (or specified) node. */
  addToolCall(tc: TraceToolCall, nodeId?: string): void {
    const node = this.findNode(nodeId ?? this.currentNodeId());
    if (!node) return;
    if (!node.toolCalls) node.toolCalls = [];
    node.toolCalls.push(tc);
  }

  /** Set agent metadata on the current (or specified) node. */
  setAgentMeta(meta: Partial<TraceAgentMeta>, nodeId?: string): void {
    const node = this.findNode(nodeId ?? this.currentNodeId());
    if (!node) return;
    node.agentMeta = { ...node.agentMeta, ...meta };
  }

  /** Explicitly add a semantic edge between two nodes. */
  addEdge(from: string, to: string, type: TraceEdgeType, label?: string): void {
    this.edges.push({ from, to, type, label });
  }

  /**
   * Create a sub-builder for a parallel sub-agent.
   * The sub-builder's nodes will have parentId set to the sub-agent root.
   */
  createSubBuilder(id: string, type: TraceNodeType, label: string): TraceBuilder {
    const sub = new TraceBuilder(this.pipelineType);
    sub.startPhase(id, type, label, undefined);
    return sub;
  }

  /**
   * Merge a sub-builder's nodes and edges into this builder.
   * Adds a data_flow edge from the sub's root to the specified target node.
   */
  mergeSubBuilder(sub: TraceBuilder, targetId: string, parentId?: string): void {
    const subNodes = sub.nodes;
    const subEdges = sub.edges;

    // Re-parent the sub's root nodes under the specified parent
    if (parentId) {
      for (const node of subNodes) {
        if (node.parentId === null) {
          node.parentId = parentId;
        }
      }
    }

    this.nodes.push(...subNodes);
    this.edges.push(...subEdges);

    // Add data_flow edge from the sub's root to the target
    if (subNodes.length > 0) {
      this.edges.push({
        from: subNodes[0].id,
        to: targetId,
        type: "data_flow",
      });
    }
  }

  /** Aggregate child usage up to parent nodes that have no usage of their own. */
  private aggregateUsage(nodes: TraceNode[]): void {
    // Build parent→children map
    const childrenOf = new Map<string, TraceNode[]>();
    for (const n of nodes) {
      if (n.parentId) {
        const list = childrenOf.get(n.parentId) ?? [];
        list.push(n);
        childrenOf.set(n.parentId, list);
      }
    }
    // For each parent without usage, sum children (recursive — children already have their own aggregated)
    for (const node of nodes) {
      if (node.usage) continue;
      const children = childrenOf.get(node.id);
      if (!children || children.length === 0) continue;
      const sum = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
      for (const child of children) {
        if (!child.usage) continue;
        sum.inputTokens += child.usage.inputTokens;
        sum.outputTokens += child.usage.outputTokens;
        sum.reasoningTokens += child.usage.reasoningTokens ?? 0;
        sum.costUsd += child.usage.costUsd;
      }
      if (sum.inputTokens > 0 || sum.costUsd > 0) {
        node.usage = sum;
      }
    }
  }

  /** Return a point-in-time snapshot of the trace (doesn't close running nodes). */
  snapshot(): GenerationTrace {
    const snapshotNodes = this.nodes.map(n => ({ ...n }));
    this.aggregateUsage(snapshotNodes);
    return {
      version: 1,
      pipelineType: this.pipelineType,
      nodes: snapshotNodes,
      edges: [...this.edges],
    };
  }

  /** Build the final trace object. */
  build(): GenerationTrace {
    // Close any unclosed nodes
    for (const node of this.nodes) {
      if (node.status === "running") {
        node.status = "completed";
        node.completedAt = new Date().toISOString();
        node.durationMs = new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime();
      }
    }
    this.aggregateUsage(this.nodes);

    return {
      version: 1,
      pipelineType: this.pipelineType,
      nodes: this.nodes,
      edges: this.edges,
    };
  }

  /** Compute summary metrics from the accumulated trace. */
  computeSummary(): TraceSummary {
    const rootNodes = this.nodes.filter(n => n.parentId === null || n.type === "root");
    const firstStart = this.nodes.reduce((min, n) => {
      const t = new Date(n.startedAt).getTime();
      return t < min ? t : min;
    }, Infinity);
    const lastEnd = this.nodes.reduce((max, n) => {
      if (!n.completedAt) return max;
      const t = new Date(n.completedAt).getTime();
      return t > max ? t : max;
    }, 0);

    const totalCostUsd = this.nodes.reduce((sum, n) => sum + (n.usage?.costUsd ?? 0), 0);
    const totalLlmCalls = this.nodes.filter(n => n.usage && n.usage.inputTokens > 0).length;
    const totalSteps = this.nodes.filter(n => n.type === "agent_step").length;

    const hasFailed = this.nodes.some(n => n.status === "failed");
    const abortCategories: ReadonlySet<string> = new Set(["abort", "timeout", "step_limit"]);
    const hasAborted = this.nodes.some(n => n.errorInfo?.category != null && abortCategories.has(n.errorInfo.category))
      || rootNodes.some(n => n.status === "failed" && n.error?.includes("abort"));

    return {
      totalDurationMs: lastEnd > 0 ? lastEnd - firstStart : 0,
      totalCostUsd,
      totalSteps,
      totalLlmCalls,
      finalStatus: hasAborted ? "aborted" : hasFailed ? "failed" : "completed",
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private currentNodeId(): string | undefined {
    return this.nodeStack[this.nodeStack.length - 1];
  }

  private findNode(id: string | undefined): TraceNode | undefined {
    if (!id) return undefined;
    return this.nodes.find(n => n.id === id);
  }
}
