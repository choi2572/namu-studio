import type { ContainerFrameRegion } from "@/components/ContainerFrame";
import {
  CANVAS_DEFAULT,
  CANVAS_PADDING,
  CONTAINER_FRAME_DEFAULTS,
  CONTAINER_FRAME_METRICS,
  CONTAINER_LAYOUT,
  CONTAINER_TYPE_BY_KIND,
  DEFAULT_PARALLEL_BRANCHES,
  NODE_METRICS,
  RIBBON_EXTRA_HEIGHT
} from "./editorConstants";
import { getNodeHeight } from "./editorNodeLayout";
import type {
  ContainerFrameData,
  ContainerType,
  EditorEdge,
  EditorNode,
  NodeKind,
  NodeTypeConfig
} from "./editorTypes";

export function getContainerType(kind: NodeKind): ContainerType | null {
  return CONTAINER_TYPE_BY_KIND[kind] ?? null;
}

export function isContainerNode(node: EditorNode) {
  return getContainerType(node.kind) !== null;
}

export function getRepeatCount(node: EditorNode) {
  const raw = node.params.count ?? "1";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export function getContainerBranchCount(node: EditorNode) {
  const containerType = getContainerType(node.kind);
  if (containerType !== "parallel") return 1;
  const requested = node.containerFrame?.branchCount ?? DEFAULT_PARALLEL_BRANCHES;
  return Math.max(DEFAULT_PARALLEL_BRANCHES, requested);
}

export function getContainerHeaderLabel(node: EditorNode, branchCount: number) {
  const containerType = getContainerType(node.kind);
  if (containerType === "repeat") {
    return `Repeat x${getRepeatCount(node)}`;
  }
  if (containerType === "parallel") {
    return branchCount > 2 ? `Parallel (${branchCount})` : "Parallel";
  }
  return node.name;
}

export function getContainerBranchLabel(containerType: ContainerType, index: number) {
  if (containerType === "repeat") {
    return "Body";
  }
  return `Branch ${index + 1}`;
}

export function getDefaultContainerFrameSize(containerType: ContainerType, branchCount: number) {
  const baseWidth =
    containerType === "parallel"
      ? Math.max(CONTAINER_FRAME_DEFAULTS.width, branchCount * CONTAINER_FRAME_DEFAULTS.branchWidth)
      : CONTAINER_FRAME_DEFAULTS.width;
  return {
    width: Math.max(baseWidth, CONTAINER_FRAME_METRICS.minWidth),
    height: Math.max(CONTAINER_FRAME_DEFAULTS.height, CONTAINER_FRAME_METRICS.minHeight)
  };
}

export function getContainerFrameLayout(
  node: EditorNode,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  const containerType = getContainerType(node.kind);
  if (!containerType) return null;
  const branchCount = getContainerBranchCount(node);
  const defaults = getDefaultContainerFrameSize(containerType, branchCount);
  const frameWidth = Math.max(
    node.containerFrame?.width ?? defaults.width,
    CONTAINER_FRAME_METRICS.minWidth
  );
  const frameHeight = Math.max(
    node.containerFrame?.height ?? defaults.height,
    CONTAINER_FRAME_METRICS.minHeight
  );
  // 컨테이너 노드 자체에 START/END 리본이 붙는 경우를 감안해서 여유 높이 추가
  const nodeHeight = getNodeHeight(node, nodeTypeConfig) + RIBBON_EXTRA_HEIGHT;
  const frameX = node.position.x;
  const frameY = node.position.y + nodeHeight + CONTAINER_FRAME_METRICS.offsetY;
  const headerHeight = CONTAINER_FRAME_METRICS.headerHeight;
  const bodyX = frameX + CONTAINER_FRAME_METRICS.padding;
  const bodyY = frameY + headerHeight + CONTAINER_FRAME_METRICS.padding;
  const bodyWidth = Math.max(0, frameWidth - CONTAINER_FRAME_METRICS.padding * 2);
  const bodyHeight = Math.max(0, frameHeight - headerHeight - CONTAINER_FRAME_METRICS.padding * 2);
  // Repeat: 단일 body 영역, Parallel: 브랜치를 세로로 스택 배치
  const regions: ContainerFrameRegion[] =
    branchCount > 0
      ? Array.from({ length: branchCount }, (_, index) => {
          const isParallel = containerType === "parallel";
          const regionHeight = isParallel ? bodyHeight / branchCount : bodyHeight;
          return {
            index,
            label: getContainerBranchLabel(containerType, index),
            bounds: {
              x: bodyX,
              y: isParallel ? bodyY + regionHeight * index : bodyY,
              width: bodyWidth,
              height: isParallel ? regionHeight : bodyHeight
            }
          };
        })
      : [];
  return {
    frame: { x: frameX, y: frameY, width: frameWidth, height: frameHeight },
    headerHeight,
    regions
  };
}

export function getCanvasBounds(canvasBase: { width: number; height: number }, nodeHeight: number) {
  const minX = CANVAS_PADDING.x;
  const minY = CANVAS_PADDING.y;
  const maxX = Math.max(minX, canvasBase.width - NODE_METRICS.width - CANVAS_PADDING.x);
  const maxY = Math.max(minY, canvasBase.height - nodeHeight - CANVAS_PADDING.y);
  return { minX, minY, maxX, maxY };
}
export function getContainerTypeById(nodes: EditorNode[]) {
  const map = new Map<string, ContainerType>();
  nodes.forEach((node) => {
    const type = getContainerType(node.kind);
    if (type) {
      map.set(node.id, type);
    }
  });
  return map;
}

export function getNodeContainerKey(
  node: EditorNode,
  containerTypeById: Map<string, ContainerType>
) {
  const containerId = node.containerId;
  if (!containerId) return null;
  const containerType = node.containerType ?? containerTypeById.get(containerId);
  if (!containerType) return null;
  if (containerType === "parallel") {
    const branchIndex = node.branchIndex ?? 0;
    return `${containerId}:branch:${branchIndex}`;
  }
  return `${containerId}:body`;
}

export function filterEdgesByContainerRules(nodes: EditorNode[], edges: EditorEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const containerTypeById = getContainerTypeById(nodes);
  return edges.filter((edge) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) return false;
    const fromKey = getNodeContainerKey(fromNode, containerTypeById);
    const toKey = getNodeContainerKey(toNode, containerTypeById);
    if (!fromKey && !toKey) return true;
    return fromKey !== null && fromKey === toKey;
  });
}

export function normalizeContainerAssignments(nodes: EditorNode[]) {
  const containerTypeById = getContainerTypeById(nodes);
  return nodes.map((node) => {
    if (!node.containerId) return node;
    const containerType = node.containerType ?? containerTypeById.get(node.containerId);
    if (!containerType) {
      return {
        ...node,
        containerId: null,
        containerType: null,
        branchIndex: null
      };
    }
    const branchIndex =
      containerType === "parallel"
        ? typeof node.branchIndex === "number"
          ? node.branchIndex
          : 0
        : null;
    return {
      ...node,
      containerType,
      branchIndex
    };
  });
}

export function normalizeContainerFrames(nodes: EditorNode[]) {
  return nodes.map((node) => {
    const containerType = getContainerType(node.kind);
    if (!containerType) return node;
    const branchCount = containerType === "parallel" ? getContainerBranchCount(node) : 1;
    const defaults = getDefaultContainerFrameSize(containerType, branchCount);
    const width = node.containerFrame?.width ?? defaults.width;
    const height = node.containerFrame?.height ?? defaults.height;
    const nextFrame: ContainerFrameData = {
      width,
      height,
      ...(containerType === "parallel" ? { branchCount } : {})
    };
    if (
      node.containerFrame &&
      node.containerFrame.width === nextFrame.width &&
      node.containerFrame.height === nextFrame.height &&
      node.containerFrame.branchCount === nextFrame.branchCount
    ) {
      return node;
    }
    return { ...node, containerFrame: nextFrame };
  });
}

export function getTopologicalOrder(nodes: EditorNode[], edges: EditorEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = nodes.map((node) => node.id);
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  nodeIds.forEach((id) => {
    inDegree.set(id, 0);
    outgoing.set(id, []);
  });

  edges.forEach((edge) => {
    if (!inDegree.has(edge.to) || !outgoing.has(edge.from)) return;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });

  const queue = nodeIds
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .sort((a, b) => (nodeMap.get(a)?.name ?? "").localeCompare(nodeMap.get(b)?.name ?? ""));
  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    ordered.push(current);
    outgoing.get(current)?.forEach((to) => {
      inDegree.set(to, (inDegree.get(to) ?? 0) - 1);
      if (inDegree.get(to) === 0) {
        queue.push(to);
        queue.sort((a, b) =>
          (nodeMap.get(a)?.name ?? "").localeCompare(nodeMap.get(b)?.name ?? "")
        );
      }
    });
  }

  const remaining = nodeIds.filter((id) => !ordered.includes(id));
  if (remaining.length > 0) {
    remaining.sort((a, b) =>
      (nodeMap.get(a)?.name ?? "").localeCompare(nodeMap.get(b)?.name ?? "")
    );
  }
  return [...ordered, ...remaining];
}

export function layoutNodesByLayers(
  nodes: EditorNode[],
  edges: EditorEdge[],
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  options: { padding: number; spacingX: number; rowGap: number }
) {
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

  const grouped = new Map<number, EditorNode[]>();
  nodes.forEach((node) => {
    const layer = layers.get(node.id) ?? 0;
    const group = grouped.get(layer) ?? [];
    group.push(node);
    grouped.set(layer, group);
  });

  Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([layer, group]) => {
      const sortedGroup = [...group].sort((a, b) => a.name.localeCompare(b.name));
      let yCursor = options.padding;
      sortedGroup.forEach((node) => {
        const nodeHeight = getNodeHeight(node, nodeTypeConfig);
        const x = options.padding + layer * options.spacingX;
        const y = yCursor;
        yCursor += nodeHeight + options.rowGap;
        positions.set(node.id, { x, y });
      });
    });

  return positions;
}

export function layoutNodesInRegion(
  nodes: EditorNode[],
  edges: EditorEdge[],
  region: ContainerFrameRegion,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  direction: "vertical" | "horizontal"
) {
  const positions = new Map<string, { x: number; y: number }>();
  const ordered = getTopologicalOrder(nodes, edges);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  let yCursor = region.bounds.y + CONTAINER_LAYOUT.padding;
  let xCursor = region.bounds.x + CONTAINER_LAYOUT.padding;
  const anchorY = yCursor;
  const anchorX = xCursor;
  ordered.forEach((id) => {
    const node = nodeMap.get(id);
    if (!node) return;
    if (direction === "horizontal") {
      positions.set(id, { x: xCursor, y: anchorY });
      xCursor += NODE_METRICS.width + CONTAINER_LAYOUT.columnGap;
      return;
    }
    positions.set(id, { x: anchorX, y: yCursor });
    yCursor += getNodeHeight(node, nodeTypeConfig) + CONTAINER_LAYOUT.rowGap;
  });
  return positions;
}

export function expandContainerFrameForNodes(containerNode: EditorNode, nodes: EditorNode[]) {
  const containerType = getContainerType(containerNode.kind);
  if (!containerType) return containerNode;
  const branchCount = containerType === "parallel" ? getContainerBranchCount(containerNode) : 1;
  const branchCounts = Array.from({ length: branchCount }, (_, index) => {
    if (containerType === "repeat") {
      return nodes.filter((node) => node.containerId === containerNode.id).length;
    }
    return nodes.filter(
      (node) => node.containerId === containerNode.id && (node.branchIndex ?? 0) === index
    ).length;
  });
  const maxNodes = Math.max(1, ...branchCounts);
  // START/END 리본이 있는 노드를 고려한 카드의 실질 높이
  const nodeVisualHeight = NODE_METRICS.collapsedHeight + RIBBON_EXTRA_HEIGHT;
  let requiredWidth = CONTAINER_FRAME_DEFAULTS.width;
  let requiredHeight =
    CONTAINER_FRAME_METRICS.headerHeight +
    CONTAINER_FRAME_METRICS.padding * 2 +
    maxNodes * (nodeVisualHeight + CONTAINER_LAYOUT.rowGap) -
    CONTAINER_LAYOUT.rowGap +
    CONTAINER_LAYOUT.padding;

  if (containerType === "repeat") {
    // Repeat body: 노드 가로 배치 → 폭은 노드 수에 비례, 높이는 한 줄
    requiredWidth = Math.max(
      CONTAINER_FRAME_DEFAULTS.width,
      CONTAINER_FRAME_METRICS.padding * 2 +
        maxNodes * (NODE_METRICS.width + CONTAINER_LAYOUT.columnGap) -
        CONTAINER_LAYOUT.columnGap +
        CONTAINER_LAYOUT.padding
    );
    requiredHeight =
      CONTAINER_FRAME_METRICS.headerHeight +
      CONTAINER_FRAME_METRICS.padding * 2 +
      nodeVisualHeight +
      CONTAINER_LAYOUT.padding;
  } else if (containerType === "parallel") {
    // Parallel: 브랜치는 세로 스택, 각 브랜치 안에서 노드들은 가로로 배치.
    // - 가로(width): 어떤 브랜치든 가장 많은 노드 수 기준으로 계산
    // - 세로(height): 브랜치 수 * 노드 높이 (+ 브랜치 간 rowGap)
    const perBranchWidth =
      CONTAINER_FRAME_METRICS.padding * 2 +
      maxNodes * (NODE_METRICS.width + CONTAINER_LAYOUT.columnGap) -
      CONTAINER_LAYOUT.columnGap +
      // 브랜치 우측에 여유 공간
      CONTAINER_LAYOUT.padding;
    requiredWidth = Math.max(CONTAINER_FRAME_DEFAULTS.width, perBranchWidth);

    const baseHeightForBranches =
      branchCount * nodeVisualHeight +
      Math.max(0, branchCount - 1) * CONTAINER_LAYOUT.rowGap +
      // 마지막 브랜치 하단 여유
      CONTAINER_LAYOUT.padding;
    requiredHeight =
      CONTAINER_FRAME_METRICS.headerHeight +
      CONTAINER_FRAME_METRICS.padding * 2 +
      baseHeightForBranches;
  }

  const nextFrame: ContainerFrameData = {
    width: Math.max(requiredWidth, CONTAINER_FRAME_METRICS.minWidth),
    height: Math.max(requiredHeight, CONTAINER_FRAME_METRICS.minHeight),
    ...(containerType === "parallel" ? { branchCount } : {})
  };
  return { ...containerNode, containerFrame: nextFrame };
}

export function applyImportedLayout(
  nodes: EditorNode[],
  edges: EditorEdge[],
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  let nextNodes = normalizeContainerFrames(normalizeContainerAssignments(nodes));
  const containerTypeById = getContainerTypeById(nextNodes);
  const containerIds = new Set(containerTypeById.keys());
  nextNodes = nextNodes.map((node) =>
    isContainerNode(node) ? expandContainerFrameForNodes(node, nextNodes) : node
  );

  const topLevelNodes = nextNodes.filter(
    (node) => !node.containerId || !containerIds.has(node.containerId)
  );
  const topLevelNodeIds = new Set(topLevelNodes.map((node) => node.id));
  const topLevelEdges = edges.filter(
    (edge) => topLevelNodeIds.has(edge.from) && topLevelNodeIds.has(edge.to)
  );
  const topLevelPositions = layoutNodesByLayers(topLevelNodes, topLevelEdges, nodeTypeConfig, {
    padding: 80,
    spacingX: 320,
    rowGap: 60
  });

  nextNodes = nextNodes.map((node) => {
    if (topLevelPositions.has(node.id)) {
      return { ...node, position: topLevelPositions.get(node.id)! };
    }
    return node;
  });

  containerIds.forEach((containerId) => {
    const containerNode = nextNodes.find((node) => node.id === containerId);
    if (!containerNode) return;
    const layout = getContainerFrameLayout(containerNode, nodeTypeConfig);
    if (!layout) return;
    const containerType = getContainerType(containerNode.kind);
    if (!containerType) return;
    if (containerType === "repeat") {
      const bodyNodes = nextNodes.filter((node) => node.containerId === containerId);
      const bodyNodeIds = new Set(bodyNodes.map((node) => node.id));
      const bodyEdges = edges.filter(
        (edge) => bodyNodeIds.has(edge.from) && bodyNodeIds.has(edge.to)
      );
      const positions = layoutNodesInRegion(
        bodyNodes,
        bodyEdges,
        layout.regions[0],
        nodeTypeConfig,
        "horizontal"
      );
      nextNodes = nextNodes.map((node) =>
        positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node
      );
      return;
    }
    layout.regions.forEach((region) => {
      const branchNodes = nextNodes.filter(
        (node) => node.containerId === containerId && (node.branchIndex ?? 0) === region.index
      );
      const branchNodeIds = new Set(branchNodes.map((node) => node.id));
      const branchEdges = edges.filter(
        (edge) => branchNodeIds.has(edge.from) && branchNodeIds.has(edge.to)
      );
      const positions = layoutNodesInRegion(
        branchNodes,
        branchEdges,
        region,
        nodeTypeConfig,
        "horizontal"
      );
      nextNodes = nextNodes.map((node) =>
        positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node
      );
    });
  });

  return nextNodes;
}

export function getCanvasSizeForNodes(
  nodes: EditorNode[],
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  heightMap?: Map<string, number>
) {
  let maxX = CANVAS_DEFAULT.width;
  let maxY = CANVAS_DEFAULT.height;
  nodes.forEach((node) => {
    const nodeHeight = heightMap?.get(node.id) ?? getNodeHeight(node, nodeTypeConfig);
    maxX = Math.max(maxX, node.position.x + NODE_METRICS.width + CANVAS_PADDING.x);
    maxY = Math.max(maxY, node.position.y + nodeHeight + CANVAS_PADDING.y);
    if (isContainerNode(node)) {
      const layout = getContainerFrameLayout(node, nodeTypeConfig);
      if (layout) {
        maxX = Math.max(maxX, layout.frame.x + layout.frame.width + CANVAS_PADDING.x);
        maxY = Math.max(maxY, layout.frame.y + layout.frame.height + CANVAS_PADDING.y);
      }
    }
  });
  return { width: maxX, height: maxY };
}
