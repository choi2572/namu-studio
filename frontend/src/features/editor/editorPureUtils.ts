import {
  CONDITION_COMPARISON_OPERATORS,
  DSL_OP_TO_EDITOR,
  EDITOR_NODE_CLIPBOARD_PREFIX,
  EDITOR_OP_TO_DSL
} from "./editorConstants";
import type {
  ConditionExpression,
  ContainerFrameData,
  EditorEdge,
  EditorNode,
  NodeKind,
  VariableRow,
  VariableValueType
} from "./editorTypes";

export function comparisonOperatorToDsl(editorOp: string): string {
  return EDITOR_OP_TO_DSL[editorOp] ?? "Equals";
}

export function dslOperatorToEditor(dslOp: string): string {
  return DSL_OP_TO_EDITOR[dslOp] ?? "==";
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function serializeEditorNodeClipboard(node: EditorNode): string {
  return EDITOR_NODE_CLIPBOARD_PREFIX + JSON.stringify({ v: 1, node });
}

export function parseEditorNodeClipboard(text: string): EditorNode | null {
  if (!text.startsWith(EDITOR_NODE_CLIPBOARD_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(
      text.slice(EDITOR_NODE_CLIPBOARD_PREFIX.length)
    );
    if (!isRecord(parsed) || parsed.v !== 1) return null;
    const raw = parsed.node;
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string") return null;
    if (typeof raw.name !== "string") return null;
    if (typeof raw.kind !== "string") return null;
    if (!isRecord(raw.position)) return null;
    if (typeof raw.position.x !== "number" || typeof raw.position.y !== "number") {
      return null;
    }
    if (!isRecord(raw.params)) return null;
    return JSON.parse(JSON.stringify(raw)) as EditorNode;
  } catch {
    return null;
  }
}

export function isValidEditorEdge(value: unknown): value is EditorEdge {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.from === "string" &&
    typeof value.fromPort === "string" &&
    typeof value.to === "string"
  );
}

export function parseConditionExpressionString(expr: string): {
  variable: string;
  comparisonOperator: string;
  value: string;
} {
  const s = (expr ?? "").trim();
  if (!s) return { variable: "", comparisonOperator: "==", value: "" };
  // Longest first so ">=" is matched before ">"
  for (const op of CONDITION_COMPARISON_OPERATORS) {
    const i = s.indexOf(op);
    if (i !== -1) {
      return {
        variable: s.slice(0, i).trim(),
        comparisonOperator: op,
        value: s.slice(i + op.length).trim()
      };
    }
  }
  // DSL 단어형 연산자(Equals, NotEquals 등) 인식
  const dslOpPatterns = [
    "LessThanOrEqual",
    "GreaterThanOrEqual",
    "NotEquals",
    "LessThan",
    "GreaterThan",
    "Equals"
  ] as const;
  for (const dslOp of dslOpPatterns) {
    const i = s.indexOf(dslOp);
    if (i !== -1) {
      const editorOp = dslOperatorToEditor(dslOp);
      return {
        variable: s.slice(0, i).trim(),
        comparisonOperator: editorOp,
        value: s.slice(i + dslOp.length).trim()
      };
    }
  }
  return { variable: s, comparisonOperator: "==", value: "" };
}

export function isValidConditionExpression(value: unknown): value is ConditionExpression {
  if (!isRecord(value)) return false;
  const operator = value.operator;
  return (
    typeof value.id === "string" &&
    (operator === null || operator === "AND" || operator === "OR") &&
    typeof value.variable === "string" &&
    typeof value.comparisonOperator === "string" &&
    typeof value.value === "string"
  );
}

export function isValidVariableRow(value: unknown): value is VariableRow {
  if (!isRecord(value)) return false;
  const rawType = (value as { valueType?: unknown }).valueType;
  const isValidType =
    rawType === undefined ||
    rawType === "int" ||
    rawType === "bool" ||
    rawType === "double" ||
    rawType === "string";
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.value === "string" &&
    isValidType
  );
}

/** view JSON에서 온 variableRow를 정규화. 검증 실패 시 전체 parse가 DSL 폴백되지 않도록. */
export function normalizeVariableRowFromView(raw: unknown): VariableRow | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  const value = typeof raw.value === "string" ? raw.value : "";
  const rawType = (raw as { valueType?: unknown }).valueType;
  const valueType: VariableValueType =
    rawType === "int" || rawType === "integer"
      ? "int"
      : rawType === "bool"
        ? "bool"
        : rawType === "double"
          ? "double"
          : rawType === "string"
            ? "string"
            : "string";
  if (!id) return null;
  return { id, name, value, valueType };
}

export function isValidContainerFrameData(value: unknown): value is ContainerFrameData {
  if (!isRecord(value)) return false;
  const width = value.width;
  const height = value.height;
  if (typeof width !== "number" || typeof height !== "number") return false;
  const branchCount = (value as { branchCount?: unknown }).branchCount;
  if (
    branchCount !== undefined &&
    (typeof branchCount !== "number" || branchCount < 1)
  ) {
    return false;
  }
  return true;
}

export function isValidEditorNode(
  value: unknown,
  nodeTypes: NodeKind[]
): value is EditorNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.name !== "string") return false;
  if (typeof value.kind !== "string" || !nodeTypes.includes(value.kind as NodeKind)) {
    return false;
  }
  if (
    !isRecord(value.position) ||
    typeof value.position.x !== "number" ||
    typeof value.position.y !== "number"
  ) {
    return false;
  }
  if (typeof value.isExpanded !== "boolean") return false;
  if (!isRecord(value.params)) return false;
  if (
    value.conditionExpressions !== undefined &&
    (!Array.isArray(value.conditionExpressions) ||
      !value.conditionExpressions.every(isValidConditionExpression))
  ) {
    return false;
  }
  if (
    value.variableRows !== undefined &&
    (!Array.isArray(value.variableRows) ||
      !value.variableRows.every(isValidVariableRow))
  ) {
    return false;
  }
  const containerId = (value as { containerId?: unknown }).containerId;
  if (containerId !== undefined && containerId !== null && typeof containerId !== "string") {
    return false;
  }
  const containerType = (value as { containerType?: unknown }).containerType;
  if (
    containerType !== undefined &&
    containerType !== null &&
    containerType !== "repeat" &&
    containerType !== "parallel"
  ) {
    return false;
  }
  const branchIndex = (value as { branchIndex?: unknown }).branchIndex;
  if (
    branchIndex !== undefined &&
    branchIndex !== null &&
    (typeof branchIndex !== "number" || branchIndex < 0)
  ) {
    return false;
  }
  const containerFrame = (value as { containerFrame?: unknown }).containerFrame;
  if (containerFrame !== undefined && !isValidContainerFrameData(containerFrame)) {
    return false;
  }
  return true;
}

export function normalizeConditionExpressionFromView(
  raw: Record<string, unknown>
): ConditionExpression {
  if (
    typeof raw.variable === "string" &&
    typeof raw.comparisonOperator === "string" &&
    typeof raw.value === "string"
  ) {
    return {
      id: String(raw.id),
      operator:
        raw.operator === "AND" || raw.operator === "OR" ? raw.operator : null,
      variable: raw.variable,
      comparisonOperator: raw.comparisonOperator,
      value: raw.value
    };
  }
  const parsed = parseConditionExpressionString(String(raw.expression ?? ""));
  return {
    id: String(raw.id),
    operator:
      raw.operator === "AND" || raw.operator === "OR" ? raw.operator : null,
    variable: parsed.variable,
    comparisonOperator: parsed.comparisonOperator,
    value: parsed.value
  };
}
export function getNextIndexFromIds(ids: string[], prefix: string) {
  const prefixToken = `${prefix}-`;
  const numbers = ids
    .filter((id) => id.startsWith(prefixToken))
    .map((id) => Number(id.slice(prefixToken.length)))
    .filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

export function assignEditorCountersAfterDraftLoad(
  loadedNodes: EditorNode[],
  loadedEdges: EditorEdge[],
  refs: {
    nextNodeIndex: { current: number };
    nextEdgeIndex: { current: number };
    nextConditionIndex: { current: number };
    nextVariableRowIndex: { current: number };
  }
) {
  refs.nextNodeIndex.current = getNextIndexFromIds(
    loadedNodes.map((node) => node.id),
    "node"
  );
  refs.nextEdgeIndex.current = getNextIndexFromIds(
    loadedEdges.map((edge) => edge.id),
    "edge"
  );
  const conditionIds = loadedNodes.flatMap(
    (node) => node.conditionExpressions ?? []
  );
  refs.nextConditionIndex.current = getNextIndexFromIds(
    conditionIds.map((expression) => expression.id),
    "condition"
  );
  const variableRowIds = loadedNodes.flatMap(
    (node) => node.variableRows ?? []
  );
  refs.nextVariableRowIndex.current = getNextIndexFromIds(
    variableRowIds.map((row) => row.id),
    "var"
  );
}
