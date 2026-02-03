"use client";

import { useMemo, useEffect, useRef, useCallback } from "react";
import { NodeStateSnapshot } from "@/api/interfaces";
import { NodeStatus, RunStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { ContainerFrame, type ContainerFrameRegion } from "@/components/ContainerFrame";
import type { MonitorGraph, MonitorNode, MonitorEdge, MonitorContainer } from "@/features/monitor/monitorGraph";
import { nodePathId, NODE_PATH } from "@/lib/ids";
import { computeStartEndForScope } from "@/lib/startEndDetection";

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

// Monitor container frame (read-only) — editor와 동일한 구조: 노드 아래에 프레임
const CONTAINER_HEADER_HEIGHT = 28;
const CONTAINER_PADDING = 12;
const CONTAINER_ROW_GAP = 24;
const CONTAINER_NODE_OFFSET_Y = 12; // 노드 카드와 프레임 사이 간격 (editor offsetY)
const CONTAINER_MIN_WIDTH = 280;
const CONTAINER_MIN_HEIGHT = 120;
// Parallel 브랜치 최소 폭 — 브랜치 구분선/라벨이 가려지지 않도록 조금 넉넉하게
const CONTAINER_BRANCH_MIN_WIDTH = 260;
/** Parallel 브랜치 상단 라벨(Branch 1, Branch 2) 영역 높이 — 노드가 라벨을 가리지 않도록 */
const PARALLEL_REGION_LABEL_HEIGHT = 22;
/** Start/End 리본 높이 (pt-6 = 24px) — 영역 높이 계산 시 노드에 반영 */
const RIBBON_HEIGHT = 24;

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

/** Editor view_json 노드 타입 (position, containerId 등으로 pathId 매핑용) */
type ViewNodeLike = {
  id: string;
  name?: string;
  position?: { x: number; y: number };
  containerId?: string | null;
  containerType?: "repeat" | "parallel" | null;
  branchIndex?: number | null;
};

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}

/** Editor와 동일한 stateName 규칙으로 view 노드 id -> stateName 맵 생성 */
function buildStateNameMapFromViewNodes(nodes: ViewNodeLike[]): Map<string, string> {
  const usedNames = new Set<string>();
  const nameMap = new Map<string, string>();
  nodes.forEach((node) => {
    const trimmed = (node.name ?? "").trim();
    const base = trimmed ? trimmed.replace(/[^A-Za-z0-9_]+/g, "_") : node.id;
    const baseName = base || node.id;
    let name = baseName;
    let index = 1;
    while (usedNames.has(name)) {
      name = `${baseName}_${index}`;
      index += 1;
    }
    usedNames.add(name);
    nameMap.set(node.id, name);
  });
  return nameMap;
}

/** Editor view_json에서 pathId -> position 맵 추출 (에디터 auto layout과 동일한 배치 사용) */
export function getPathIdToPositionFromViewJson(
  viewJson: Record<string, unknown> | null | undefined
): Map<string, { x: number; y: number }> | null {
  if (!viewJson || !isRecord(viewJson)) return null;
  const rawNodes = viewJson.nodes;
  if (!Array.isArray(rawNodes)) return null;
  const viewNodes: ViewNodeLike[] = rawNodes.filter(
    (n): n is ViewNodeLike => isRecord(n) && typeof (n as ViewNodeLike).id === "string"
  );
  if (viewNodes.length === 0) return null;
  const stateNameMap = buildStateNameMapFromViewNodes(viewNodes);
  const result = new Map<string, { x: number; y: number }>();
  viewNodes.forEach((node) => {
    const stateName = stateNameMap.get(node.id);
    if (!stateName) return;
    const pos = node.position;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
    const containerId = node.containerId;
    const containerType = node.containerType;
    const branchIndex = node.branchIndex ?? 0;
    let pathId: string;
    if (!containerId) {
      pathId = nodePathId([NODE_PATH.ROOT, stateName]);
    } else {
      const containerStateName = stateNameMap.get(containerId);
      if (!containerStateName) return;
      if (containerType === "repeat") {
        pathId = nodePathId([NODE_PATH.ROOT, containerStateName, NODE_PATH.BODY, stateName]);
      } else {
        pathId = nodePathId([
          NODE_PATH.ROOT,
          containerStateName,
          `${NODE_PATH.BRANCH_PREFIX}${branchIndex}`,
          stateName
        ]);
      }
    }
    result.set(pathId, { x: pos.x, y: pos.y });
  });
  return result;
}

/** Start/End 결과: pathId 기준 (모니터는 pathId 사용) */
function computeMonitorStartEnd(graph: MonitorGraph): {
  startPathIds: Set<string>;
  endPathIds: Set<string>;
} {
  const startPathIds = new Set<string>();
  const endPathIds = new Set<string>();
  const topLevel = graph.nodes.filter((n) => n.containerPathId === null);
  const topPathIds = topLevel.map((n) => n.pathId);
  const topEdges = graph.edges.filter(
    (e) => topPathIds.includes(e.from) && topPathIds.includes(e.to)
  );
  const rootResult = computeStartEndForScope(
    { nodeIds: topPathIds, edges: topEdges.map((e) => ({ from: e.from, to: e.to })) }
  );
  if (rootResult.startNodeId) startPathIds.add(rootResult.startNodeId);
  rootResult.endNodeIds.forEach((id) => endPathIds.add(id));

  graph.containers.forEach((container) => {
    if (container.type === "repeat") {
      const innerPathIds = container.regions.flatMap((r) => r.pathIds);
      const innerEdges = graph.edges.filter(
        (e) => innerPathIds.includes(e.from) && innerPathIds.includes(e.to)
      );
      const scopeResult = computeStartEndForScope({
        nodeIds: innerPathIds,
        edges: innerEdges.map((e) => ({ from: e.from, to: e.to }))
      });
      if (scopeResult.startNodeId) startPathIds.add(scopeResult.startNodeId);
      scopeResult.endNodeIds.forEach((id) => endPathIds.add(id));
      return;
    }
    if (container.type === "parallel") {
      container.regions.forEach((region) => {
        const pathIds = region.pathIds;
        const regionEdges = graph.edges.filter(
          (e) => pathIds.includes(e.from) && pathIds.includes(e.to)
        );
        const scopeResult = computeStartEndForScope({
          nodeIds: pathIds,
          edges: regionEdges.map((e) => ({ from: e.from, to: e.to }))
        });
        if (scopeResult.startNodeId) startPathIds.add(scopeResult.startNodeId);
        scopeResult.endNodeIds.forEach((id) => endPathIds.add(id));
      });
    }
  });
  return { startPathIds, endPathIds };
}

function computeMonitorLayout(
  graph: MonitorGraph,
  statusByApiStateName: Map<string, { status: NodeStatus; durationMs: number | null }>,
  viewPositions?: Map<string, { x: number; y: number }> | null
): {
  positionedNodes: PositionedMonitorNode[];
  containerFrames: ContainerFrameLayout[];
  canvasSize: { width: number; height: number };
  startPathIds: Set<string>;
  endPathIds: Set<string>;
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
  const autoTopPositions = computeAutoLayout(dagNodes, dagEdges);
  const topPositions = new Map<string, { x: number; y: number }>();
  topLevelNodes.forEach((n) => {
    const fromView = viewPositions?.get(n.pathId);
    if (fromView) topPositions.set(n.pathId, fromView);
    else {
      const fromAuto = autoTopPositions.get(n.pathId);
      if (fromAuto) topPositions.set(n.pathId, fromAuto);
    }
  });

  const positionedNodes: PositionedMonitorNode[] = [];
  const containerFrames: ContainerFrameLayout[] = [];
  const frameYOffset = NODE_METRICS.collapsedHeight + CONTAINER_NODE_OFFSET_Y;

  // Start/End 리본 여부는 parallel 영역 높이 계산에 사용 (먼저 계산)
  const { startPathIds, endPathIds } = computeMonitorStartEnd(graph);

  topLevelNodes.forEach((node) => {
    const pos = topPositions.get(node.pathId);
    if (!pos) return;
    const status = statusByApiStateName.get(node.apiStateName)?.status ?? NodeStatus.WAITING;
    const durationMs = statusByApiStateName.get(node.apiStateName)?.durationMs ?? null;

    if (node.isContainer && node.containerType) {
      const container = graph.containers.find((c) => c.pathId === node.pathId);
      if (!container) return;
      const innerNodes = graph.nodes.filter((n) => n.containerPathId === node.pathId);
      const frameX = pos.x;
      const frameY = pos.y + frameYOffset;
      const bodyX = frameX + CONTAINER_PADDING;
      const bodyY = frameY + CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING;

      if (container.type === "repeat") {
        const region = container.regions[0];
        const pathIds = region?.pathIds ?? [];
        const children = pathIds
          .map((pathId) => graph.nodes.find((n) => n.pathId === pathId))
          .filter((n): n is MonitorNode => n != null);
        const bodyWidth = Math.max(
          CONTAINER_MIN_WIDTH - CONTAINER_PADDING * 2,
          NODE_METRICS.width
        );
        let bodyHeight =
          children.length * (NODE_METRICS.collapsedHeight + CONTAINER_ROW_GAP) - CONTAINER_ROW_GAP;
        children.forEach((c) => {
          if (startPathIds.has(c.pathId) || endPathIds.has(c.pathId)) {
            bodyHeight += RIBBON_HEIGHT;
          }
        });
        const frameWidth = bodyWidth + CONTAINER_PADDING * 2;
        const frameHeight =
          CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING * 2 + Math.max(0, bodyHeight);

        positionedNodes.push({
          ...node,
          status,
          durationMs,
          position: pos
        });
        containerFrames.push({
          container,
          position: { x: frameX, y: frameY },
          size: { width: frameWidth, height: Math.max(CONTAINER_MIN_HEIGHT, frameHeight) },
          headerHeight: CONTAINER_HEADER_HEIGHT,
          regions: [
            {
              index: 0,
              label: region?.label ?? "Body",
              bounds: { x: bodyX, y: bodyY, width: bodyWidth, height: Math.max(0, bodyHeight) },
              isEmpty: children.length === 0
            }
          ]
        });
        let yCursor = bodyY;
        children.forEach((child) => {
          const cStatus = statusByApiStateName.get(child.apiStateName)?.status ?? NodeStatus.WAITING;
          const cDuration = statusByApiStateName.get(child.apiStateName)?.durationMs ?? null;
          // 반복 컨테이너 안에서는 에디터 좌표 대신 컨테이너 기준으로 정렬
          const childPos = { x: bodyX, y: yCursor };
          positionedNodes.push({
            ...child,
            status: cStatus,
            durationMs: cDuration,
            position: childPos
          });
          yCursor += NODE_METRICS.collapsedHeight + CONTAINER_ROW_GAP;
        });
      } else {
        const branchCount = container.branchCount || 1;
        const minRegionHeight = PARALLEL_REGION_LABEL_HEIGHT + CONTAINER_PADDING * 2;

        // 각 브랜치별로 독립적인 auto layout 수행 (에디터와 동일한 좌->우 DAG 형태)
        const branchLayouts = container.regions.map((reg) => {
          const pathIds = reg.pathIds;
          const children = pathIds
            .map((pathId) => graph.nodes.find((n) => n.pathId === pathId))
            .filter((n): n is MonitorNode => n != null);

          if (children.length === 0) {
            return {
              pathIds,
              positions: new Map<string, { x: number; y: number }>(),
              minX: 0,
              minY: 0,
              maxX: 0,
              maxY: 0
            };
          }

          const dagNodesBranch: DagNode[] = children.map((c) => ({
            id: c.pathId,
            name: c.nodeName,
            stateName: c.stateName,
            status: statusByApiStateName.get(c.apiStateName)?.status ?? NodeStatus.WAITING,
            durationMs: statusByApiStateName.get(c.apiStateName)?.durationMs ?? null,
            position: { x: 0, y: 0 }
          }));
          const dagEdgesBranch: DagEdge[] = graph.edges
            .filter((e) => pathIds.includes(e.from) && pathIds.includes(e.to))
            .map((e) => ({ id: e.id, from: e.from, to: e.to }));

          const positions = computeAutoLayout(dagNodesBranch, dagEdgesBranch);

          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;

          positions.forEach((p) => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          });

          if (!Number.isFinite(minX)) {
            minX = 0;
            maxX = 0;
          }
          if (!Number.isFinite(minY)) {
            minY = 0;
            maxY = 0;
          }

          return { pathIds, positions, minX, minY, maxX, maxY };
        });

        const bodyWidth = Math.max(
          CONTAINER_BRANCH_MIN_WIDTH,
          NODE_METRICS.width + CONTAINER_PADDING * 2,
          ...branchLayouts.map((layout) =>
            layout.maxX - layout.minX + NODE_METRICS.width + CONTAINER_PADDING * 2
          )
        );

        const regionHeights = branchLayouts.map((layout, idx) => {
          const reg = container.regions[idx];
          if (reg.pathIds.length === 0) {
            return Math.max(minRegionHeight, PARALLEL_REGION_LABEL_HEIGHT + CONTAINER_PADDING * 2);
          }
          let maxBottom = layout.minY;
          reg.pathIds.forEach((pathId) => {
            const local = layout.positions.get(pathId);
            if (!local) return;
            const hasRibbon = startPathIds.has(pathId) || endPathIds.has(pathId);
            const effectiveHeight =
              NODE_METRICS.collapsedHeight + (hasRibbon ? RIBBON_HEIGHT : 0);
            maxBottom = Math.max(maxBottom, local.y + effectiveHeight);
          });
          const contentHeight = maxBottom - layout.minY;
          return Math.max(
            minRegionHeight,
            PARALLEL_REGION_LABEL_HEIGHT + CONTAINER_PADDING * 2 + contentHeight
          );
        });
        const totalBodyHeight = regionHeights.reduce((a, b) => a + b, 0);
        const frameWidth = bodyWidth + CONTAINER_PADDING * 2;
        const frameHeight = CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING * 2 + totalBodyHeight;

        const regions: ContainerFrameRegion[] = container.regions.map((reg, idx) => {
          let regionY = bodyY;
          for (let i = 0; i < idx; i++) regionY += regionHeights[i];
          return {
            index: idx,
            label: reg.label,
            bounds: {
              x: bodyX,
              y: regionY,
              width: bodyWidth,
              height: regionHeights[idx]
            },
            isEmpty: reg.pathIds.length === 0
          };
        });

        positionedNodes.push({
          ...node,
          status,
          durationMs,
          position: pos
        });
        containerFrames.push({
          container,
          position: { x: frameX, y: frameY },
          size: { width: frameWidth, height: frameHeight },
          headerHeight: CONTAINER_HEADER_HEIGHT,
          regions
        });
        container.regions.forEach((reg, idx) => {
          let regionY = bodyY;
          for (let i = 0; i < idx; i++) regionY += regionHeights[i];
          const regionX = bodyX;
          const layout = branchLayouts[idx];

          // 이 브랜치 내 전체 DAG 콘텐츠 폭 (auto layout 기준, padding 제외)
          const contentWidth =
            layout.maxX - layout.minX + NODE_METRICS.width;
          const regionCenterX = regionX + bodyWidth / 2;
          const contentBaseX = regionCenterX - contentWidth / 2;

          reg.pathIds.forEach((pathId) => {
            const child = graph.nodes.find((n) => n.pathId === pathId);
            if (!child) return;
            const cStatus =
              statusByApiStateName.get(child.apiStateName)?.status ?? NodeStatus.WAITING;
            const cDuration =
              statusByApiStateName.get(child.apiStateName)?.durationMs ?? null;
            const local = layout.positions.get(pathId);

            // layout 정보가 없으면 브랜치 중앙에 단순 스택 정렬
            if (!local) {
              const fallbackPos = {
                x: regionCenterX - NODE_METRICS.width / 2,
                y:
                  regionY +
                  PARALLEL_REGION_LABEL_HEIGHT +
                  CONTAINER_PADDING +
                  CONTAINER_ROW_GAP
              };
              positionedNodes.push({
                ...child,
                status: cStatus,
                durationMs: cDuration,
                position: fallbackPos
              });
              return;
            }

            // 브랜치 내부 auto layout 좌표를 브랜치 영역 안 중앙 정렬된 위치로 오프셋
            const childPos = {
              x: contentBaseX + (local.x - layout.minX),
              y:
                regionY +
                PARALLEL_REGION_LABEL_HEIGHT +
                CONTAINER_PADDING +
                (local.y - layout.minY)
            };
            positionedNodes.push({
              ...child,
              status: cStatus,
              durationMs: cDuration,
              position: childPos
            });
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
    canvasSize: { width: maxX, height: maxY },
    startPathIds,
    endPathIds
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

/** DSL Type → 대분류 배지(Skill / Flow Control / Event) + 색상 */
function getNodeTypeInfoFromDsl(
  dslType: string,
  containerType: "repeat" | "parallel" | null
): { type: string; colors: { border: string; bg: string; text: string; indicator: string } } {
  if (containerType === "repeat" || containerType === "parallel") {
    return { type: "Flow Control", colors: NODE_TYPE_COLORS.flow_control };
  }
  const t = dslType ?? "";
  if (t === "Skill") return { type: "Skill", colors: NODE_TYPE_COLORS.skill };
  if (t === "Condition" || t === "Choice" || t === "Repeat" || t === "Parallel") {
    return { type: "Flow Control", colors: NODE_TYPE_COLORS.flow_control };
  }
  if (t === "Wait" || t === "Event") return { type: "Event", colors: NODE_TYPE_COLORS.event };
  return { type: "Flow Control", colors: NODE_TYPE_COLORS.flow_control };
}

/** Flat 모드용: nodeName 기반 추론 (DSL 없을 때) */
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

  // --- Monitor graph mode (containers + nested nodes, editor view_json 레이아웃 사용) ---
  const viewPositions = useMemo(
    () => getPathIdToPositionFromViewJson(viewJson ?? null),
    [viewJson]
  );
  const monitorLayout = useMemo(() => {
    if (!monitorGraph) return null;
    return computeMonitorLayout(monitorGraph, statusByApiStateName, viewPositions);
  }, [monitorGraph, statusByApiStateName, viewPositions]);

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
    const { positionedNodes, containerFrames, startPathIds, endPathIds } = monitorLayout;
    const edgesToRenderGraph = monitorGraph.edges.filter((e) => {
      const fromExists = positionedNodes.some((n) => n.pathId === e.from);
      const toExists = positionedNodes.some((n) => n.pathId === e.to);
      return fromExists && toExists;
    });

    const showStartRibbon = (pathId: string) =>
      startPathIds.has(pathId) && !endPathIds.has(pathId);
    const showEndRibbon = (pathId: string) =>
      endPathIds.has(pathId) && !startPathIds.has(pathId);
    const showStartEndRibbon = (pathId: string) =>
      startPathIds.has(pathId) && endPathIds.has(pathId);

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
          style={{ top: 0, left: 0, zIndex: 5 }}
        >
          <defs>
            <marker id="arrow-monitor" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#64748b" />
            </marker>
            <marker id="arrow-monitor-then" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#059669" />
            </marker>
            <marker id="arrow-monitor-else" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#d97706" />
            </marker>
          </defs>
          {edgesToRenderGraph.map((edge) => {
            const fromNode = positionedNodes.find((n) => n.pathId === edge.from);
            const toNode = positionedNodes.find((n) => n.pathId === edge.to);
            if (!fromNode || !toNode) return null;

            const fromIsCondition = fromNode.dslType === "Condition";
            const isThen = fromIsCondition && edge.conditionBranch === "then";
            const isElse = fromIsCondition && edge.conditionBranch === "else";

            // Condition 노드일 때는 항상 true/false 두 개의 포트를 사용 (에디터와 동일)
            let startY = fromNode.position.y + NODE_METRICS.collapsedHeight / 2;
            if (fromIsCondition) {
              const offsets = getPortOffsets(NODE_METRICS.collapsedHeight, 2);
              const trueOffset = offsets[0];
              const falseOffset = offsets[1] ?? offsets[0];
              const portOffset =
                edge.conditionBranch === "then"
                  ? trueOffset
                  : edge.conditionBranch === "else"
                    ? falseOffset
                    : NODE_METRICS.collapsedHeight / 2;
              startY = fromNode.position.y + portOffset;
            }

            const start = {
              x: fromNode.position.x + NODE_METRICS.width,
              y: startY
            };
            const end = {
              x: toNode.position.x,
              y: toNode.position.y + NODE_METRICS.collapsedHeight / 2
            };
            const curve = Math.max(60, Math.abs(end.x - start.x) / 2);
            const c1x = start.x + (end.x >= start.x ? curve : -curve);
            const c2x = end.x + (end.x >= start.x ? -curve : curve);
            const d = `M ${start.x} ${start.y} C ${c1x} ${start.y}, ${c2x} ${end.y}, ${end.x} ${end.y}`;

            const stroke = isThen ? "#059669" : isElse ? "#d97706" : "#64748b";
            const marker = isThen ? "url(#arrow-monitor-then)" : isElse ? "url(#arrow-monitor-else)" : "url(#arrow-monitor)";
            return (
              <path key={edge.id} d={d} stroke={stroke} strokeWidth="2.25" fill="none" markerEnd={marker} />
            );
          })}
        </svg>

        <div className="absolute" style={{ zIndex: 1 }}>
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
        </div>

        {positionedNodes.map((node) => {
          const nodeTypeInfo = getNodeTypeInfoFromDsl(node.dslType, node.containerType);
          const typeLabel = node.skillName ?? node.dslType;
          const isRunning = node.status === NodeStatus.RUNNING;
          const isCompleted = node.status === NodeStatus.SUCCEEDED;
          const isWaiting = node.status === NodeStatus.WAITING;
          const isSelected = selectedNode === node.pathId;
          const hasStart = showStartRibbon(node.pathId);
          const hasEnd = showEndRibbon(node.pathId);
          const hasStartEnd = showStartEndRibbon(node.pathId);
          const hasRibbon = hasStart || hasEnd || hasStartEnd;
          const isConditionNode = node.dslType === "Condition";
          const outputOffsets = isConditionNode
            ? getPortOffsets(NODE_METRICS.collapsedHeight, 2)
            : getPortOffsets(NODE_METRICS.collapsedHeight, 1);
          const inputOffset = NODE_METRICS.collapsedHeight / 2;

          return (
            <div
              key={node.pathId}
              data-node-id={node.pathId}
              className="absolute overflow-visible"
              style={{
                left: node.position.x,
                top: node.position.y,
                width: NODE_METRICS.width,
                minHeight: NODE_METRICS.collapsedHeight,
                zIndex: 10
              }}
            >
              {/* 입력 포트 (좌측) — 노드 밖으로 반원 보이도록 wrapper 기준 배치 */}
              <div
                className="pointer-events-none absolute left-0 flex items-center justify-center z-10"
                style={{
                  top: inputOffset,
                  transform: "translate(-50%, -50%)"
                }}
              >
                <div className="h-4 w-4 rounded-full border-2 border-slate-600 bg-white shadow-sm" />
              </div>

              {/* 출력 포트(우측) — Condition은 true/false 두 개, 그 외 하나 */}
              {outputOffsets.map((offset, index) => (
                <div
                  key={index}
                  className="pointer-events-none absolute right-0 flex items-center justify-center z-10"
                  style={{
                    top: offset,
                    transform: "translate(50%, -50%)"
                  }}
                >
                  <div className="h-4 w-4 rounded-full border-2 border-slate-600 bg-white shadow-sm" />
                </div>
              ))}

              <button
                type="button"
                onClick={() => onSelectNode(node.pathId)}
                className={cn(
                  "cursor-pointer relative w-full rounded-lg border-2 p-3 text-left text-sm font-medium transition-all overflow-hidden",
                  NODE_STATUS_STYLE_MAP[node.status],
                  isSelected ? "ring-4 ring-slate-400 ring-offset-2" : "hover:shadow-lg"
                )}
              >
                <div
                  className={cn(
                    "relative z-0 flex items-start justify-between pl-3",
                    hasRibbon && "pt-6"
                  )}
                >
                  <div className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l", nodeTypeInfo.colors.indicator)} />
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
                    {typeLabel && typeLabel !== "Pass" && (
                      <p className={cn("text-xs truncate text-slate-500")}>
                        {typeLabel}
                      </p>
                    )}
                    {node.durationMs !== null && (
                      <p className="mt-1 text-xs font-medium text-slate-700">⏱ {formatDuration(node.durationMs)}</p>
                    )}
                  </div>
                  <div className="ml-2 flex-shrink-0">
                    <StatusBadge status={node.status} />
                  </div>
                </div>
                {/* Start/End 리본 — editor와 동일: start+end 동시면 사선 구획, 아니면 단일 색 */}
                {hasRibbon && (
                  <div className="pointer-events-none absolute left-0 right-0 top-0 z-20" aria-hidden>
                    {hasStartEnd ? (
                      <div className="absolute left-0 right-0 top-0 z-10 h-6 overflow-hidden rounded-t-[6px] shadow-sm">
                        <div
                          className="absolute inset-0 bg-emerald-600"
                          style={{ clipPath: "polygon(0 0, 57.14% 0, 42.86% 100%, 0 100%)" }}
                        />
                        <div
                          className="absolute inset-0 bg-slate-500"
                          style={{ clipPath: "polygon(57.14% 0, 100% 0, 100% 100%, 42.86% 100%)" }}
                        />
                        <span className="absolute left-1 top-0.5 text-[9px] font-bold text-white drop-shadow-sm">
                          ▶ START
                        </span>
                        <span className="absolute right-1 bottom-0.5 text-[9px] font-bold text-white drop-shadow-sm">
                          END ⏹
                        </span>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "flex h-6 items-center justify-center rounded-t-[6px] text-[10px] font-bold text-white shadow-sm",
                          hasStart && "bg-emerald-600",
                          hasEnd && "bg-slate-500"
                        )}
                      >
                        {hasStart ? "▶ START" : "⏹ END"}
                      </div>
                    )}
                  </div>
                )}
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
