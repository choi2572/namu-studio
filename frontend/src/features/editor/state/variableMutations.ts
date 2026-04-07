import type { EditorNode, NodeKind, NodeTypeConfig, VariableValueType } from "../editorTypes";

type StartEndBadge = {
  showStart: boolean;
  showEnd: boolean;
  isRootScope: boolean;
  startError?: string;
};

export function applyVariableRowChange(
  nodes: EditorNode[],
  nodeId: string,
  rowId: string,
  field: "name" | "value",
  value: string
): EditorNode[] {
  return nodes.map((node) => {
    if (
      node.id !== nodeId ||
      (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
    )
      return node;
    const rows = node.variableRows ?? [];
    const nextRows = rows.map((row) =>
      row.id === rowId ? { ...row, [field]: value } : row
    );
    return { ...node, variableRows: nextRows };
  });
}

export function applyAddVariableRow(
  nodes: EditorNode[],
  nodeId: string,
  valueType: VariableValueType,
  newRowId: () => string,
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
    if (
      node.id !== nodeId ||
      (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
    )
      return node;
    const rows = node.variableRows ?? [];
    const nextRows = [
      ...rows,
      {
        id: newRowId(),
        name: "",
        value: "",
        valueType
      }
    ];
    const nextNode = { ...node, variableRows: nextRows };
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

export function applyRemoveVariableRow(
  nodes: EditorNode[],
  nodeId: string,
  rowId: string,
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
    if (
      node.id !== nodeId ||
      (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
    )
      return node;
    const rows = node.variableRows ?? [];
    const nextRows = rows.filter((row) => row.id !== rowId);
    const nextNode = { ...node, variableRows: nextRows };
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
