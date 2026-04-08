import { RETRY_SCOPE_FORBIDDEN_KINDS } from "./editorConstants";
import type { EditorEdge, EditorNode, NodeKind } from "./editorTypes";

/** Retry 스코프(메인/실패)의 시작 노드 id: Retry의 main/failure 포트에서 나간 edge의 to */
export function getRetryScopeStartNodeId(
  retryNodeId: string,
  portKey: "main" | "failure",
  edges: EditorEdge[]
): string | null {
  const edge = edges.find((e) => e.from === retryNodeId && e.fromPort === portKey);
  return edge?.to ?? null;
}

export function isForbiddenInRetryScope(kind: NodeKind): boolean {
  return RETRY_SCOPE_FORBIDDEN_KINDS.includes(kind);
}

export function recomputeRetryScopeMembership(
  prevNodes: EditorNode[],
  retryNodeId: string,
  scopeType: "main" | "failure",
  edges: EditorEdge[]
): EditorNode[] {
  const retryNode = prevNodes.find((n) => n.id === retryNodeId && n.kind === "flow_control.retry");
  if (!retryNode) return prevNodes;

  const endKey = scopeType === "main" ? "mainScopeEndId" : "failureScopeEndId";
  const endId = retryNode.params[endKey] || null;

  const nodeMap = new Map(prevNodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, string>();
  edges.forEach((e) => {
    if (nodeMap.has(e.from) && nodeMap.has(e.to)) {
      outEdges.set(e.from, e.to);
    }
  });

  const startId = getRetryScopeStartNodeId(retryNodeId, scopeType, edges);
  if (!startId) {
    // 시작점이 없으면 해당 스코프 멤버십 전부 제거
    return prevNodes.map((n) =>
      n.retryOwnerId === retryNodeId && n.retryScopeType === scopeType
        ? { ...n, retryOwnerId: null, retryScopeType: null, isRetryScopeEnd: false }
        : n
    );
  }

  const scopeIds = new Set<string>();
  let current: string | null = startId;
  while (current) {
    const node = nodeMap.get(current);
    if (!node) break;
    // flow_control 노드를 만나면 그 전까지만 포함
    if (node.kind.startsWith("flow_control.")) break;
    scopeIds.add(current);
    if (endId && current === endId) break;
    const next: string | null = outEdges.get(current) ?? null;
    if (!next) break;
    current = next;
  }

  return prevNodes.map((n) => {
    const inScope = scopeIds.has(n.id);
    const wasInScope = n.retryOwnerId === retryNodeId && n.retryScopeType === scopeType;
    if (!inScope && wasInScope) {
      return {
        ...n,
        retryOwnerId: null,
        retryScopeType: null,
        isRetryScopeEnd: false
      };
    }
    if (inScope) {
      return {
        ...n,
        retryOwnerId: retryNodeId,
        retryScopeType: scopeType,
        isRetryScopeEnd: endId ? n.id === endId : false
      };
    }
    return n;
  });
}

/** Retry 스코프에 속한 노드 id 집합 (선형: start부터 scope end까지. isRetryScopeEnd인 노드에서 순회 중단) */
export function getRetryScopeNodeIds(
  retryNodeId: string,
  scopeType: "main" | "failure",
  nodes: EditorNode[],
  edges: EditorEdge[]
): Set<string> {
  const startId = getRetryScopeStartNodeId(retryNodeId, scopeType, edges);
  if (!startId) return new Set();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, EditorEdge>();
  edges.forEach((e) => {
    if (nodeMap.has(e.from) && nodeMap.has(e.to)) outEdges.set(e.from, e);
  });
  const ids = new Set<string>();
  let current: string | null = startId;
  while (current) {
    const node = nodeMap.get(current);
    if (!node) break;
    // flow_control 노드는 스코프 계산에서 제외하고, 중간에 만나면 그 전까지만 포함
    if (node.kind.startsWith("flow_control.")) break;
    if (node.retryOwnerId !== retryNodeId || node.retryScopeType !== scopeType) break;
    ids.add(current);
    if (node.isRetryScopeEnd) break;
    current = outEdges.get(current)?.to ?? null;
  }
  return ids;
}

/** Retry 스코프에서 scope end 노드 id (체인 순서상 마지막 노드) */
export function getRetryScopeEndNodeId(
  retryNodeId: string,
  scopeType: "main" | "failure",
  nodes: EditorNode[],
  edges: EditorEdge[]
): string | null {
  const startId = getRetryScopeStartNodeId(retryNodeId, scopeType, edges);
  if (!startId) return null;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, EditorEdge>();
  edges.forEach((e) => {
    if (nodeMap.has(e.from) && nodeMap.has(e.to)) outEdges.set(e.from, e);
  });
  let current: string | null = startId;
  let last: string | null = startId;
  while (current) {
    const node = nodeMap.get(current);
    if (!node) break;
    // flow_control 노드는 스코프 계산에서 제외하고, 중간에 만나면 그 전까지만 포함
    if (node.kind.startsWith("flow_control.")) break;
    if (node.retryOwnerId !== retryNodeId || node.retryScopeType !== scopeType) break;
    last = current;
    if (node.isRetryScopeEnd) break;
    current = outEdges.get(current)?.to ?? null;
  }
  return last;
}
