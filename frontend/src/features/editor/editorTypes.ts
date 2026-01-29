export type NodeKind =
  | `skill.${string}`
  | "flow_control.input"
  | "flow_control.condition"
  | "flow_control.output"
  | "flow_control.parallel"
  | "flow_control.repeat"
  | "event.webhook";

export type NodeCategory = "skill" | "flow_control" | "event";

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

export type ConditionExpression = {
  id: string;
  operator: ConditionOperator | null;
  expression: string;
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
  block?: {
    type: "parallel" | "repeat";
    editLabel: string;
  };
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
  body?: EditorGraph;
  branches?: EditorGraph[];
};

export type EditorEdge = {
  id: string;
  from: string;
  fromPort: string;
  to: string;
};

export type EditorGraph = {
  version: "v1";
  nodes: EditorNode[];
  edges: EditorEdge[];
  canvas?: { width: number; height: number; zoom: number };
};
