/**
 * Dagre-based auto-layout for trace DAG.
 * Converts GenerationTrace nodes/edges into React Flow positions.
 */

import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { GenerationTrace, TraceNode } from "@chat3d/shared";

const NODE_MIN_WIDTH = 180;
const NODE_HEIGHT = 70;
const CHAR_WIDTH = 7.5; // approximate px per character at font-size 12

/** Estimate node width based on label length and whether it has a model subtitle. */
function estimateNodeWidth(node: TraceNode): number {
  const labelWidth = node.label.length * CHAR_WIDTH + 40; // icon + padding
  const modelWidth = node.model ? node.model.length * 5.5 + 20 : 0; // smaller font
  return Math.max(NODE_MIN_WIDTH, Math.ceil(Math.max(labelWidth, modelWidth)));
}

/** Edge types that are semantic only — excluded from both layout and rendering. */
const HIDDEN_EDGE_TYPES = new Set(["parallel"]);

/** Map trace edge types to React Flow edge styles. */
function edgeStyle(type: string): Partial<Edge> {
  switch (type) {
    case "caused_skip":
      return { style: { strokeDasharray: "5,5", stroke: "#ef4444" }, label: undefined };
    case "data_flow":
      return { style: { stroke: "#3b82f6", strokeWidth: 2 }, animated: true };
    case "parallel":
      return { style: { strokeDasharray: "3,3", stroke: "#a855f7", strokeWidth: 1 } };
    case "retry":
      return { style: { stroke: "#f59e0b" } };
    case "rejection":
      return { style: { stroke: "#ef4444" } };
    default:
      return {};
  }
}

/** Cost heat-map color: green (cheap) → red (expensive). */
export function costColor(costUsd: number, maxCost: number): string {
  if (maxCost <= 0) return "hsl(120, 70%, 40%)";
  const ratio = Math.min(costUsd / maxCost, 1);
  const hue = 120 - ratio * 120; // 120=green → 0=red
  return `hsl(${hue}, 70%, 40%)`;
}

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
  maxCost: number;
}

export function layoutTrace(trace: GenerationTrace): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 30 });

  // Add nodes — skip the "root" container node (it's a wrapper, not visual)
  const nodeIds = new Set<string>();
  const nodeWidths = new Map<string, number>();
  for (const node of trace.nodes) {
    if (node.type === "root") continue;
    const w = estimateNodeWidth(node);
    nodeWidths.set(node.id, w);
    g.setNode(node.id, { width: w, height: NODE_HEIGHT });
    nodeIds.add(node.id);
  }

  // Add edges for layout — exclude hidden edge types
  for (const edge of trace.edges) {
    if (HIDDEN_EDGE_TYPES.has(edge.type)) continue;
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
      g.setEdge(edge.from, edge.to);
    }
  }

  dagre.layout(g);

  const maxCost = trace.nodes.reduce(
    (max, n) => Math.max(max, n.usage?.costUsd ?? 0),
    0,
  );

  const nodes: Node[] = trace.nodes
    .filter(n => n.type !== "root")
    .map((traceNode) => {
      const pos = g.node(traceNode.id);
      const w = nodeWidths.get(traceNode.id) ?? NODE_MIN_WIDTH;
      return {
        id: traceNode.id,
        type: "traceNode",
        position: {
          x: (pos?.x ?? 0) - w / 2,
          y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
        },
        data: { traceNode, maxCost },
      };
    });

  const edges: Edge[] = trace.edges
    .filter(e => !HIDDEN_EDGE_TYPES.has(e.type) && nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((traceEdge, i) => ({
      id: `e-${i}`,
      source: traceEdge.from,
      target: traceEdge.to,
      label: traceEdge.label,
      animated: traceEdge.type === "data_flow" || traceEdge.type === "sequence",
      ...edgeStyle(traceEdge.type),
    }));

  return { nodes, edges, maxCost };
}
