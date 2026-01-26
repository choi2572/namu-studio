"use client";

import { useMemo } from "react";
import { NodeStateSnapshot } from "@/api/interfaces";
import { NodeStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

// Editor의 상수들 재사용
const NODE_METRICS = {
  width: 220,
  collapsedHeight: 86
};

const CANVAS_PADDING = {
  x: 12,
  y: 12
};

const CANVAS_DEFAULT = {
  width: 1000,
  height: 600
};

// Auto layout 상수 (Editor와 동일)
const SPACING_X = 320;
const ROW_GAP = 60;
const PADDING = 80;

type DagNode = {
  id: string;
  name: string;
  stateName: string;
  status: NodeStatus;
  durationMs: number | null;
  position: { x: number; y: number };
};

type DagEdge = {
  id: string;
  from: string;
  to: string;
};

type DagViewProps = {
  nodeStates: NodeStateSnapshot[];
  selectedNode: string | null;
  onSelectNode: (stateName: string) => void;
  edges?: DagEdge[];
};

// Node status color mapping per UI notes
const NODE_STATUS_STYLE_MAP: Record<NodeStatus, string> = {
  [NodeStatus.RUNNING]: "border-blue-500 bg-blue-100 shadow-md ring-2 ring-blue-300",
  [NodeStatus.WAITING]: "border-amber-400 bg-amber-50",
  [NodeStatus.SUCCEEDED]: "border-slate-300 bg-white",
  [NodeStatus.FAILED]: "border-red-500 bg-red-50",
  [NodeStatus.SKIPPED]: "border-slate-200 bg-slate-50 opacity-60",
  [NodeStatus.CANCELED]: "border-slate-300 bg-slate-100 opacity-60"
};

// Auto layout 함수 (Editor의 handleAutoLayout과 동일한 로직)
function computeAutoLayout(
  nodes: DagNode[],
  edges: DagEdge[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  nodes.forEach((node) => {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  });

  edges.forEach((edge) => {
    if (!inDegree.has(edge.to) || !outgoing.has(edge.from)) return;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });

  const queue = Array.from(inDegree.entries())
    .filter(([, value]) => value === 0)
    .map(([id]) => id);
  const layers = new Map<string, number>();
  queue.forEach((id) => layers.set(id, 0));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const nextLayer = (layers.get(current) ?? 0) + 1;
    outgoing.get(current)?.forEach((to) => {
      layers.set(to, Math.max(layers.get(to) ?? 0, nextLayer));
      inDegree.set(to, (inDegree.get(to) ?? 1) - 1);
      if (inDegree.get(to) === 0) {
        queue.push(to);
      }
    });
  }

  nodes.forEach((node) => {
    if (!layers.has(node.id)) layers.set(node.id, 0);
  });

  const grouped = new Map<number, DagNode[]>();
  nodes.forEach((node) => {
    const layer = layers.get(node.id) ?? 0;
    const group = grouped.get(layer) ?? [];
    group.push(node);
    grouped.set(layer, group);
  });

  Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([layer, group]) => {
      const sortedGroup = [...group].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      let yCursor = PADDING;
      sortedGroup.forEach((node) => {
        const nodeHeight = NODE_METRICS.collapsedHeight;
        const x = PADDING + layer * SPACING_X;
        const y = yCursor;
        yCursor += nodeHeight + ROW_GAP;
        positions.set(node.id, { x, y });
      });
    });

  return positions;
}

function getPortOffsets(nodeHeight: number, count: number) {
  if (count <= 0) return [];
  if (count === 1) {
    return [nodeHeight / 2];
  }
  const gap = nodeHeight / (count + 1);
  return Array.from({ length: count }, (_, index) => gap * (index + 1));
}

export function DagView({
  nodeStates,
  selectedNode,
  onSelectNode,
  edges = []
}: DagViewProps) {
  // 노드 데이터 변환
  const dagNodes = useMemo<DagNode[]>(() => {
    return nodeStates.map((node) => ({
      id: node.stateName,
      name: node.nodeName,
      stateName: node.stateName,
      status: node.status,
      durationMs: node.durationMs,
      position: { x: 0, y: 0 } // 초기값, auto layout에서 계산됨
    }));
  }, [nodeStates]);

  // Auto layout 적용
  const nodePositions = useMemo(() => {
    return computeAutoLayout(dagNodes, edges);
  }, [dagNodes, edges]);

  // 위치가 적용된 노드들
  const positionedNodes = useMemo(() => {
    return dagNodes.map((node) => ({
      ...node,
      position: nodePositions.get(node.id) ?? { x: PADDING, y: PADDING }
    }));
  }, [dagNodes, nodePositions]);

  // Canvas 크기 계산
  const canvasSize = useMemo(() => {
    if (positionedNodes.length === 0) return CANVAS_DEFAULT;
    let maxX = CANVAS_DEFAULT.width;
    let maxY = CANVAS_DEFAULT.height;
    positionedNodes.forEach((node) => {
      maxX = Math.max(maxX, node.position.x + NODE_METRICS.width + PADDING);
      maxY = Math.max(maxY, node.position.y + NODE_METRICS.collapsedHeight + PADDING);
    });
    return { width: maxX, height: maxY };
  }, [positionedNodes]);

  // 렌더링할 엣지들
  const edgesToRender = useMemo(() => {
    return edges.filter((edge) => {
      const fromNode = positionedNodes.find((n) => n.id === edge.from);
      const toNode = positionedNodes.find((n) => n.id === edge.to);
      return fromNode && toNode;
    });
  }, [edges, positionedNodes]);

  if (nodeStates.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No nodes available
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-auto rounded-lg border border-slate-200 bg-slate-50">
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ width: canvasSize.width, height: canvasSize.height }}
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />
          </marker>
        </defs>
        {edgesToRender.map((edge) => {
          const fromNode = positionedNodes.find((n) => n.id === edge.from);
          const toNode = positionedNodes.find((n) => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          const fromNodeHeight = NODE_METRICS.collapsedHeight;
          const toNodeHeight = NODE_METRICS.collapsedHeight;
          const outputOffsets = getPortOffsets(fromNodeHeight, 1);
          const start = {
            x: fromNode.position.x + NODE_METRICS.width,
            y: fromNode.position.y + outputOffsets[0]
          };
          const end = {
            x: toNode.position.x,
            y: toNode.position.y + toNodeHeight / 2
          };
          const curve = Math.max(60, Math.abs(end.x - start.x) / 2);
          const controlX1 = start.x + (end.x >= start.x ? curve : -curve);
          const controlX2 = end.x + (end.x >= start.x ? -curve : curve);
          const path = `M ${start.x} ${start.y} C ${controlX1} ${start.y}, ${controlX2} ${end.y}, ${end.x} ${end.y}`;

          return (
            <path
              key={edge.id}
              d={path}
              stroke="#94a3b8"
              strokeWidth="2"
              fill="none"
              markerEnd="url(#arrow)"
            />
          );
        })}
      </svg>

      {positionedNodes.map((node) => (
        <div
          key={node.id}
          className="absolute"
          style={{
            left: node.position.x,
            top: node.position.y,
            width: NODE_METRICS.width
          }}
        >
          <button
            type="button"
            onClick={() => onSelectNode(node.stateName)}
            className={cn(
              "w-full rounded-lg border-2 p-3 text-left text-sm font-medium transition-all",
              NODE_STATUS_STYLE_MAP[node.status],
              selectedNode === node.stateName
                ? "ring-4 ring-slate-400 ring-offset-2"
                : "hover:shadow-md"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-semibold text-slate-900">{node.name}</p>
                <p className="mt-1 text-xs text-slate-500">{node.stateName}</p>
              </div>
              <StatusBadge status={node.status} />
            </div>
            {node.durationMs !== null && (
              <p className="mt-2 text-xs text-slate-500">
                {formatDuration(node.durationMs)}
              </p>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
