import { CANVAS_DEFAULT } from "./editorConstants";
import {
  isRecord,
  isValidEditorEdge,
  isValidEditorNode,
  normalizeConditionExpressionFromView,
  normalizeVariableRowFromView
} from "./editorPureUtils";
import type {
  EditorEdge,
  EditorNode,
  EditorViewJson,
  NodeKind,
  VariableRow
} from "./editorTypes";

export function parseEditorView(
  viewJson: Record<string, unknown>,
  nodeTypes: NodeKind[]
): EditorViewJson | null {
  const rawNodes = viewJson.nodes;
  const rawEdges = viewJson.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;
  const normalizedNodes = rawNodes.map((node) => {
    if (!isRecord(node)) return node;
    const conditionExpressions = node.conditionExpressions;
    const conditionPart =
      Array.isArray(conditionExpressions)
        ? {
            conditionExpressions: conditionExpressions.map((expr) =>
              normalizeConditionExpressionFromView(
                isRecord(expr) ? expr : { id: "", operator: null, expression: "" }
              )
            )
          }
        : {};
    const rawRows = (node as { variableRows?: unknown }).variableRows;
    const variableRowsPart =
      Array.isArray(rawRows)
        ? {
            variableRows: rawRows
              .map(normalizeVariableRowFromView)
              .filter((row): row is VariableRow => row !== null)
          }
        : {};
    return {
      ...node,
      ...conditionPart,
      ...variableRowsPart
    };
  });
  if (!normalizedNodes.every((node) => isValidEditorNode(node, nodeTypes)) || !rawEdges.every(isValidEditorEdge)) {
    return null;
  }
  const rawCanvas = isRecord(viewJson.canvas) ? viewJson.canvas : null;
  const canvas = rawCanvas
    ? {
        width:
          typeof rawCanvas.width === "number" ? rawCanvas.width : CANVAS_DEFAULT.width,
        height:
          typeof rawCanvas.height === "number"
            ? rawCanvas.height
            : CANVAS_DEFAULT.height,
        zoom: typeof rawCanvas.zoom === "number" ? rawCanvas.zoom : 1
      }
    : undefined;

  // 실패 핸들링용 failure 그래프 복원 (있으면)
  const rawFailure = isRecord((viewJson as { failure?: unknown }).failure)
    ? ((viewJson as { failure?: unknown }).failure as Record<string, unknown>)
    : null;

  let failure: EditorViewJson["failure"] | undefined;
  if (rawFailure) {
    const entryNodeId =
      typeof rawFailure.entryNodeId === "string"
        ? rawFailure.entryNodeId
        : "failure-entry-1";
    const rawFailureNodes = Array.isArray(rawFailure.nodes)
      ? rawFailure.nodes
      : [];
    const rawFailureEdges = Array.isArray(rawFailure.edges)
      ? rawFailure.edges
      : [];

    const normalizedFailureNodes = rawFailureNodes.map((node) => {
      if (!isRecord(node)) return node;
      const conditionExpressions = node.conditionExpressions;
      const conditionPart =
        Array.isArray(conditionExpressions)
          ? {
              conditionExpressions: conditionExpressions.map((expr) =>
                normalizeConditionExpressionFromView(
                  isRecord(expr) ? expr : { id: "", operator: null, expression: "" }
                )
              )
            }
          : {};
      const rawRows = (node as { variableRows?: unknown }).variableRows;
      const variableRowsPart =
        Array.isArray(rawRows)
          ? {
              variableRows: rawRows
                .map(normalizeVariableRowFromView)
                .filter((row): row is VariableRow => row !== null)
            }
          : {};
      return {
        ...node,
        ...conditionPart,
        ...variableRowsPart
      };
    });

    // 실패 플로우는 system.on_failure_entry 노드를 포함하므로,
    // 메인 캔버스 nodeTypes에 이 kind가 없으면 추가해서 검증한다.
    const failureNodeTypes = nodeTypes.includes("system.on_failure_entry" as NodeKind)
      ? nodeTypes
      : ([...nodeTypes, "system.on_failure_entry"] as NodeKind[]);

    const isValidFailureNodes = normalizedFailureNodes.every((node) =>
      isValidEditorNode(node, failureNodeTypes)
    );
    const isValidFailureEdges = rawFailureEdges.every(isValidEditorEdge);

    if (isValidFailureNodes && isValidFailureEdges) {
      failure = {
        entryNodeId,
        nodes: normalizedFailureNodes as EditorNode[],
        edges: rawFailureEdges as EditorEdge[]
      };
    }
  }

  return {
    version: "v1",
    nodes: normalizedNodes as EditorNode[],
    edges: rawEdges as EditorEdge[],
    canvas,
    failure
  };
}
