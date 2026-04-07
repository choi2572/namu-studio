import type { ResizeHandle } from "@/components/ContainerFrame";

export type NodeKind =
  | `skill.${string}`
  | "flow_control.input"
  | "flow_control.condition"
  | "flow_control.output"
  | "flow_control.repeat"
  | "flow_control.parallel"
  | "flow_control.retry"
  | "flow_control.vlm"
  | "event.webhook"
  | "system.on_failure_entry";

export type NodeCategory = "skill" | "flow_control" | "event";

export type ContainerType = "repeat" | "parallel";

export type ContainerFrameData = {
  width: number;
  height: number;
  branchCount?: number;
};

export type NodeParamField = {
  key: string;
  label: string;
  placeholder: string;
};

export type NodeOutputPort = {
  key: string;
  label: string;
};

export type ConditionOperator = "AND" | "OR";

// Condition 노드의 개별 표현식: variable, comparisonOperator, value 각각 별도 필드
export type ConditionExpression = {
  id: string;
  // 첫 번째 표현식은 null, 두 번째부터 AND/OR
  operator: ConditionOperator | null;
  variable: string;
  comparisonOperator: string;
  value: string;
};

export type VariableValueType = "int" | "bool" | "double" | "string";

export type VariableRow = {
  id: string;
  name: string;
  value: string;
  valueType: VariableValueType;
};

export type NodeTypeConfig = {
  label: string;
  category: NodeCategory;
  iconText: string;
  colorClass: string;
  paramFields: NodeParamField[];
  outputs: NodeOutputPort[];
  inputEnabled?: boolean;
};

export type EditorNode = {
  id: string;
  name: string;
  kind: NodeKind;
  position: { x: number; y: number };
  isExpanded: boolean;
  params: Record<string, string>;
  conditionExpressions?: ConditionExpression[];
  variableRows?: VariableRow[];
  containerId?: string | null;
  containerType?: ContainerType | null;
  branchIndex?: number | null;
  containerFrame?: ContainerFrameData;
  /** Retry 스코프 메타데이터 (v0) */
  retryOwnerId?: string | null;
  retryScopeType?: "main" | "failure" | null;
  isRetryScopeEnd?: boolean;
  /** Retry 노드 전용 색상 테마 키 (예: emerald, indigo 등) */
  retryThemeColor?: string | null;
};

export type EditorEdge = {
  id: string;
  from: string;
  fromPort: string;
  to: string;
};

export type EditorViewJson = {
  version: "v1";
  nodes: EditorNode[];
  edges: EditorEdge[];
  canvas?: { width: number; height: number; zoom: number };
  /**
   * 실패 핸들링 캔버스 레이아웃만 보관. On/Off는 `dsl_json.OnFailure` 유무가 진실.
   */
  failure?: {
    entryNodeId: string;
    nodes: EditorNode[];
    edges: EditorEdge[];
  };
};

export type FailureHandlingGraph = {
  enabled: boolean;
  drawerOpen: boolean;
  nodes: EditorNode[];
  edges: EditorEdge[];
  entryNodeId: string;
};

export type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  height: number;
};

export type ResizeState = {
  nodeId: string;
  handle: ResizeHandle;
  startPoint: { x: number; y: number };
  startWidth: number;
  startHeight: number;
};

export type ConnectingState = {
  nodeId: string;
  portKey: string;
} | null;

export type EdgeDragPayload = {
  nodeId: string;
  portKey: string;
};
