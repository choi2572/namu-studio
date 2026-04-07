import type {
  ConditionExpression,
  ConditionOperator,
  EditorNode,
  NodeKind,
  NodeTypeConfig
} from "../editorTypes";

export function applyConditionExpressionFieldChange(
  nodes: EditorNode[],
  nodeId: string,
  expressionId: string,
  field: "variable" | "comparisonOperator" | "value",
  value: string,
  createConditionExpression: (operator: ConditionOperator | null) => ConditionExpression
): EditorNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
    const expressions = node.conditionExpressions ?? [createConditionExpression(null)];
    const nextExpressions = expressions.map((expression) =>
      expression.id === expressionId ? { ...expression, [field]: value } : expression
    );
    return { ...node, conditionExpressions: nextExpressions };
  });
}

type StartEndBadge = {
  showStart: boolean;
  showEnd: boolean;
  isRootScope: boolean;
  startError?: string;
};

export function applyAddConditionExpression(
  nodes: EditorNode[],
  nodeId: string,
  operator: ConditionOperator,
  normalizeConditionExpressions: (expressions: ConditionExpression[]) => ConditionExpression[],
  createConditionExpression: (operator: ConditionOperator | null) => ConditionExpression,
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
  return nodes.map((node) => {
    if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
    const baseExpressions = normalizeConditionExpressions(node.conditionExpressions ?? []);
    const nextExpressions = normalizeConditionExpressions([
      ...baseExpressions,
      createConditionExpression(operator)
    ]);
    const nextNode = { ...node, conditionExpressions: nextExpressions };
    const hasRibbon = Boolean(
      startEndBadges.get(node.id)?.showStart || startEndBadges.get(node.id)?.showEnd
    );
    const { minX, minY, maxX, maxY } = getCanvasBounds(
      canvasBase,
      getEffectiveNodeHeight(nextNode, nodeTypeConfig, hasRibbon)
    );
    return {
      ...nextNode,
      position: {
        x: clamp(node.position.x, minX, maxX),
        y: clamp(node.position.y, minY, maxY)
      }
    };
  });
}

export function applyRemoveConditionExpression(
  nodes: EditorNode[],
  nodeId: string,
  expressionId: string,
  normalizeConditionExpressions: (expressions: ConditionExpression[]) => ConditionExpression[],
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
  return nodes.map((node) => {
    if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
    const remaining = (node.conditionExpressions ?? []).filter(
      (expression) => expression.id !== expressionId
    );
    const nextExpressions = normalizeConditionExpressions(remaining);
    const nextNode = { ...node, conditionExpressions: nextExpressions };
    const hasRibbon = Boolean(
      startEndBadges.get(node.id)?.showStart || startEndBadges.get(node.id)?.showEnd
    );
    const { minX, minY, maxX, maxY } = getCanvasBounds(
      canvasBase,
      getEffectiveNodeHeight(nextNode, nodeTypeConfig, hasRibbon)
    );
    return {
      ...nextNode,
      position: {
        x: clamp(node.position.x, minX, maxX),
        y: clamp(node.position.y, minY, maxY)
      }
    };
  });
}
