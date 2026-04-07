import type { EditorNode, NodeKind, NodeTypeConfig } from "./editorTypes";
import { NODE_METRICS, RIBBON_EXTRA_HEIGHT } from "./editorConstants";

export function getExpandedContentHeight(
  node: EditorNode,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  if (node.kind === "flow_control.condition") {
    const expressionCount = Math.max(1, node.conditionExpressions?.length ?? 1);
    // 각 expression 은 2줄(row)로 렌더링되므로, 기존보다 2배 높이를 잡아준다.
    // 1 expression 기준:
    //   - 첫 줄: fieldHeight
    //   - 둘째 줄: fieldHeight
    //   - 두 줄 사이 gap: fieldGap
    // expression 들 사이 gap: fieldGap
    const perExpressionHeight =
      2 * NODE_METRICS.fieldHeight + NODE_METRICS.fieldGap;
    const expressionsHeight =
      expressionCount * perExpressionHeight +
      Math.max(0, expressionCount - 1) * NODE_METRICS.fieldGap;
    const buttonsHeight = NODE_METRICS.conditionButtonHeight + NODE_METRICS.fieldGap;
    return NODE_METRICS.expandedTopPadding + expressionsHeight + buttonsHeight;
  }

  if (node.kind === "flow_control.input" || node.kind === "flow_control.output") {
    const rowCount = node.variableRows?.length ?? 0;
    const rowsHeight =
      rowCount * NODE_METRICS.fieldHeight +
      Math.max(0, rowCount - 1) * NODE_METRICS.fieldGap;
    const addButtonHeight = NODE_METRICS.fieldHeight + NODE_METRICS.fieldGap;
    return NODE_METRICS.expandedTopPadding + rowsHeight + addButtonHeight;
  }

  const config = nodeTypeConfig[node.kind];
  if (!config) return 0;
  if (node.kind === "flow_control.retry") {
    const paramHeight =
      config.paramFields.length > 0
        ? NODE_METRICS.expandedTopPadding +
          config.paramFields.length * NODE_METRICS.fieldHeight +
          Math.max(0, config.paramFields.length - 1) * NODE_METRICS.fieldGap
        : NODE_METRICS.expandedTopPadding;
    const onFailureRow = NODE_METRICS.fieldGap + NODE_METRICS.fieldHeight;

    // main scope end 입력 한 줄
    let extra = NODE_METRICS.fieldGap + NODE_METRICS.fieldHeight;
    // failure scope end 입력 한 줄 (onFailureEnabled !== "false" 일 때만)
    if (node.params.onFailureEnabled !== "false") {
      extra += NODE_METRICS.fieldGap + NODE_METRICS.fieldHeight;
    }

    return paramHeight + onFailureRow + extra;
  }
  const fieldCount = config.paramFields.length;
  if (fieldCount === 0) return 0;
  // 기본 파라미터 필드 높이
  let height =
    NODE_METRICS.expandedTopPadding +
    fieldCount * NODE_METRICS.fieldHeight +
    Math.max(0, fieldCount - 1) * NODE_METRICS.fieldGap;

  // Skill 노드는 펼쳤을 때 타입 배지 아래에 Skill 이름 한 줄이 추가되므로
  // 그만큼 여유 높이를 조금 더 준다.
  if (node.kind.startsWith("skill.")) {
    height += NODE_METRICS.fieldGap + 12;
  }
  return height;
}

export function getNodeHeight(node: EditorNode, nodeTypeConfig: Record<NodeKind, NodeTypeConfig>) {
  if (!node.isExpanded) return NODE_METRICS.collapsedHeight;
  return NODE_METRICS.collapsedHeight + getExpandedContentHeight(node, nodeTypeConfig);
}

export function getEffectiveNodeHeight(
  node: EditorNode,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  hasRibbon: boolean
) {
  const base = getNodeHeight(node, nodeTypeConfig);
  return hasRibbon ? base + RIBBON_EXTRA_HEIGHT : base;
}

export function getPortOffsets(nodeHeight: number, count: number) {
  if (count <= 0) return [];
  if (count === 1) {
    return [nodeHeight / 2];
  }
  const gap = nodeHeight / (count + 1);
  return Array.from({ length: count }, (_, index) => gap * (index + 1));
}
