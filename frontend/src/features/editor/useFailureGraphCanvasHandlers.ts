"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { FAILURE_CANVAS_BASE } from "./editorConstants";
import { getNodeHeight } from "./editorNodeLayout";
import type {
  ConditionExpression,
  ConditionOperator,
  EditorNode,
  FailureHandlingGraph,
  NodeKind,
  NodeTypeConfig,
  VariableValueType
} from "./editorTypes";

export type FailureConnectingFrom = {
  nodeId: string;
  portKey: string;
} | null;

export type RecomputeRetryScopeMembershipFn = (
  prevNodes: EditorNode[],
  retryNodeId: string,
  scopeType: "main" | "failure",
  edges: import("./editorTypes").EditorEdge[]
) => EditorNode[];

export type UseFailureGraphCanvasHandlersParams = {
  failureGraph: FailureHandlingGraph;
  failureConnectingFrom: FailureConnectingFrom;
  setFailureGraph: Dispatch<SetStateAction<FailureHandlingGraph>>;
  setFailureConnectingFrom: Dispatch<SetStateAction<FailureConnectingFrom>>;
  setFailureFlowToastMessage: Dispatch<SetStateAction<string | null>>;
  setHasUnsavedChanges: Dispatch<SetStateAction<boolean>>;
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>;
  buildDefaultParams: (kind: NodeKind) => Record<string, string>;
  createConditionExpression: (operator: ConditionOperator | null) => ConditionExpression;
  normalizeConditionExpressions: (expressions: ConditionExpression[]) => ConditionExpression[];
  nextFailureNodeIndexRef: MutableRefObject<number>;
  nextVariableRowIndex: MutableRefObject<number>;
  getCanvasBounds: (
    canvasBase: { width: number; height: number },
    nodeHeight: number
  ) => { minX: number; minY: number; maxX: number; maxY: number };
  clamp: (value: number, min: number, max: number) => number;
  recomputeRetryScopeMembership: RecomputeRetryScopeMembershipFn;
  isForbiddenInRetryScope: (kind: NodeKind) => boolean;
};

export function useFailureGraphCanvasHandlers({
  failureGraph,
  failureConnectingFrom,
  setFailureGraph,
  setFailureConnectingFrom,
  setFailureFlowToastMessage,
  setHasUnsavedChanges,
  nodeTypeConfig,
  buildDefaultParams,
  createConditionExpression,
  normalizeConditionExpressions,
  nextFailureNodeIndexRef,
  nextVariableRowIndex,
  getCanvasBounds,
  clamp,
  recomputeRetryScopeMembership,
  isForbiddenInRetryScope
}: UseFailureGraphCanvasHandlersParams) {
  /** 실패 캔버스에 팔레트에서 드롭한 노드 추가 */
  const addFailureNode = useCallback(
    (kind: NodeKind, position: { x: number; y: number }) => {
      if (kind === "system.on_failure_entry") return;
      if (kind.startsWith("flow_control.") && kind !== "flow_control.condition") {
        setFailureFlowToastMessage(
          "Failure Handling Flow에서는 Condition 노드만 추가할 수 있습니다."
        );
        return;
      }
      const config = nodeTypeConfig[kind];
      const index = nextFailureNodeIndexRef.current++;
      const id = `failure-node-${index}`;
      const name = config ? `${config.label} ${index}` : `${kind} ${index}`;
      const params = buildDefaultParams(kind);
      if (kind === "flow_control.repeat" && !params.count) params.count = "1";
      const newNode: EditorNode = {
        id,
        name,
        kind,
        position: { x: position.x, y: position.y },
        // Failure 캔버스에 새로 추가되는 노드는 기본 folded 상태
        isExpanded: false,
        params
      };
      setFailureGraph((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode]
      }));
      setHasUnsavedChanges(true);
    },
    [nodeTypeConfig, buildDefaultParams]
  );

  const handleFailureToggleExpand = useCallback((nodeId: string) => {
    setFailureGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, isExpanded: !n.isExpanded } : n))
    }));
    setHasUnsavedChanges(true);
  }, []);

  /** 실패 캔버스에서 아웃풋 포트 클릭 시 연결 시작 */
  const handleFailureStartConnect = useCallback((nodeId: string, portKey: string) => {
    setFailureConnectingFrom({ nodeId, portKey });
  }, []);

  /** 실패 캔버스에서 인풋에 드롭 시 엣지 추가 */
  const handleFailureInputDrop = useCallback(
    (toNodeId: string) => {
      if (!failureConnectingFrom) return;
      const edgeId = `failure-edge-${failureGraph.edges.length + 1}`;
      setFailureGraph((prev) => ({
        ...prev,
        edges: [
          ...prev.edges,
          {
            id: edgeId,
            from: failureConnectingFrom.nodeId,
            fromPort: failureConnectingFrom.portKey,
            to: toNodeId
          }
        ]
      }));
      setFailureConnectingFrom(null);
      setHasUnsavedChanges(true);
    },
    [failureConnectingFrom, failureGraph.edges.length]
  );

  const handleFailureParamChange = useCallback((nodeId: string, key: string, value: string) => {
    setFailureGraph((prev) => {
      const retryNode = prev.nodes.find((n) => n.id === nodeId);
      const isRetryNode = retryNode?.kind === "flow_control.retry";
      const isRetryTurningOffFailure =
        isRetryNode && key === "onFailureEnabled" && value === "false";

      let nextNodes = prev.nodes.map((node) => {
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
        nextNodes = recomputeRetryScopeMembership(nextNodes, nodeId, scopeType, prev.edges);
      }

      let nextEdges = prev.edges;
      if (key === "onFailureEnabled" && value === "false") {
        const n = prev.nodes.find((nn) => nn.id === nodeId);
        if (n?.kind === "flow_control.retry") {
          nextEdges = prev.edges.filter((e) => !(e.from === nodeId && e.fromPort === "failure"));
        }
      }

      return { ...prev, nodes: nextNodes, edges: nextEdges };
    });
    setHasUnsavedChanges(true);
  }, []);

  const handleFailureConditionExpressionFieldChange = useCallback(
    (
      nodeId: string,
      expressionId: string,
      field: "variable" | "comparisonOperator" | "value",
      value: string
    ) => {
      setFailureGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
          const expressions = node.conditionExpressions ?? [createConditionExpression(null)];
          const nextExpressions = expressions.map((expression) =>
            expression.id === expressionId ? { ...expression, [field]: value } : expression
          );
          return { ...node, conditionExpressions: nextExpressions };
        })
      }));
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleFailureAddConditionExpression = useCallback(
    (nodeId: string, operator: ConditionOperator) => {
      setFailureGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
          const baseExpressions = normalizeConditionExpressions(node.conditionExpressions ?? []);
          const nextExpressions = normalizeConditionExpressions([
            ...baseExpressions,
            createConditionExpression(operator)
          ]);
          const nextNode = { ...node, conditionExpressions: nextExpressions };
          const { minX, minY, maxX, maxY } = getCanvasBounds(
            FAILURE_CANVAS_BASE,
            getNodeHeight(nextNode, nodeTypeConfig)
          );
          return {
            ...nextNode,
            position: {
              x: clamp(node.position.x, minX, maxX),
              y: clamp(node.position.y, minY, maxY)
            }
          };
        })
      }));
      setHasUnsavedChanges(true);
    },
    [nodeTypeConfig]
  );

  const handleFailureRemoveConditionExpression = useCallback(
    (nodeId: string, expressionId: string) => {
      setFailureGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
          const remaining = (node.conditionExpressions ?? []).filter(
            (expression) => expression.id !== expressionId
          );
          const nextExpressions = normalizeConditionExpressions(remaining);
          const nextNode = { ...node, conditionExpressions: nextExpressions };
          const { minX, minY, maxX, maxY } = getCanvasBounds(
            FAILURE_CANVAS_BASE,
            getNodeHeight(nextNode, nodeTypeConfig)
          );
          return {
            ...nextNode,
            position: {
              x: clamp(node.position.x, minX, maxX),
              y: clamp(node.position.y, minY, maxY)
            }
          };
        })
      }));
      setHasUnsavedChanges(true);
    },
    [nodeTypeConfig]
  );

  const handleFailureVariableRowChange = useCallback(
    (nodeId: string, rowId: string, field: "name" | "value", value: string) => {
      setFailureGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (
            node.id !== nodeId ||
            (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
          )
            return node;
          const rows = node.variableRows ?? [];
          const nextRows = rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row));
          return { ...node, variableRows: nextRows };
        })
      }));
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleFailureAddVariableRow = useCallback(
    (nodeId: string, valueType: VariableValueType) => {
      setFailureGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (
            node.id !== nodeId ||
            (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
          )
            return node;
          const rows = node.variableRows ?? [];
          const nextRows = [
            ...rows,
            {
              id: `var-${nextVariableRowIndex.current++}`,
              name: "",
              value: "",
              valueType
            }
          ];
          const nextNode = { ...node, variableRows: nextRows };
          const { minX, minY, maxX, maxY } = getCanvasBounds(
            FAILURE_CANVAS_BASE,
            getNodeHeight(nextNode, nodeTypeConfig)
          );
          return {
            ...nextNode,
            position: {
              x: clamp(node.position.x, minX, maxX),
              y: clamp(node.position.y, minY, maxY)
            }
          };
        })
      }));
      setHasUnsavedChanges(true);
    },
    [nodeTypeConfig]
  );

  const handleFailureRemoveVariableRow = useCallback(
    (nodeId: string, rowId: string) => {
      setFailureGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (
            node.id !== nodeId ||
            (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
          )
            return node;
          const rows = node.variableRows ?? [];
          const nextRows = rows.filter((row) => row.id !== rowId);
          const nextNode = { ...node, variableRows: nextRows };
          const { minX, minY, maxX, maxY } = getCanvasBounds(
            FAILURE_CANVAS_BASE,
            getNodeHeight(nextNode, nodeTypeConfig)
          );
          return {
            ...nextNode,
            position: {
              x: clamp(node.position.x, minX, maxX),
              y: clamp(node.position.y, minY, maxY)
            }
          };
        })
      }));
      setHasUnsavedChanges(true);
    },
    [nodeTypeConfig]
  );

  const handleFailureNameChange = useCallback((nodeId: string, value: string) => {
    setFailureGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => (node.id === nodeId ? { ...node, name: value } : node))
    }));
    setHasUnsavedChanges(true);
  }, []);

  const handleFailureRetryScopeEndChange = useCallback((nodeId: string, checked: boolean) => {
    setFailureGraph((prev) => {
      const node = prev.nodes.find((n) => n.id === nodeId);
      const ownerId = node?.retryOwnerId;
      const scopeType = node?.retryScopeType;
      if (!ownerId || !scopeType) return prev;
      const edgesLocal = prev.edges;
      const nodeMap = new Map(prev.nodes.map((n) => [n.id, n]));
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
      const nextNodes = prev.nodes.map((n) => {
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
      return { ...prev, nodes: nextNodes };
    });
    setHasUnsavedChanges(true);
  }, []);

  return {
    addFailureNode,
    handleFailureToggleExpand,
    handleFailureStartConnect,
    handleFailureInputDrop,
    handleFailureParamChange,
    handleFailureConditionExpressionFieldChange,
    handleFailureAddConditionExpression,
    handleFailureRemoveConditionExpression,
    handleFailureVariableRowChange,
    handleFailureAddVariableRow,
    handleFailureRemoveVariableRow,
    handleFailureNameChange,
    handleFailureRetryScopeEndChange
  };
}
