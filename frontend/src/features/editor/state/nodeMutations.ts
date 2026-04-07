import { CONTAINER_TYPE_BY_KIND } from "../editorConstants";
import { getRetryScopeStartNodeId } from "../editorRetryScope";
import type { EditorEdge, EditorNode, NodeKind, NodeTypeConfig } from "../editorTypes";

export type RecomputeRetryScopeMembershipFn = (
  prevNodes: EditorNode[],
  retryNodeId: string,
  scopeType: "main" | "failure",
  edges: EditorEdge[]
) => EditorNode[];

type StartEndBadge = {
  showStart: boolean;
  showEnd: boolean;
  isRootScope: boolean;
  startError?: string;
};

function isContainerNode(node: EditorNode): boolean {
  return CONTAINER_TYPE_BY_KIND[node.kind] != null;
}

export function applyParamChangeToNodes(
  prev: EditorNode[],
  nodeId: string,
  key: string,
  value: string,
  edges: EditorEdge[],
  recomputeRetryScopeMembership: RecomputeRetryScopeMembershipFn
): EditorNode[] {
  const retryNode = prev.find((n) => n.id === nodeId);
  const isRetryNode = retryNode?.kind === "flow_control.retry";
  const isRetryTurningOffFailure =
    isRetryNode && key === "onFailureEnabled" && value === "false";

  let nextNodes = prev.map((node) => {
    if (node.id === nodeId) {
      return { ...node, params: { ...node.params, [key]: value } };
    }
    if (
      isRetryTurningOffFailure &&
      node.retryOwnerId === nodeId &&
      node.retryScopeType === "failure"
    ) {
      return {
        ...node,
        retryOwnerId: null,
        retryScopeType: null,
        isRetryScopeEnd: false
      };
    }
    return node;
  });

  if (isRetryNode && (key === "mainScopeEndId" || key === "failureScopeEndId")) {
    const scopeType = key === "mainScopeEndId" ? "main" : "failure";
    nextNodes = recomputeRetryScopeMembership(nextNodes, nodeId, scopeType, edges);
  }

  return nextNodes;
}

export function applyRetryScopeEndChangeToNodes(
  nodes: EditorNode[],
  nodeId: string,
  checked: boolean,
  edges: EditorEdge[],
  isForbiddenInRetryScope: (kind: NodeKind) => boolean
): EditorNode[] {
  const node = nodes.find((n) => n.id === nodeId);
  const ownerId = node?.retryOwnerId;
  const scopeType = node?.retryScopeType;
  if (!ownerId || !scopeType) return nodes;
  const edgesLocal = edges;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, { to: string }>();
  edgesLocal.forEach((e) => {
    if (nodeMap.has(e.from) && nodeMap.has(e.to)) outEdges.set(e.from, { to: e.to });
  });
  const downstreamIds = new Set<string>();
  let current: string | null = nodeId;
  while (current) {
    const nextId: string | undefined = outEdges.get(current)?.to;
    if (!nextId) break;
    const nextNode = nodeMap.get(nextId);
    if (!nextNode || nextNode.retryOwnerId !== ownerId || nextNode.retryScopeType !== scopeType)
      break;
    downstreamIds.add(nextId);
    current = nextId;
  }
  let nextNodeIdToAdd: string | null = null;
  if (!checked) {
    const immediateNextId = outEdges.get(nodeId)?.to ?? null;
    if (immediateNextId) {
      const immediateNext = nodeMap.get(immediateNextId);
      const alreadyInScope =
        immediateNext?.retryOwnerId === ownerId && immediateNext?.retryScopeType === scopeType;
      if (!alreadyInScope && immediateNext && !isForbiddenInRetryScope(immediateNext.kind))
        nextNodeIdToAdd = immediateNextId;
    }
  }
  return nodes.map((n) => {
    if (n.id === nodeId) return { ...n, isRetryScopeEnd: checked };
    if (checked && downstreamIds.has(n.id))
      return { ...n, retryOwnerId: null, retryScopeType: null, isRetryScopeEnd: false };
    if (
      checked &&
      n.retryOwnerId === ownerId &&
      n.retryScopeType === scopeType &&
      n.isRetryScopeEnd
    )
      return { ...n, isRetryScopeEnd: false };
    if (!checked && nextNodeIdToAdd && n.id === nextNodeIdToAdd)
      return {
        ...n,
        retryOwnerId: ownerId,
        retryScopeType: scopeType,
        isRetryScopeEnd: true
      };
    return n;
  });
}

export function applyNameChangeToNodes(
  prev: EditorNode[],
  nodeId: string,
  value: string
): EditorNode[] {
  return prev.map((node) =>
    node.id === nodeId ? { ...node, name: value } : node
  );
}

export function mapNodesForToggleExpand(
  prev: EditorNode[],
  nodeId: string,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  canvasBase: { width: number; height: number },
  startEndBadges: Map<string, StartEndBadge>,
  getCanvasBounds: (
    canvasBase: { width: number; height: number },
    nodeHeight: number
  ) => { minX: number; minY: number; maxX: number; maxY: number },
  clamp: (value: number, min: number, max: number) => number,
  getEffectiveNodeHeight: (
    node: EditorNode,
    nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
    hasRibbon: boolean
  ) => number
): EditorNode[] {
  return prev.map((node) => {
    if (node.id !== nodeId) return node;
    const nextExpanded = !node.isExpanded;
    const nextNode = { ...node, isExpanded: nextExpanded };
    const hasRibbon = Boolean(
      startEndBadges.get(node.id)?.showStart || startEndBadges.get(node.id)?.showEnd
    );
    const nodeHeight = getEffectiveNodeHeight(nextNode, nodeTypeConfig, hasRibbon);
    const { minX, minY, maxX, maxY } = getCanvasBounds(canvasBase, nodeHeight);
    return {
      ...nextNode,
      position: {
        x: clamp(node.position.x, minX, maxX),
        y: clamp(node.position.y, minY, maxY)
      }
    };
  });
}

export function reduceMainGraphNodesAfterDelete(
  prev: EditorNode[],
  nodeId: string,
  edges: EditorEdge[]
): EditorNode[] {
  const trimmedEdgesForDelete = edges.filter(
    (e) => e.from !== nodeId && e.to !== nodeId
  );
  const isContainer = prev.some(
    (node) => node.id === nodeId && isContainerNode(node)
  );
  const isRetryNode = prev.some(
    (node) => node.id === nodeId && node.kind === "flow_control.retry"
  );
  const deletedNode = prev.find((n) => n.id === nodeId);
  const deletedInScopeOwnerId = deletedNode?.retryOwnerId ?? null;
  const deletedInScopeType = deletedNode?.retryScopeType ?? null;

  let nextNodes = prev
    .filter((node) => node.id !== nodeId)
    .map((node) => {
      if (isRetryNode && node.retryOwnerId === nodeId) {
        return {
          ...node,
          retryOwnerId: null,
          retryScopeType: null,
          isRetryScopeEnd: false
        };
      }
      if (!isContainer) return node;
      if (node.containerId !== nodeId) return node;
      return {
        ...node,
        containerId: null,
        containerType: null,
        branchIndex: null
      };
    });

  if (deletedInScopeOwnerId && deletedInScopeType) {
    const startId = getRetryScopeStartNodeId(
      deletedInScopeOwnerId,
      deletedInScopeType,
      trimmedEdgesForDelete
    );
    const reachable = new Set<string>();
    if (startId) {
      const nodeMap = new Map(nextNodes.map((n) => [n.id, n]));
      const outEdges = new Map<string, string>();
      trimmedEdgesForDelete.forEach((e) => {
        if (nodeMap.has(e.from) && nodeMap.has(e.to)) outEdges.set(e.from, e.to);
      });
      let current: string | null = startId;
      while (current) {
        const node = nodeMap.get(current);
        if (
          !node ||
          node.retryOwnerId !== deletedInScopeOwnerId ||
          node.retryScopeType !== deletedInScopeType
        )
          break;
        reachable.add(current);
        if (node.isRetryScopeEnd) break;
        current = outEdges.get(current) ?? null;
      }
    }
    nextNodes = nextNodes.map((n) => {
      if (
        n.retryOwnerId === deletedInScopeOwnerId &&
        n.retryScopeType === deletedInScopeType &&
        !reachable.has(n.id)
      )
        return {
          ...n,
          retryOwnerId: null,
          retryScopeType: null,
          isRetryScopeEnd: false
        };
      return n;
    });
  }

  return nextNodes;
}
