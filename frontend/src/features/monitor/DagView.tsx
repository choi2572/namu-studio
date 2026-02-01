"use client";

import { useMemo, useEffect, useRef, useCallback } from "react";
import { NodeStateSnapshot } from "@/api/interfaces";
import { NodeStatus, RunStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { ContainerFrame, type ContainerFrameRegion } from "@/components/ContainerFrame";
import type { MonitorGraph, MonitorNode, MonitorEdge, MonitorContainer } from "@/features/monitor/monitorGraph";

// Editor의 상수들 재사용
const NODE_METRICS = {
  width: 220,
  collapsedHeight: 86
};

const CANVAS_PADDING = { x: 12, y: 12 };
const CANVAS_DEFAULT = { width: 1000, height: 600 };

// Auto layout 상수 (Editor와 동일)
const SPACING_X = 320;
const ROW_GAP = 60;
const PADDING = 80;

// Monitor container frame (read-only)
const CONTAINER_HEADER_HEIGHT = 36;
const CONTAINER_PADDING = 16;
const CONTAINER_ROW_GAP = 24;
const CONTAINER_COLUMN_GAP = 24;
const CONTAINER_MIN_WIDTH = 280;
const CONTAINER_MIN_HEIGHT = 120;
const CONTAINER_BRANCH_MIN_WIDTH = 200;

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
  onSelectNode: (idOrStateName: string) => void;
  edges?: DagEdge[];
  runStatus?: RunStatus | null;
  viewJson?: Record<string, unknown> | null;
  /** When set, render with container frames (Repeat/Parallel) and nested nodes (path-based IDs). */
  monitorGraph?: MonitorGraph | null;
  /** When using monitorGraph, call this so parent can scroll to node by pathId. */
  onScrollToNode?: (pathId: string) => void;
};

// Node status color mapping - 더 명확한 구분 (top-level + nested 동일)
const NODE_STATUS_STYLE_MAP: Record<NodeStatus, string> = {
  [NodeStatus.RUNNING]: "border-blue-600 bg-blue-50 shadow-lg ring-4 ring-blue-400 ring-opacity-50 animate-pulse",
  [NodeStatus.WAITING]: "border-amber-500 bg-amber-50 border-dashed",
  [NodeStatus.SUCCEEDED]: "border-green-600 bg-green-100",
  [NodeStatus.FAILED]: "border-red-600 bg-red-50",
  [NodeStatus.SKIPPED]: "border-slate-300 bg-slate-50 opacity-50",
  [NodeStatus.CANCELED]: "border-slate-400 bg-slate-100 opacity-60"
};

// --- Monitor graph layout (containers always unfolded) ---
type PositionedMonitorNode = MonitorNode & {
  status: NodeStatus;
  durationMs: number | null;
  position: { x: number; y: number };
};

type ContainerFrameLayout = {
  container: MonitorContainer;
  position: { x: number; y: number };
  size: { width: number; height: number };
  headerHeight: number;
  regions: ContainerFrameRegion[];
};

function computeMonitorLayout(
  graph: MonitorGraph,
  statusByApiStateName: Map<string, { status: NodeStatus; durationMs: number | null }>
): {
  positionedNodes: PositionedMonitorNode[];
  containerFrames: ContainerFrameLayout[];
  canvasSize: { width: number; height: number };
} {
  const topLevelNodes = graph.nodes.filter((n) => n.containerPathId === null);
  const topLevelEdges = graph.edges.filter((e) => {
    const fromTop = topLevelNodes.some((n) => n.pathId === e.from);
    const toTop = topLevelNodes.some((n) => n.pathId === e.to);
    return fromTop && toTop;
  });
  const dagNodes: DagNode[] = topLevelNodes.map((n) => ({
    id: n.pathId,
    name: n.nodeName,
    stateName: n.stateName,
    status: statusByApiStateName.get(n.apiStateName)?.status ?? NodeStatus.WAITING,
    durationMs: statusByApiStateName.get(n.apiStateName)?.durationMs ?? null,
    position: { x: 0, y: 0 }
  }));
  const dagEdges: DagEdge[] = topLevelEdges.map((e) => ({ id: e.id, from: e.from, to: e.to }));
  const topPositions = computeAutoLayout(dagNodes, dagEdges);

  const positionedNodes: PositionedMonitorNode[] = [];
  const containerFrames: ContainerFrameLayout[] = [];

  topLevelNodes.forEach((node) => {
    const pos = topPositions.get(node.pathId);
    if (!pos) return;
    const status = statusByApiStateName.get(node.apiStateName)?.status ?? NodeStatus.WAITING;
    const durationMs = statusByApiStateName.get(node.apiStateName)?.durationMs ?? null;
    if (node.isContainer && node.containerType) {
      const container = graph.containers.find((c) => c.pathId === node.pathId);
      if (!container) return;
      const innerNodes = graph.nodes.filter((n) => n.containerPathId === node.pathId);
      if (container.type === "repeat") {
        const region = container.regions[0];
        const pathIds = region?.pathIds ?? [];
        const children = pathIds
          .map((pathId) => graph.nodes.find((n) => n.pathId === pathId))
          .filter((n): n is MonitorNode => n != null);
        let yCursor = pos.y + CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING;
        const regionWidth = Math.max(
          CONTAINER_MIN_WIDTH,
          NODE_METRICS.width + CONTAINER_PADDING * 2
        );
        const regionHeight =
          CONTAINER_HEADER_HEIGHT +
          CONTAINER_PADDING * 2 +
          children.length * (NODE_METRICS.collapsedHeight + CONTAINER_ROW_GAP) -
          CONTAINER_ROW_GAP;
        const frameWidth = regionWidth;
        const frameHeight = Math.max(CONTAINER_MIN_HEIGHT, regionHeight);
        const bounds = {
          x: pos.x,
          y: pos.y,
          width: frameWidth,
          height: frameHeight
        };
        containerFrames.push({
          container,
          position: { x: pos.x, y: pos.y },
          size: { width: frameWidth, height: frameHeight },
          headerHeight: CONTAINER_HEADER_HEIGHT,
          regions: [
            {
              index: 0,
              label: region?.label ?? "Body",
              bounds,
              isEmpty: children.length === 0
            }
          ]
        });
        children.forEach((child) => {
          const cStatus = statusByApiStateName.get(child.apiStateName)?.status ?? NodeStatus.WAITING;
          const cDuration = statusByApiStateName.get(child.apiStateName)?.durationMs ?? null;
          positionedNodes.push({
            ...child,
            status: cStatus,
            durationMs: cDuration,
            position: {
              x: pos.x + CONTAINER_PADDING,
              y: yCursor
            }
          });
          yCursor += NODE_METRICS.collapsedHeight + CONTAINER_ROW_GAP;
        });
      } else {
        const branchCount = container.branchCount || 1;
        const regionWidth = Math.max(
          CONTAINER_BRANCH_MIN_WIDTH,
          NODE_METRICS.width + CONTAINER_PADDING
        );
        const regions: ContainerFrameRegion[] = container.regions.map((reg, idx) => {
          const pathIds = reg.pathIds;
          const children = pathIds
            .map((pathId) => graph.nodes.find((n) => n.pathId === pathId))
            .filter((n): n is MonitorNode => n != null);
          const height =
            CONTAINER_HEADER_HEIGHT +
            CONTAINER_PADDING * 2 +
            Math.max(1, children.length) * (NODE_METRICS.collapsedHeight + CONTAINER_ROW_GAP) -
            CONTAINER_ROW_GAP;
          return {
            index: idx,
            label: reg.label,
            bounds: {
              x: pos.x + CONTAINER_PADDING + idx * (regionWidth + 2),
              y: pos.y,
              width: regionWidth,
              height: Math.max(CONTAINER_MIN_HEIGHT, height)
            },
            isEmpty: children.length === 0
          };
        });
        const totalWidth =
          CONTAINER_PADDING * 2 + branchCount * regionWidth + (branchCount - 1) * 2;
        const maxHeight = Math.max(
          ...regions.map((r) => r.bounds.height),
          CONTAINER_MIN_HEIGHT
        );
        containerFrames.push({
          container,
          position: { x: pos.x, y: pos.y },
          size: { width: totalWidth, height: maxHeight },
          headerHeight: CONTAINER_HEADER_HEIGHT,
          regions
        });
        container.regions.forEach((reg, idx) => {
          let yCursor = pos.y + CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING;
          const regionX = pos.x + CONTAINER_PADDING + idx * (regionWidth + 2);
          reg.pathIds.forEach((pathId) => {
            const child = graph.nodes.find((n) => n.pathId === pathId);
            if (!child) return;
            const cStatus = statusByApiStateName.get(child.apiStateName)?.status ?? NodeStatus.WAITING;
            const cDuration = statusByApiStateName.get(child.apiStateName)?.durationMs ?? null;
            positionedNodes.push({
              ...child,
              status: cStatus,
              durationMs: cDuration,
              position: { x: regionX, y: yCursor }
            });
            yCursor += NODE_METRICS.collapsedHeight + CONTAINER_ROW_GAP;
          });
        });
      }
    } else {
      positionedNodes.push({
        ...node,
        status,
        durationMs,
        position: pos
      });
    }
  });

  let maxX = CANVAS_DEFAULT.width;
  let maxY = CANVAS_DEFAULT.height;
  positionedNodes.forEach((n) => {
    maxX = Math.max(maxX, n.position.x + NODE_METRICS.width + PADDING);
    maxY = Math.max(maxY, n.position.y + NODE_METRICS.collapsedHeight + PADDING);
  });
  containerFrames.forEach((f) => {
    maxX = Math.max(maxX, f.position.x + f.size.width + PADDING);
    maxY = Math.max(maxY, f.position.y + f.size.height + PADDING);
  });

  return {
    positionedNodes,
    containerFrames,
    canvasSize: { width: maxX, height: maxY }
  };
}

function containerBadge(
  container: MonitorContainer,
  positionedNodes: PositionedMonitorNode[]
): string | null {
  const childPathIds = container.regions.flatMap((r) => r.pathIds);
  const children = childPathIds
    .map((pathId) => positionedNodes.find((n) => n.pathId === pathId))
    .filter(Boolean) as PositionedMonitorNode[];
  const running = children.filter((n) => n.status === NodeStatus.RUNNING);
  const succeeded = children.filter((n) => n.status === NodeStatus.SUCCEEDED);
  if (running.length > 0) {
    if (container.type === "parallel") {
      const idx = container.regions.findIndex((r) =>
        r.pathIds.some((id) => running.some((n) => n.pathId === id))
      );
      return idx >= 0 ? `Branch ${idx + 1}: running` : "running";
    }
    return "running";
  }
  if (container.type === "repeat" && children.length > 0 && succeeded.length === children.length) {
    return "done";
  }
  return null;
}

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
  viewJson,
  monitorGraph,
  onScrollToNode
}: DagViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Status map from API nodeStates (by apiStateName for monitor graph, by stateName for flat)
  const statusByApiStateName = useMemo(() => {
    const map = new Map<string, { status: NodeStatus; durationMs: number | null }>();
    nodeStates.forEach((n) => {
      map.set(n.stateName, { status: n.status, durationMs: n.durationMs });
    });
    return map;
  }, [nodeStates]);

  // --- Monitor graph mode (containers + nested nodes) ---
  const monitorLayout = useMemo(() => {
    if (!monitorGraph) return null;
    return computeMonitorLayout(monitorGraph, statusByApiStateName);
  }, [monitorGraph, statusByApiStateName]);

  // --- Flat mode (no containers) ---
  const dagNodes = useMemo<DagNode[]>(() => {
    return nodeStates.map((node) => ({
      id: node.stateName,
      name: node.nodeName,
      stateName: node.stateName,
      status: node.status,
      durationMs: node.durationMs,
      position: { x: 0, y: 0 }
    }));
  }, [nodeStates]);

  const nodePositions = useMemo(() => {
    return computeAutoLayout(dagNodes, edges);
  }, [dagNodes, edges]);

  const positionedNodesFlat = useMemo(() => {
    return dagNodes.map((node, index) => {
      const position = nodePositions.get(node.id);
      if (!position) {
        return {
          ...node,
          position: {
            x: PADDING + (index % 3) * SPACING_X,
            y: PADDING + Math.floor(index / 3) * (NODE_METRICS.collapsedHeight + ROW_GAP)
          }
        };
      }
      return { ...node, position };
    });
  }, [dagNodes, nodePositions]);

  const canvasSizeFlat = useMemo(() => {
    if (positionedNodesFlat.length === 0) return CANVAS_DEFAULT;
    let maxX = CANVAS_DEFAULT.width;
    let maxY = CANVAS_DEFAULT.height;
    positionedNodesFlat.forEach((node) => {
      maxX = Math.max(maxX, node.position.x + NODE_METRICS.width + PADDING);
      maxY = Math.max(maxY, node.position.y + NODE_METRICS.collapsedHeight + PADDING);
    });
    return { width: maxX, height: maxY };
  }, [positionedNodesFlat]);

  const edgesToRenderFlat = useMemo(() => {
    if (edges.length === 0) return [];
    return edges.filter((edge) => {
      const fromNode = positionedNodesFlat.find((n) => n.id === edge.from);
      const toNode = positionedNodesFlat.find((n) => n.id === edge.to);
      return Boolean(fromNode && toNode);
    });
  }, [edges, positionedNodesFlat]);

  const useGraphMode = Boolean(monitorGraph && monitorLayout);
  const canvasSize = useGraphMode ? monitorLayout!.canvasSize : canvasSizeFlat;

  const runningNode = useMemo(() => {
    if (useGraphMode && monitorLayout) {
      return monitorLayout.positionedNodes.find((n) => n.status === NodeStatus.RUNNING);
    }
    return positionedNodesFlat.find((node) => node.status === NodeStatus.RUNNING);
  }, [useGraphMode, monitorLayout, positionedNodesFlat]);

  const scrollToNode = useCallback(
    (pathIdOrStateName: string) => {
      if (!containerRef.current) return;
      const el = containerRef.current.querySelector(
        `[data-node-id="${pathIdOrStateName}"]`
      ) as HTMLElement;
      if (el) {
        const container = containerRef.current;
        const containerRect = container.getBoundingClientRect();
        const nodeRect = el.getBoundingClientRect();
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
        container.scrollTo({ left: scrollLeft, top: scrollTop, behavior: "smooth" });
      }
      onScrollToNode?.(pathIdOrStateName);
    },
    [onScrollToNode]
  );

  useEffect(() => {
    if (!runningNode || runStatus !== RunStatus.RUNNING) return;
    const id = useGraphMode ? (runningNode as PositionedMonitorNode).pathId : (runningNode as DagNode).id;
    onSelectNode(id);
    scrollToNode(id);
  }, [runningNode, runStatus, onSelectNode, useGraphMode, scrollToNode]);

  useEffect(() => {
    if (selectedNode) scrollToNode(selectedNode);
  }, [selectedNode, scrollToNode]);

  if (nodeStates.length === 0 && !monitorGraph?.nodes.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No nodes available
      </div>
    );
  }

  // --- Render: Monitor graph mode (containers + nested) ---
  if (useGraphMode && monitorLayout) {
    const { positionedNodes, containerFrames } = monitorLayout;
    const edgesToRenderGraph = monitorGraph.edges.filter((e) => {
      const fromExists = positionedNodes.some((n) => n.pathId === e.from);
      const toExists = positionedNodes.some((n) => n.pathId === e.to);
      return fromExists && toExists;
    });

    return (
      <div
        ref={containerRef}
        className="relative w-full overflow-auto rounded-lg border border-slate-200 bg-slate-50"
        style={{ height: "100%", minHeight: canvasSize.height }}
      >
        <svg
          className="absolute pointer-events-none"
          width={canvasSize.width}
          height={canvasSize.height}
          style={{ top: 0, left: 0, zIndex: 0 }}
        >
          <defs>
            <marker id="arrow-monitor" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />
            </marker>
          </defs>
          {edgesToRenderGraph.map((edge) => {
            const fromNode = positionedNodes.find((n) => n.pathId === edge.from);
            const toNode = positionedNodes.find((n) => n.pathId === edge.to);
            if (!fromNode || !toNode) return null;
            const start = {
              x: fromNode.position.x + NODE_METRICS.width,
              y: fromNode.position.y + NODE_METRICS.collapsedHeight / 2
            };
            const end = {
              x: toNode.position.x,
              y: toNode.position.y + NODE_METRICS.collapsedHeight / 2
            };
            const curve = Math.max(60, Math.abs(end.x - start.x) / 2);
            const c1x = start.x + (end.x >= start.x ? curve : -curve);
            const c2x = end.x + (end.x >= start.x ? -curve : curve);
            const d = `M ${start.x} ${start.y} C ${c1x} ${start.y}, ${c2x} ${end.y}, ${end.x} ${end.y}`;
            return (
              <path key={edge.id} d={d} stroke="#94a3b8" strokeWidth="2" fill="none" markerEnd="url(#arrow-monitor)" />
            );
          })}
        </svg>

        {containerFrames.map((frame) => (
          <ContainerFrame
            key={frame.container.pathId}
            id={frame.container.pathId}
            label={frame.container.label}
            position={frame.position}
            size={frame.size}
            headerHeight={frame.headerHeight}
            regions={frame.regions}
            readOnly
            badgeLabel={containerBadge(frame.container, positionedNodes)}
          />
        ))}

        {positionedNodes.map((node) => {
          const nodeTypeInfo = getNodeTypeInfo(node.nodeName, node.stateName);
          const isRunning = node.status === NodeStatus.RUNNING;
          const isCompleted = node.status === NodeStatus.SUCCEEDED;
          const isWaiting = node.status === NodeStatus.WAITING;
          const isSelected = selectedNode === node.pathId;

          return (
            <div
              key={node.pathId}
              data-node-id={node.pathId}
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
                onClick={() => onSelectNode(node.pathId)}
                className={cn(
                  "cursor-pointer relative w-full rounded-lg border-2 p-3 text-left text-sm font-medium transition-all overflow-hidden",
                  NODE_STATUS_STYLE_MAP[node.status],
                  isSelected ? "ring-4 ring-slate-400 ring-offset-2" : "hover:shadow-lg"
                )}
              >
                <div className={cn("absolute left-0 top-0 bottom-0 w-1", nodeTypeInfo.colors.indicator)} />
                <div className="flex items-start justify-between pl-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p
                        className={cn(
                          "font-semibold truncate",
                          isRunning ? "text-blue-900" : isCompleted ? "text-green-900" : isWaiting ? "text-amber-900" : "text-slate-800"
                        )}
                      >
                        {node.nodeName}
                      </p>
                    </div>
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
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
                          </span>
                          Running
                        </span>
                      )}
                      {isWaiting && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700">Waiting</span>}
                      {isCompleted && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700">✓ Completed</span>}
                    </div>
                    <p className={cn("text-xs truncate", isRunning ? "text-blue-700" : isCompleted ? "text-green-700" : isWaiting ? "text-amber-700" : "text-slate-600")}>
                      {node.stateName}
                    </p>
                    {node.durationMs !== null && (
                      <p className="mt-1 text-xs font-medium text-slate-700">⏱ {formatDuration(node.durationMs)}</p>
                    )}
                  </div>
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

  // --- Render: Flat mode (no containers) ---
  const positionedNodes = positionedNodesFlat;
  const edgesToRender = edgesToRenderFlat;

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
                "cursor-pointer relative w-full rounded-lg border-2 p-3 text-left text-sm font-medium transition-all overflow-hidden",
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
