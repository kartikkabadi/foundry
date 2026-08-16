"use client";

import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { STAGES, type IssueStage, type StageStatus } from "@/lib/foundry/types";

const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "pending",
  active: "active",
  blocked: "blocked",
  skipped: "skipped",
  done: "done",
};

function layout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 72 });
  for (const node of nodes) {
    graph.setNode(node.id, { width: 160, height: 64 });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  return {
    nodes: nodes.map((node) => {
      const point = graph.node(node.id);
      return {
        ...node,
        position: { x: point.x - 80, y: point.y - 32 },
      };
    }),
    edges,
  };
}

export function IssueGraph({ stages }: { stages: IssueStage[] }) {
  const { nodes, edges } = useMemo(() => {
    const byId = new Map(stages.map((stage) => [stage.stage, stage]));
    const rawNodes: Node[] = STAGES.map((id) => {
      const row = byId.get(id);
      const status = row?.status ?? "pending";
      return {
        id,
        data: { label: `${id}\n${STATUS_LABEL[status]}` },
        position: { x: 0, y: 0 },
        style: {
          border: status === "active" ? "1px solid #fff" : "1px solid #333",
          background: status === "skipped" ? "#111" : "#000",
          color: status === "skipped" ? "#666" : "#eee",
          fontSize: 12,
          whiteSpace: "pre",
          padding: 8,
          width: 160,
        },
      };
    });
    const rawEdges: Edge[] = STAGES.slice(0, -1).map((id, index) => ({
      id: `${id}-${STAGES[index + 1]}`,
      source: id,
      target: STAGES[index + 1],
      style: { stroke: byId.get(STAGES[index + 1])?.status === "skipped" ? "#333" : "#888" },
    }));
    return layout(rawNodes, rawEdges);
  }, [stages]);

  return (
    <div style={{ width: "100%", height: "28rem" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#222" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
