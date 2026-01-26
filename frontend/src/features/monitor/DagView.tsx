"use client";

import { useMemo } from "react";
import { NodeStateSnapshot } from "@/api/interfaces";
import { NodeStatus, RunStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { useEffect, useRef } from "react";

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
  runStatus?: RunStatus | null;
  viewJson?: Record<string, unknown> | null;
};

// Node status color mapping - 더 명확한 구분
const NODE_STATUS_STYLE_MAP: Record<NodeStatus, string> = {
  [NodeStatus.RUNNING]: "border-blue-600 bg-blue-50 shadow-lg ring-4 ring-blue-400 ring-opacity-50 animate-pulse",
  [NodeStatus.WAITING]: "border-amber-500 bg-amber-50 border-dashed",
  [NodeStatus.SUCCEEDED]: "border-green-600 bg-green-100",
  [NodeStatus.FAILED]: "border-red-600 bg-red-50",
  [NodeStatus.SKIPPED]: "border-slate-300 bg-slate-50 opacity-50",
  [NodeStatus.CANCELED]: "border-slate-400 bg-slate-100 opacity-60"
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

// Node type별 색상 - 왼쪽 인디케이터용
const NODE_TYPE_COLORS: Record<string, { border: string; bg: string; text: string; indicator: string }> = {
  skill: {
    border: "border-blue-200",
    bg: "bg-blue-50",
    text: "text-blue-700",
    indicator: "bg-blue-500"
  },
  flow_control: {
    border: "border-cyan-200",
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    indicator: "bg-cyan-500"
  },
  event: {
    border: "border-purple-200",
    bg: "bg-purple-50",
    text: "text-purple-700",
    indicator: "bg-purple-500"
  },
  condition: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-700",
    indicator: "bg-amber-500"
  }
};

function getNodeTypeInfo(nodeName: string, stateName: string): { type: string; colors: { border: string; bg: string; text: string; indicator: string } } {
  const name = nodeName.toLowerCase();
  if (name.includes("condition") || name.includes("if")) {
    return { type: "Condition", colors: NODE_TYPE_COLORS.condition };
  }
  if (name.includes("skill") || name.includes("pick") || name.includes("place")) {
    return { type: "Skill", colors: NODE_TYPE_COLORS.skill };
  }
  if (name.includes("event") || name.includes("wait") || name.includes("webhook")) {
    return { type: "Event", colors: NODE_TYPE_COLORS.event };
  }
  return { type: "Flow Control", colors: NODE_TYPE_COLORS.flow_control };
}

export function DagView({
  nodeStates,
  selectedNode,
  onSelectNode,
  edges = [],
  runStatus,
  viewJson
}: DagViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // 노드 데이터 변환 (id는 stateName과 일치)
  const dagNodes = useMemo<DagNode[]>(() => {
    return nodeStates.map((node) => ({
      id: node.stateName, // stateName을 id로 사용 (view_json의 id와 일치)
      name: node.nodeName,
      stateName: node.stateName,
      status: node.status,
      durationMs: node.durationMs,
      position: { x: 0, y: 0 } // 초기값, layout에서 계산됨
    }));
  }, [nodeStates]);

  // view_json에서 노드 위치 가져오기
  const nodePositionsFromView = useMemo(() => {
    if (!viewJson?.nodes || !Array.isArray(viewJson.nodes)) {
      return null;
    }

    const positions = new Map<string, { x: number; y: number }>();
    viewJson.nodes.forEach((node: unknown) => {
      if (
        typeof node === "object" &&
        node !== null &&
        "id" in node &&
        "x" in node &&
        "y" in node
      ) {
        const nodeData = node as { id: string; x: number; y: number };
        // view_json의 id는 stateName과 일치해야 함
        positions.set(nodeData.id, { x: nodeData.x, y: nodeData.y });
      }
    });
    
    // 모든 노드가 view_json에 있는지 확인 (최소 80% 이상 있어야 사용)
    const nodesInView = dagNodes.filter((node) => positions.has(node.id)).length;
    const coverage = dagNodes.length > 0 ? nodesInView / dagNodes.length : 0;
    
    // 대부분의 노드가 view_json에 있으면 사용, 아니면 null 반환하여 auto layout 사용
    return coverage >= 0.8 ? positions : null;
  }, [viewJson, dagNodes]);

  // Auto layout 사용 (항상 Editor와 동일한 레이아웃 적용)
  const nodePositions = useMemo(() => {
    // 항상 auto layout 사용 (view_json은 나중에 지원)
    return computeAutoLayout(dagNodes, edges);
  }, [dagNodes, edges]);

  // 위치가 적용된 노드들
  const positionedNodes = useMemo(() => {
    return dagNodes.map((node, index) => {
      const position = nodePositions.get(node.id);
      if (!position) {
        // 위치가 없으면 기본값 사용 (겹치지 않도록 인덱스 기반으로 배치)
        return {
          ...node,
          position: { 
            x: PADDING + (index % 3) * SPACING_X, 
            y: PADDING + Math.floor(index / 3) * (NODE_METRICS.collapsedHeight + ROW_GAP)
          }
        };
      }
      return {
        ...node,
        position
      };
    });
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
    if (edges.length === 0) return [];
    
    const validEdges = edges.filter((edge) => {
      const fromNode = positionedNodes.find((n) => n.id === edge.from);
      const toNode = positionedNodes.find((n) => n.id === edge.to);
      const isValid = fromNode && toNode;
      return isValid;
    });
    return validEdges;
  }, [edges, positionedNodes]);

  // Running 상태인 노드 찾기
  const runningNode = useMemo(() => {
    return positionedNodes.find((node) => node.status === NodeStatus.RUNNING);
  }, [positionedNodes]);

  // Auto focus & scroll to running node
  useEffect(() => {
    if (!runningNode || !containerRef.current || runStatus !== RunStatus.RUNNING) {
      return;
    }

    const container = containerRef.current;
    const nodeElement = container.querySelector(
      `[data-node-id="${runningNode.id}"]`
    ) as HTMLElement;

    if (nodeElement) {
      // 노드 선택
      onSelectNode(runningNode.stateName);

      // 스크롤하여 노드가 보이도록
      const containerRect = container.getBoundingClientRect();
      const nodeRect = nodeElement.getBoundingClientRect();
      const scrollLeft =
        container.scrollLeft +
        nodeRect.left -
        containerRect.left -
        containerRect.width / 2 +
        nodeRect.width / 2;
      const scrollTop =
        container.scrollTop +
        nodeRect.top -
        containerRect.top -
        containerRect.height / 2 +
        nodeRect.height / 2;

      container.scrollTo({
        left: scrollLeft,
        top: scrollTop,
        behavior: "smooth"
      });
    }
  }, [runningNode, runStatus, onSelectNode]);

  if (nodeStates.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No nodes available
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-auto rounded-lg border border-slate-200 bg-slate-50"
      style={{ height: "100%", minHeight: canvasSize.height }}
    >
      {/* SVG for edges - behind nodes */}
      <svg
        className="absolute pointer-events-none"
        width={canvasSize.width}
        height={canvasSize.height}
        style={{
          top: 0,
          left: 0,
          zIndex: 0
        }}
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
        {edgesToRender.length > 0 ? (
          edgesToRender.map((edge) => {
            const fromNode = positionedNodes.find((n) => n.id === edge.from);
            const toNode = positionedNodes.find((n) => n.id === edge.to);
            if (!fromNode || !toNode) {
              return null;
            }

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
          })
        ) : null}
      </svg>

      {/* Nodes - in front of edges */}
      {positionedNodes.map((node) => {
        const nodeTypeInfo = getNodeTypeInfo(node.name, node.stateName);
        const isRunning = node.status === NodeStatus.RUNNING;
        const isCompleted = node.status === NodeStatus.SUCCEEDED;
        const isWaiting = node.status === NodeStatus.WAITING;

        return (
          <div
            key={node.id}
            data-node-id={node.id}
            className="absolute"
            style={{
              left: node.position.x,
              top: node.position.y,
              width: NODE_METRICS.width,
              zIndex: 10
            }}
          >
            <button
              type="button"
              onClick={() => onSelectNode(node.stateName)}
              className={cn(
                "relative w-full rounded-lg border-2 p-3 text-left text-sm font-medium transition-all overflow-hidden",
                NODE_STATUS_STYLE_MAP[node.status],
                selectedNode === node.stateName
                  ? "ring-4 ring-slate-400 ring-offset-2"
                  : "hover:shadow-lg"
              )}
            >
              {/* 왼쪽 타입 인디케이터 바 */}
              <div
                className={cn(
                  "absolute left-0 top-0 bottom-0 w-1",
                  nodeTypeInfo.colors.indicator
                )}
              />

              <div className="flex items-start justify-between pl-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={cn(
                      "font-semibold truncate",
                      isRunning ? "text-blue-900" : 
                      isCompleted ? "text-green-900" : 
                      isWaiting ? "text-amber-900" :
                      "text-slate-800"
                    )}>
                      {node.name}
                    </p>
                  </div>
                  
                  {/* 노드 타입 배지 */}
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        nodeTypeInfo.colors.bg,
                        nodeTypeInfo.colors.text,
                        "border border-current"
                      )}
                    >
                      {nodeTypeInfo.type}
                    </span>
                    {isRunning && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-700">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
                        </span>
                        Running
                      </span>
                    )}
                    {isWaiting && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700">
                        Waiting
                      </span>
                    )}
                    {isCompleted && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700">
                        ✓ Completed
                      </span>
                    )}
                  </div>

                  <p className={cn(
                    "text-xs truncate",
                    isRunning ? "text-blue-700" :
                    isCompleted ? "text-green-700" :
                    isWaiting ? "text-amber-700" :
                    "text-slate-600"
                  )}>
                    {node.stateName}
                  </p>
                  
                  {node.durationMs !== null && (
                    <p className="mt-1 text-xs font-medium text-slate-700">
                      ⏱ {formatDuration(node.durationMs)}
                    </p>
                  )}
                </div>
                
                {/* 상태 배지 */}
                <div className="ml-2 flex-shrink-0">
                  <StatusBadge status={node.status} />
                </div>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
