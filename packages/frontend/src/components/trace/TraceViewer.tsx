/**
 * Trace DAG Viewer
 *
 * Renders a generation execution trace as an interactive DAG using React Flow.
 * Shows cost heat-mapping, node detail panel on click, and summary stats.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GenerationTrace, TraceNode } from "@chat3d/shared";
import { layoutTrace } from "./traceLayout";
import { TraceNodeComponent } from "./TraceNodeComponent";
import { TraceNodeDetail } from "./TraceNodeDetail";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: Record<string, any> = {
  traceNode: TraceNodeComponent,
};

function formatDuration(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface TraceViewerProps {
  trace: GenerationTrace;
  totalDurationMs?: number | null;
  totalCostUsd?: number | null;
  totalSteps?: number | null;
  totalLlmCalls?: number | null;
  finalStatus?: string;
  pipelineType?: string;
}

export function TraceViewer({
  trace,
  totalDurationMs,
  totalCostUsd,
  totalSteps,
  totalLlmCalls,
  finalStatus,
  pipelineType,
}: TraceViewerProps) {
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => layoutTrace(trace),
    [trace],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);
  const [selectedNode, setSelectedNode] = useState<TraceNode | null>(null);

  // Sync layout when trace changes
  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onNodeClick = useCallback((_event: any, node: any) => {
    const traceNode = node.data?.traceNode as TraceNode | undefined;
    setSelectedNode(traceNode ?? null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-3 text-xs text-[hsl(var(--muted-foreground))]">
        {pipelineType ? <span>Pipeline: <strong className="text-[hsl(var(--foreground))]">{pipelineType.replace("_", " ")}</strong></span> : null}
        {finalStatus ? <span>Status: <strong className="text-[hsl(var(--foreground))]">{finalStatus}</strong></span> : null}
        {totalDurationMs != null ? <span>Duration: <strong className="text-[hsl(var(--foreground))]">{formatDuration(totalDurationMs)}</strong></span> : null}
        {totalCostUsd != null ? <span>Cost: <strong className="text-[hsl(var(--foreground))]">${Number(totalCostUsd).toFixed(4)}</strong></span> : null}
        {totalSteps != null ? <span>Steps: <strong className="text-[hsl(var(--foreground))]">{totalSteps}</strong></span> : null}
        {totalLlmCalls != null ? <span>LLM calls: <strong className="text-[hsl(var(--foreground))]">{totalLlmCalls}</strong></span> : null}
        <span>Nodes: <strong className="text-[hsl(var(--foreground))]">{trace.nodes.length}</strong></span>
      </div>

      {/* DAG + detail panel */}
      <div className="flex" style={{ height: 500 }}>
        <div className="flex-1 overflow-hidden rounded border border-[hsl(var(--border))]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.3}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeStrokeWidth={3}
              style={{ background: "hsl(var(--card))" }}
            />
          </ReactFlow>
        </div>

        {selectedNode ? (
          <TraceNodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
        ) : null}
      </div>
    </div>
  );
}
