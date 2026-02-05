"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DragEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { skillsetsApi, workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  ContainerFrame,
  type ContainerFrameRegion,
  type ResizeHandle
} from "@/components/ContainerFrame";
import { StatusBadge } from "@/components/StatusBadge";
import { VariableInput } from "@/components/VariableInput";
import { ValidationError, WorkflowDraft } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import {
  computeStartEndForScope,
  type ScopeGraph
} from "@/lib/startEndDetection";
import { getAvailableVariables } from "@/lib/variableReferences";

type EditorPageProps = {
  workflowId: string;
};

type NodeKind =
  | `skill.${string}`
  | "flow_control.input"
  | "flow_control.condition"
  | "flow_control.output"
  | "flow_control.repeat"
  | "flow_control.parallel"
  | "event.webhook";

type NodeCategory = "skill" | "flow_control" | "event";

type ContainerType = "repeat" | "parallel";

type ContainerFrameData = {
  width: number;
  height: number;
  branchCount?: number;
};

type NodeParamField = {
  key: string;
  label: string;
  placeholder: string;
};

type NodeOutputPort = {
  key: string;
  label: string;
};

type ConditionOperator = "AND" | "OR";

const CONDITION_COMPARISON_OPERATORS = ["==", "!=", ">=", "<=", ">", "<"] as const;
type ConditionComparisonOperator = (typeof CONDITION_COMPARISON_OPERATORS)[number];

// Condition 노드의 개별 표현식: variable, comparisonOperator, value 각각 별도 필드
type ConditionExpression = {
  id: string;
  // 첫 번째 표현식은 null, 두 번째부터 AND/OR
  operator: ConditionOperator | null;
  variable: string;
  comparisonOperator: string;
  value: string;
};

type VariableValueType = "int" | "bool" | "double" | "string";

type VariableRow = {
  id: string;
  name: string;
  value: string;
  valueType: VariableValueType;
};

type NodeTypeConfig = {
  label: string;
  category: NodeCategory;
  iconText: string;
  colorClass: string;
  paramFields: NodeParamField[];
  outputs: NodeOutputPort[];
  inputEnabled?: boolean;
};

type EditorNode = {
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
};

type EditorEdge = {
  id: string;
  from: string;
  fromPort: string;
  to: string;
};

type EditorViewJson = {
  version: "v1";
  nodes: EditorNode[];
  edges: EditorEdge[];
  canvas?: { width: number; height: number; zoom: number };
};

type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  height: number;
};

type ResizeState = {
  nodeId: string;
  handle: ResizeHandle;
  startPoint: { x: number; y: number };
  startWidth: number;
  startHeight: number;
};

type ConnectingState = {
  nodeId: string;
  portKey: string;
} | null;

type EdgeDragPayload = {
  nodeId: string;
  portKey: string;
};

// NODE_TYPES는 skillset에서 동적으로 생성됩니다

const NODE_CATEGORIES: { id: NodeCategory; label: string }[] = [
  { id: "skill", label: "Skill" },
  { id: "flow_control", label: "Flow Control" },
  { id: "event", label: "Event" }
];

const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
  skill: "Skill",
  flow_control: "Flow Control",
  event: "Event"
};

// 정적 노드 타입 설정 (flow_control, event)
const STATIC_NODE_TYPE_CONFIG: Partial<Record<NodeKind, NodeTypeConfig>> = {
  "flow_control.input": {
    label: "Input",
    category: "flow_control",
    iconText: "IN",
    colorClass: "border-cyan-200 bg-cyan-100 text-cyan-700",
    paramFields: [],
    outputs: [{ key: "next", label: "Next" }],
    inputEnabled: false
  },
  "flow_control.condition": {
    label: "Condition",
    category: "flow_control",
    iconText: "IF",
    colorClass: "border-amber-200 bg-amber-100 text-amber-700",
    paramFields: [],
    outputs: [
      { key: "true", label: "True" },
      { key: "false", label: "False" }
    ]
  },
  "flow_control.output": {
    label: "Output",
    category: "flow_control",
    iconText: "OUT",
    colorClass: "border-rose-200 bg-rose-100 text-rose-700",
    paramFields: [],
    outputs: []
  },
  "flow_control.repeat": {
    label: "Repeat",
    category: "flow_control",
    iconText: "RP",
    colorClass: "border-cyan-200 bg-cyan-100 text-cyan-700",
    paramFields: [
      { key: "count", label: "Repeat Count", placeholder: "3" }
    ],
    outputs: [{ key: "next", label: "Next" }]
  },
  "flow_control.parallel": {
    label: "Parallel",
    category: "flow_control",
    iconText: "PA",
    colorClass: "border-cyan-200 bg-cyan-100 text-cyan-700",
    paramFields: [],
    outputs: [{ key: "next", label: "Next" }]
  },
  "event.webhook": {
    label: "Webhook",
    category: "event",
    iconText: "WH",
    colorClass: "border-purple-200 bg-purple-100 text-purple-700",
    paramFields: [
      { key: "url", label: "URL", placeholder: "https://hooks.example" },
      { key: "method", label: "Method", placeholder: "POST" }
    ],
    outputs: [{ key: "next", label: "Next" }]
  }
};

// Skillset 기반으로 노드 타입 설정 생성
function createNodeTypeConfigFromSkillset(skillset: import("@/domain/types").Skillset): NodeTypeConfig {
  const skillName = skillset.name;
  const iconText = skillName
    .split(/(?=[A-Z])/)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  
  // 색상 클래스는 skill 이름의 해시 기반으로 결정 (간단한 방법)
  const colorClasses = [
    "border-blue-200 bg-blue-100 text-blue-700",
    "border-emerald-200 bg-emerald-100 text-emerald-700",
    "border-purple-200 bg-purple-100 text-purple-700",
    "border-orange-200 bg-orange-100 text-orange-700",
    "border-pink-200 bg-pink-100 text-pink-700",
    "border-indigo-200 bg-indigo-100 text-indigo-700"
  ];
  const colorIndex = skillName.length % colorClasses.length;
  
  const paramFields: NodeParamField[] = Object.entries(skillset.parameters).map(([key, param]) => ({
    key,
    label: key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    placeholder: param.type || key
  }));
  
  // Skill 노드는 transition 표현이므로 next 포트 하나만 사용
  const outputs: NodeOutputPort[] = [{ key: "next", label: "Next" }];
  
  return {
    label: skillName.replace(/([A-Z])/g, " $1").trim(),
    category: "skill",
    iconText,
    colorClass: colorClasses[colorIndex],
    paramFields,
    outputs
  };
}

// Skillset 배열로부터 전체 노드 타입 설정 생성
function createNodeTypeConfigFromSkillsets(
  skillsets: import("@/domain/types").Skillset[]
): Record<string, NodeTypeConfig> {
  const config: Record<string, NodeTypeConfig> = { ...STATIC_NODE_TYPE_CONFIG };
  
  skillsets.forEach((skillset) => {
    const nodeKind = `skill.${skillset.name}` as NodeKind;
    config[nodeKind] = createNodeTypeConfigFromSkillset(skillset);
  });
  
  return config as Record<NodeKind, NodeTypeConfig>;
}

const NODE_METRICS = {
  width: 220,
  collapsedHeight: 86,
  expandedTopPadding: 12,
  fieldHeight: 44,
  fieldGap: 8,
  conditionButtonHeight: 28
};

/** 리본(START/END)이 있을 때 카드 상단에 추가되는 높이 (리본 h-6 + pt-6) */
const RIBBON_EXTRA_HEIGHT = 20;

const CONTAINER_FRAME_DEFAULTS = {
  width: 520,
  height: 320,
  branchWidth: 280
};

const CONTAINER_FRAME_METRICS = {
  offsetY: 12,
  headerHeight: 28,
  padding: 12,
  minWidth: 360,
  minHeight: 220
};

const DEFAULT_PARALLEL_BRANCHES = 2;

const CONTAINER_LAYOUT = {
  rowGap: 24,
  padding: 12,
  columnGap: 120
};

const CANVAS_PADDING = {
  x: 12,
  y: 12
};

const CANVAS_DEFAULT = {
  width: 1000,
  height: 600
};

const ZOOM_LIMITS = {
  min: 0.6,
  max: 1.6,
  step: 0.1
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getExpandedContentHeight(
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

function getNodeHeight(
  node: EditorNode,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  if (!node.isExpanded) return NODE_METRICS.collapsedHeight;
  return NODE_METRICS.collapsedHeight + getExpandedContentHeight(node, nodeTypeConfig);
}

function getEffectiveNodeHeight(
  node: EditorNode,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  hasRibbon: boolean
) {
  const base = getNodeHeight(node, nodeTypeConfig);
  return hasRibbon ? base + RIBBON_EXTRA_HEIGHT : base;
}

function getNodeTypeLabel(
  kind: NodeKind,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  const config = nodeTypeConfig[kind];
  if (!config) return kind;
  return `${NODE_CATEGORY_LABELS[config.category]} - ${config.label}`;
}

const CONTAINER_TYPE_BY_KIND: Partial<Record<NodeKind, ContainerType>> = {
  "flow_control.repeat": "repeat",
  "flow_control.parallel": "parallel"
};

function getContainerType(kind: NodeKind): ContainerType | null {
  return CONTAINER_TYPE_BY_KIND[kind] ?? null;
}

function isContainerNode(node: EditorNode) {
  return getContainerType(node.kind) !== null;
}

function getRepeatCount(node: EditorNode) {
  const raw = node.params.count ?? "1";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function getContainerBranchCount(node: EditorNode) {
  const containerType = getContainerType(node.kind);
  if (containerType !== "parallel") return 1;
  const requested = node.containerFrame?.branchCount ?? DEFAULT_PARALLEL_BRANCHES;
  return Math.max(DEFAULT_PARALLEL_BRANCHES, requested);
}

function getContainerHeaderLabel(node: EditorNode, branchCount: number) {
  const containerType = getContainerType(node.kind);
  if (containerType === "repeat") {
    return `Repeat x${getRepeatCount(node)}`;
  }
  if (containerType === "parallel") {
    return branchCount > 2 ? `Parallel (${branchCount})` : "Parallel";
  }
  return node.name;
}

function getContainerBranchLabel(containerType: ContainerType, index: number) {
  if (containerType === "repeat") {
    return "Body";
  }
  return `Branch ${index + 1}`;
}

function getDefaultContainerFrameSize(containerType: ContainerType, branchCount: number) {
  const baseWidth =
    containerType === "parallel"
      ? Math.max(
          CONTAINER_FRAME_DEFAULTS.width,
          branchCount * CONTAINER_FRAME_DEFAULTS.branchWidth
        )
      : CONTAINER_FRAME_DEFAULTS.width;
  return {
    width: Math.max(baseWidth, CONTAINER_FRAME_METRICS.minWidth),
    height: Math.max(CONTAINER_FRAME_DEFAULTS.height, CONTAINER_FRAME_METRICS.minHeight)
  };
}

function getContainerFrameLayout(
  node: EditorNode,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  const containerType = getContainerType(node.kind);
  if (!containerType) return null;
  const branchCount = getContainerBranchCount(node);
  const defaults = getDefaultContainerFrameSize(containerType, branchCount);
  const frameWidth = Math.max(
    node.containerFrame?.width ?? defaults.width,
    CONTAINER_FRAME_METRICS.minWidth
  );
  const frameHeight = Math.max(
    node.containerFrame?.height ?? defaults.height,
    CONTAINER_FRAME_METRICS.minHeight
  );
  // 컨테이너 노드 자체에 START/END 리본이 붙는 경우를 감안해서 여유 높이 추가
  const nodeHeight = getNodeHeight(node, nodeTypeConfig) + RIBBON_EXTRA_HEIGHT;
  const frameX = node.position.x;
  const frameY = node.position.y + nodeHeight + CONTAINER_FRAME_METRICS.offsetY;
  const headerHeight = CONTAINER_FRAME_METRICS.headerHeight;
  const bodyX = frameX + CONTAINER_FRAME_METRICS.padding;
  const bodyY = frameY + headerHeight + CONTAINER_FRAME_METRICS.padding;
  const bodyWidth = Math.max(0, frameWidth - CONTAINER_FRAME_METRICS.padding * 2);
  const bodyHeight = Math.max(
    0,
    frameHeight - headerHeight - CONTAINER_FRAME_METRICS.padding * 2
  );
  // Repeat: 단일 body 영역, Parallel: 브랜치를 세로로 스택 배치
  const regions: ContainerFrameRegion[] =
    branchCount > 0
      ? Array.from({ length: branchCount }, (_, index) => {
          const isParallel = containerType === "parallel";
          const regionHeight = isParallel ? bodyHeight / branchCount : bodyHeight;
          return {
            index,
            label: getContainerBranchLabel(containerType, index),
            bounds: {
              x: bodyX,
              y: isParallel ? bodyY + regionHeight * index : bodyY,
              width: bodyWidth,
              height: isParallel ? regionHeight : bodyHeight
            }
          };
        })
      : [];
  return {
    frame: { x: frameX, y: frameY, width: frameWidth, height: frameHeight },
    headerHeight,
    regions
  };
}

function getPortOffsets(nodeHeight: number, count: number) {
  if (count <= 0) return [];
  if (count === 1) {
    return [nodeHeight / 2];
  }
  const gap = nodeHeight / (count + 1);
  return Array.from({ length: count }, (_, index) => gap * (index + 1));
}

function getCanvasBounds(
  canvasBase: { width: number; height: number },
  nodeHeight: number
) {
  const minX = CANVAS_PADDING.x;
  const minY = CANVAS_PADDING.y;
  const maxX = Math.max(
    minX,
    canvasBase.width - NODE_METRICS.width - CANVAS_PADDING.x
  );
  const maxY = Math.max(minY, canvasBase.height - nodeHeight - CANVAS_PADDING.y);
  return { minX, minY, maxX, maxY };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidEditorEdge(value: unknown): value is EditorEdge {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.from === "string" &&
    typeof value.fromPort === "string" &&
    typeof value.to === "string"
  );
}

function parseConditionExpressionString(expr: string): {
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
  return { variable: s, comparisonOperator: "==", value: "" };
}

function isValidConditionExpression(value: unknown): value is ConditionExpression {
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

function isValidVariableRow(value: unknown): value is VariableRow {
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
function normalizeVariableRowFromView(raw: unknown): VariableRow | null {
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

function isValidContainerFrameData(value: unknown): value is ContainerFrameData {
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

function isValidEditorNode(
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

function normalizeConditionExpressionFromView(
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

function parseEditorView(
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
  return {
    version: "v1",
    nodes: normalizedNodes as EditorNode[],
    edges: rawEdges as EditorEdge[],
    canvas
  };
}

function getNextIndexFromIds(ids: string[], prefix: string) {
  const prefixToken = `${prefix}-`;
  const numbers = ids
    .filter((id) => id.startsWith(prefixToken))
    .map((id) => Number(id.slice(prefixToken.length)))
    .filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function buildStateNameMap(nodes: EditorNode[]) {
  const usedNames = new Set<string>();
  const nameMap = new Map<string, string>();
  nodes.forEach((node) => {
    const trimmed = node.name.trim();
    const base = trimmed ? trimmed.replace(/[^A-Za-z0-9_]+/g, "_") : node.id;
    const baseName = base || node.id;
    let name = baseName;
    let index = 1;
    while (usedNames.has(name)) {
      name = `${baseName}_${index}`;
      index += 1;
    }
    usedNames.add(name);
    nameMap.set(node.id, name);
  });
  return nameMap;
}

type ContainerDslPayload = {
  type: ContainerType;
  repeatCount?: number;
  body?: { StartAt: string | null; States: Record<string, Record<string, unknown>> };
  branches?: Array<{ StartAt: string | null; States: Record<string, Record<string, unknown>> }>;
};

function findStartNode(nodes: EditorNode[], edges: EditorEdge[]) {
  if (nodes.length === 0) return null;
  const inputNode = nodes.find((node) => node.kind === "flow_control.input");
  if (inputNode) return inputNode;
  const incoming = new Set(edges.map((edge) => edge.to));
  const candidate = nodes.find((node) => !incoming.has(node.id));
  return candidate ?? nodes[0];
}

function buildStateRecords(
  nodes: EditorNode[],
  edges: EditorEdge[],
  stateNameMap: Map<string, string>,
  containerPayloads?: Map<string, ContainerDslPayload>
) {
  const edgesByFrom = new Map<string, EditorEdge[]>();
  edges.forEach((edge) => {
    if (!stateNameMap.has(edge.from) || !stateNameMap.has(edge.to)) return;
    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(edge);
    edgesByFrom.set(edge.from, list);
  });
  const states: Record<string, Record<string, unknown>> = {};
  nodes.forEach((node) => {
    const stateName = stateNameMap.get(node.id);
    if (!stateName) return;
    const outgoing = edgesByFrom.get(node.id) ?? [];
    const getNext = (portKey: string) => {
      const edge = outgoing.find((item) => item.fromPort === portKey);
      if (!edge) return null;
      return stateNameMap.get(edge.to) ?? null;
    };
    let state: Record<string, unknown>;
    if (node.kind === "flow_control.output") {
      state = { Type: "Succeed" };
    } else if (node.kind === "flow_control.condition") {
      const trueTarget = getNext("true");
      const falseTarget = getNext("false");
      const firstExpr = node.conditionExpressions?.[0];
      const variableRaw = firstExpr?.variable?.trim() ?? "";
      const Variable = variableRaw.startsWith("$") ? variableRaw : `$.${variableRaw || "value"}`;
      const Operator = firstExpr?.comparisonOperator ?? "==";
      const rawVal = firstExpr?.value ?? "";
      let Value: number | boolean | string;
      if (rawVal === "true" || rawVal === "false") {
        Value = rawVal === "true";
      } else {
        const n = Number(rawVal);
        Value = Number.isFinite(n) ? n : rawVal;
      }
      state = {
        Type: "Condition",
        If: {
          Condition: { Variable, Operator, Value },
          Then: trueTarget ?? ""
        },
        Else: falseTarget ?? ""
      };
    } else if (node.kind === "flow_control.repeat") {
      const payload = containerPayloads?.get(node.id);
      const next = getNext("next");
      state = {
        Type: "Repeat",
        Count: payload?.repeatCount ?? getRepeatCount(node),
        Body: payload?.body ?? { StartAt: null, States: {} }
      };
      if (next) {
        state.Next = next;
      } else {
        state.End = true;
      }
    } else if (node.kind === "flow_control.parallel") {
      const payload = containerPayloads?.get(node.id);
      const next = getNext("next");
      state = {
        Type: "Parallel",
        Branches: payload?.branches ?? []
      };
      if (next) {
        state.Next = next;
      } else {
        state.End = true;
      }
    } else {
      const next = getNext("next");
      const skillName = node.kind.startsWith("skill.")
        ? node.kind.replace("skill.", "")
        : node.kind;
      state = {
        Type: node.kind === "flow_control.input" ? "Pass" : "Skill",
        Skill: skillName,
        Parameters: node.params
      };
      if (next) {
        state.Next = next;
      } else {
        state.End = true;
      }
    }
    state.Label = node.name;
    states[stateName] = state;
  });
  return states;
}

function buildDslJson(nodes: EditorNode[], edges: EditorEdge[]) {
  if (nodes.length === 0) {
    return {};
  }
  const containerNodes = nodes.filter(isContainerNode);
  const containerIds = new Set(containerNodes.map((node) => node.id));
  const topLevelNodes = nodes.filter(
    (node) => !node.containerId || !containerIds.has(node.containerId)
  );
  const topLevelNodeIds = new Set(topLevelNodes.map((node) => node.id));
  const topLevelEdges = edges.filter(
    (edge) => topLevelNodeIds.has(edge.from) && topLevelNodeIds.has(edge.to)
  );
  const stateNameMap = buildStateNameMap(nodes);
  const containerPayloads = new Map<string, ContainerDslPayload>();

  containerNodes.forEach((container) => {
    const containerType = getContainerType(container.kind);
    if (!containerType) return;
    if (containerType === "repeat") {
      const bodyNodes = nodes.filter((node) => node.containerId === container.id);
      const bodyNodeIds = new Set(bodyNodes.map((node) => node.id));
      const bodyEdges = edges.filter(
        (edge) => bodyNodeIds.has(edge.from) && bodyNodeIds.has(edge.to)
      );
      const bodyStartNode = findStartNode(bodyNodes, bodyEdges);
      const bodyStates = buildStateRecords(
        bodyNodes,
        bodyEdges,
        stateNameMap,
        containerPayloads
      );
      containerPayloads.set(container.id, {
        type: "repeat",
        repeatCount: getRepeatCount(container),
        body: {
          StartAt: bodyStartNode ? stateNameMap.get(bodyStartNode.id) ?? null : null,
          States: bodyStates
        }
      });
      return;
    }
    const branchCount = getContainerBranchCount(container);
    const branches = Array.from({ length: branchCount }, (_, index) => {
      const branchNodes = nodes.filter(
        (node) =>
          node.containerId === container.id &&
          (node.branchIndex ?? 0) === index
      );
      const branchNodeIds = new Set(branchNodes.map((node) => node.id));
      const branchEdges = edges.filter(
        (edge) => branchNodeIds.has(edge.from) && branchNodeIds.has(edge.to)
      );
      const branchStartNode = findStartNode(branchNodes, branchEdges);
      const branchStates = buildStateRecords(
        branchNodes,
        branchEdges,
        stateNameMap,
        containerPayloads
      );
      return {
        StartAt: branchStartNode
          ? stateNameMap.get(branchStartNode.id) ?? null
          : null,
        States: branchStates
      };
    });
    containerPayloads.set(container.id, {
      type: "parallel",
      branches
    });
  });

  const startNode = findStartNode(topLevelNodes, topLevelEdges);
  const states = buildStateRecords(
    topLevelNodes,
    topLevelEdges,
    stateNameMap,
    containerPayloads
  );
  const inputNode = topLevelNodes.find((n) => n.kind === "flow_control.input");
  const inputsRecord: Record<string, { Type: string; Value: number | boolean | string }> = {};
  inputNode?.variableRows?.forEach(({ name, value, valueType }) => {
    if (!name.trim()) return;
    const Type = valueType;
    let Value: number | boolean | string;
    switch (valueType) {
      case "int": {
        const n = Number.parseInt(value, 10);
        Value = Number.isFinite(n) ? n : 0;
        break;
      }
      case "double": {
        const n = Number.parseFloat(value);
        Value = Number.isFinite(n) ? n : 0;
        break;
      }
      case "bool":
        Value = value === "true" || value === "1";
        break;
      default:
        Value = value;
    }
    inputsRecord[name.trim()] = { Type, Value };
  });
  const hasInputs = Object.keys(inputsRecord).length > 0;
  return {
    Comment: "Generated from editor",
    StartAt: startNode ? stateNameMap.get(startNode.id) : undefined,
    ...(hasInputs ? { Inputs: inputsRecord } : {}),
    States: states
  };
}

function buildViewJson(
  nodes: EditorNode[],
  edges: EditorEdge[],
  canvasBase: { width: number; height: number },
  zoom: number
): EditorViewJson {
  return {
    version: "v1",
    nodes,
    edges,
    canvas: {
      width: canvasBase.width,
      height: canvasBase.height,
      zoom
    }
  };
}

type DslBranch = {
  StartAt?: string;
  States?: Record<string, DslState>;
};

type DslState = {
  Type?: string;
  Next?: string;
  End?: boolean;
  Label?: string;
  Skill?: string;
  Count?: number;
  Parameters?: Record<string, unknown>;
  Choices?: Array<Record<string, unknown>>;
  Expressions?: Array<{ operator?: string | null; expression?: string }>;
  If?: { Condition?: { Variable?: string; Operator?: string; Value?: unknown }; Then?: string };
  Else?: string;
  Branches?: DslBranch[];
  Body?: DslBranch;
};

type ParsedEditorGraph = {
  nodes: EditorNode[];
  edges: EditorEdge[];
  canvas?: { width: number; height: number; zoom: number };
};

function getContainerTypeById(nodes: EditorNode[]) {
  const map = new Map<string, ContainerType>();
  nodes.forEach((node) => {
    const type = getContainerType(node.kind);
    if (type) {
      map.set(node.id, type);
    }
  });
  return map;
}

function getNodeContainerKey(
  node: EditorNode,
  containerTypeById: Map<string, ContainerType>
) {
  const containerId = node.containerId;
  if (!containerId) return null;
  const containerType = node.containerType ?? containerTypeById.get(containerId);
  if (!containerType) return null;
  if (containerType === "parallel") {
    const branchIndex = node.branchIndex ?? 0;
    return `${containerId}:branch:${branchIndex}`;
  }
  return `${containerId}:body`;
}

function filterEdgesByContainerRules(nodes: EditorNode[], edges: EditorEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const containerTypeById = getContainerTypeById(nodes);
  return edges.filter((edge) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) return false;
    const fromKey = getNodeContainerKey(fromNode, containerTypeById);
    const toKey = getNodeContainerKey(toNode, containerTypeById);
    if (!fromKey && !toKey) return true;
    return fromKey !== null && fromKey === toKey;
  });
}

function normalizeContainerAssignments(nodes: EditorNode[]) {
  const containerTypeById = getContainerTypeById(nodes);
  return nodes.map((node) => {
    if (!node.containerId) return node;
    const containerType = node.containerType ?? containerTypeById.get(node.containerId);
    if (!containerType) {
      return {
        ...node,
        containerId: null,
        containerType: null,
        branchIndex: null
      };
    }
    const branchIndex =
      containerType === "parallel"
        ? typeof node.branchIndex === "number"
          ? node.branchIndex
          : 0
        : null;
    return {
      ...node,
      containerType,
      branchIndex
    };
  });
}

function normalizeContainerFrames(nodes: EditorNode[]) {
  return nodes.map((node) => {
    const containerType = getContainerType(node.kind);
    if (!containerType) return node;
    const branchCount = containerType === "parallel" ? getContainerBranchCount(node) : 1;
    const defaults = getDefaultContainerFrameSize(containerType, branchCount);
    const width = node.containerFrame?.width ?? defaults.width;
    const height = node.containerFrame?.height ?? defaults.height;
    const nextFrame: ContainerFrameData = {
      width,
      height,
      ...(containerType === "parallel" ? { branchCount } : {})
    };
    if (
      node.containerFrame &&
      node.containerFrame.width === nextFrame.width &&
      node.containerFrame.height === nextFrame.height &&
      node.containerFrame.branchCount === nextFrame.branchCount
    ) {
      return node;
    }
    return { ...node, containerFrame: nextFrame };
  });
}

function getTopologicalOrder(nodes: EditorNode[], edges: EditorEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = nodes.map((node) => node.id);
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  nodeIds.forEach((id) => {
    inDegree.set(id, 0);
    outgoing.set(id, []);
  });

  edges.forEach((edge) => {
    if (!inDegree.has(edge.to) || !outgoing.has(edge.from)) return;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });

  const queue = nodeIds
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .sort((a, b) => (nodeMap.get(a)?.name ?? "").localeCompare(nodeMap.get(b)?.name ?? ""));
  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    ordered.push(current);
    outgoing.get(current)?.forEach((to) => {
      inDegree.set(to, (inDegree.get(to) ?? 0) - 1);
      if (inDegree.get(to) === 0) {
        queue.push(to);
        queue.sort((a, b) => (nodeMap.get(a)?.name ?? "").localeCompare(nodeMap.get(b)?.name ?? ""));
      }
    });
  }

  const remaining = nodeIds.filter((id) => !ordered.includes(id));
  if (remaining.length > 0) {
    remaining.sort((a, b) => (nodeMap.get(a)?.name ?? "").localeCompare(nodeMap.get(b)?.name ?? ""));
  }
  return [...ordered, ...remaining];
}

function layoutNodesByLayers(
  nodes: EditorNode[],
  edges: EditorEdge[],
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  options: { padding: number; spacingX: number; rowGap: number }
) {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  nodes.forEach((node) => {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  });

  edges.forEach((edge) => {
    if (!inDegree.has(edge.to) || !outgoing.has(edge.from)) return;
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });

  const queue = Array.from(inDegree.entries())
    .filter(([, value]) => value === 0)
    .map(([id]) => id);
  const layers = new Map<string, number>();
  queue.forEach((id) => layers.set(id, 0));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const nextLayer = (layers.get(current) ?? 0) + 1;
    outgoing.get(current)?.forEach((to) => {
      layers.set(to, Math.max(layers.get(to) ?? 0, nextLayer));
      inDegree.set(to, (inDegree.get(to) ?? 1) - 1);
      if (inDegree.get(to) === 0) {
        queue.push(to);
      }
    });
  }

  nodes.forEach((node) => {
    if (!layers.has(node.id)) layers.set(node.id, 0);
  });

  const grouped = new Map<number, EditorNode[]>();
  nodes.forEach((node) => {
    const layer = layers.get(node.id) ?? 0;
    const group = grouped.get(layer) ?? [];
    group.push(node);
    grouped.set(layer, group);
  });

  Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([layer, group]) => {
      const sortedGroup = [...group].sort((a, b) => a.name.localeCompare(b.name));
      let yCursor = options.padding;
      sortedGroup.forEach((node) => {
        const nodeHeight = getNodeHeight(node, nodeTypeConfig);
        const x = options.padding + layer * options.spacingX;
        const y = yCursor;
        yCursor += nodeHeight + options.rowGap;
        positions.set(node.id, { x, y });
      });
    });

  return positions;
}

function layoutNodesInRegion(
  nodes: EditorNode[],
  edges: EditorEdge[],
  region: ContainerFrameRegion,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  direction: "vertical" | "horizontal"
) {
  const positions = new Map<string, { x: number; y: number }>();
  const ordered = getTopologicalOrder(nodes, edges);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  let yCursor = region.bounds.y + CONTAINER_LAYOUT.padding;
  let xCursor = region.bounds.x + CONTAINER_LAYOUT.padding;
  const anchorY = yCursor;
  const anchorX = xCursor;
  ordered.forEach((id) => {
    const node = nodeMap.get(id);
    if (!node) return;
    if (direction === "horizontal") {
      positions.set(id, { x: xCursor, y: anchorY });
      xCursor += NODE_METRICS.width + CONTAINER_LAYOUT.columnGap;
      return;
    }
    positions.set(id, { x: anchorX, y: yCursor });
    yCursor += getNodeHeight(node, nodeTypeConfig) + CONTAINER_LAYOUT.rowGap;
  });
  return positions;
}

function expandContainerFrameForNodes(
  containerNode: EditorNode,
  nodes: EditorNode[]
) {
  const containerType = getContainerType(containerNode.kind);
  if (!containerType) return containerNode;
  const branchCount = containerType === "parallel" ? getContainerBranchCount(containerNode) : 1;
  const branchCounts = Array.from({ length: branchCount }, (_, index) => {
    if (containerType === "repeat") {
      return nodes.filter((node) => node.containerId === containerNode.id).length;
    }
    return nodes.filter(
      (node) =>
        node.containerId === containerNode.id &&
        (node.branchIndex ?? 0) === index
    ).length;
  });
  const maxNodes = Math.max(1, ...branchCounts);
  // START/END 리본이 있는 노드를 고려한 카드의 실질 높이
  const nodeVisualHeight = NODE_METRICS.collapsedHeight + RIBBON_EXTRA_HEIGHT;
  let requiredWidth = CONTAINER_FRAME_DEFAULTS.width;
  let requiredHeight =
    CONTAINER_FRAME_METRICS.headerHeight +
    CONTAINER_FRAME_METRICS.padding * 2 +
    maxNodes * (nodeVisualHeight + CONTAINER_LAYOUT.rowGap) -
    CONTAINER_LAYOUT.rowGap;

  if (containerType === "parallel") {
    // Parallel: 브랜치는 세로 스택, 각 브랜치 안에서 노드들은 가로로 배치.
    // - 가로(width): 어떤 브랜치든 가장 많은 노드 수 기준으로 계산
    // - 세로(height): 브랜치 수 * 노드 높이 (+ 브랜치 간 rowGap)
    const perBranchWidth =
      CONTAINER_FRAME_METRICS.padding * 2 +
      maxNodes * (NODE_METRICS.width + CONTAINER_LAYOUT.columnGap) -
      CONTAINER_LAYOUT.columnGap;
    requiredWidth = Math.max(CONTAINER_FRAME_DEFAULTS.width, perBranchWidth);

    const baseHeightForBranches =
      branchCount * nodeVisualHeight +
      Math.max(0, branchCount - 1) * CONTAINER_LAYOUT.rowGap;
    requiredHeight =
      CONTAINER_FRAME_METRICS.headerHeight +
      CONTAINER_FRAME_METRICS.padding * 2 +
      baseHeightForBranches;
  }

  const nextFrame: ContainerFrameData = {
    width: Math.max(requiredWidth, CONTAINER_FRAME_METRICS.minWidth),
    height: Math.max(requiredHeight, CONTAINER_FRAME_METRICS.minHeight),
    ...(containerType === "parallel" ? { branchCount } : {})
  };
  return { ...containerNode, containerFrame: nextFrame };
}

function applyImportedLayout(
  nodes: EditorNode[],
  edges: EditorEdge[],
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  let nextNodes = normalizeContainerFrames(normalizeContainerAssignments(nodes));
  const containerTypeById = getContainerTypeById(nextNodes);
  const containerIds = new Set(containerTypeById.keys());
  nextNodes = nextNodes.map((node) =>
    isContainerNode(node) ? expandContainerFrameForNodes(node, nextNodes) : node
  );

  const topLevelNodes = nextNodes.filter(
    (node) => !node.containerId || !containerIds.has(node.containerId)
  );
  const topLevelNodeIds = new Set(topLevelNodes.map((node) => node.id));
  const topLevelEdges = edges.filter(
    (edge) => topLevelNodeIds.has(edge.from) && topLevelNodeIds.has(edge.to)
  );
  const topLevelPositions = layoutNodesByLayers(topLevelNodes, topLevelEdges, nodeTypeConfig, {
    padding: 80,
    spacingX: 320,
    rowGap: 60
  });

  nextNodes = nextNodes.map((node) => {
    if (topLevelPositions.has(node.id)) {
      return { ...node, position: topLevelPositions.get(node.id)! };
    }
    return node;
  });

  containerIds.forEach((containerId) => {
    const containerNode = nextNodes.find((node) => node.id === containerId);
    if (!containerNode) return;
    const layout = getContainerFrameLayout(containerNode, nodeTypeConfig);
    if (!layout) return;
    const containerType = getContainerType(containerNode.kind);
    if (!containerType) return;
    if (containerType === "repeat") {
      const bodyNodes = nextNodes.filter((node) => node.containerId === containerId);
      const bodyNodeIds = new Set(bodyNodes.map((node) => node.id));
      const bodyEdges = edges.filter(
        (edge) => bodyNodeIds.has(edge.from) && bodyNodeIds.has(edge.to)
      );
      const positions = layoutNodesInRegion(
        bodyNodes,
        bodyEdges,
        layout.regions[0],
        nodeTypeConfig,
        "vertical"
      );
      nextNodes = nextNodes.map((node) =>
        positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node
      );
      return;
    }
    layout.regions.forEach((region) => {
      const branchNodes = nextNodes.filter(
        (node) =>
          node.containerId === containerId &&
          (node.branchIndex ?? 0) === region.index
      );
      const branchNodeIds = new Set(branchNodes.map((node) => node.id));
      const branchEdges = edges.filter(
        (edge) => branchNodeIds.has(edge.from) && branchNodeIds.has(edge.to)
      );
      const positions = layoutNodesInRegion(
        branchNodes,
        branchEdges,
        region,
        nodeTypeConfig,
        "horizontal"
      );
      nextNodes = nextNodes.map((node) =>
        positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node
      );
    });
  });

  return nextNodes;
}

function getCanvasSizeForNodes(
  nodes: EditorNode[],
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  heightMap?: Map<string, number>
) {
  let maxX = CANVAS_DEFAULT.width;
  let maxY = CANVAS_DEFAULT.height;
  nodes.forEach((node) => {
    const nodeHeight = heightMap?.get(node.id) ?? getNodeHeight(node, nodeTypeConfig);
    maxX = Math.max(maxX, node.position.x + NODE_METRICS.width + CANVAS_PADDING.x);
    maxY = Math.max(maxY, node.position.y + nodeHeight + CANVAS_PADDING.y);
    if (isContainerNode(node)) {
      const layout = getContainerFrameLayout(node, nodeTypeConfig);
      if (layout) {
        maxX = Math.max(
          maxX,
          layout.frame.x + layout.frame.width + CANVAS_PADDING.x
        );
        maxY = Math.max(
          maxY,
          layout.frame.y + layout.frame.height + CANVAS_PADDING.y
        );
      }
    }
  });
  return { width: maxX, height: maxY };
}

function parseDslToEditor(
  dslJson: Record<string, unknown>,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
): ParsedEditorGraph | null {
  if (!isRecord(dslJson)) return null;
  const states = (dslJson as { States?: Record<string, DslState> }).States;
  if (!states || !isRecord(states)) return null;

  const rawInputs = (dslJson as { Inputs?: Record<string, { Type?: unknown; Value?: unknown }> }).Inputs;
  let varRowIndex = 1;
  const inputVariableRows: VariableRow[] = isRecord(rawInputs)
    ? Object.entries(rawInputs)
        .filter(([name]) => typeof name === "string" && name.trim() !== "")
        .map(([name, entry]) => {
          const item = isRecord(entry) ? entry : {};
          const rawType = item.Type;
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
          const rawValue = item.Value;
          const value =
            typeof rawValue === "string"
              ? rawValue
              : typeof rawValue === "number"
                ? String(rawValue)
                : typeof rawValue === "boolean"
                  ? rawValue ? "true" : "false"
                  : "";
          return {
            id: `var-${varRowIndex++}`,
            name: name.trim(),
            value,
            valueType
          };
        })
    : [];

  let nodeIndex = 1;
  let edgeIndex = 1;
  let conditionIndex = 1;
  const nodes: EditorNode[] = [];
  const edges: EditorEdge[] = [];

  const createNodeKind = (state: DslState, stateName: string): NodeKind => {
    if (state.Type === "Condition") return "flow_control.condition";
    if (state.Type === "Choice") return "flow_control.condition";
    if (state.Type === "Succeed") return "flow_control.output";
    if (state.Type === "Pass") return "flow_control.input";
    if (state.Type === "Parallel") return "flow_control.parallel";
    if (state.Type === "Repeat") return "flow_control.repeat";
    const skillName = typeof state.Skill === "string" ? state.Skill : stateName;
    return `skill.${skillName}` as NodeKind;
  };

  const parseStateGroup = (
    groupStates: Record<string, DslState>,
    context?: { containerId?: string; containerType?: ContainerType; branchIndex?: number }
  ) => {
    const idByState = new Map<string, string>();
    Object.entries(groupStates).forEach(([stateName, state]) => {
      const kind = createNodeKind(state, stateName);
      const id = `node-${nodeIndex++}`;
      idByState.set(stateName, id);
      const params = isRecord(state.Parameters)
        ? Object.entries(state.Parameters).reduce(
            (acc, [key, value]) => ({
              ...acc,
              [key]: typeof value === "string" ? value : JSON.stringify(value)
            }),
            {} as Record<string, string>
          )
        : {};
      if (kind === "flow_control.repeat" && typeof state.Count === "number") {
        params.count = `${state.Count}`;
      }
      let conditionExpressions: ConditionExpression[] | undefined;
      if (kind === "flow_control.condition") {
        const ifCond = isRecord(state.If) && isRecord(state.If.Condition) ? state.If.Condition : null;
        if (ifCond) {
          const variable = typeof ifCond.Variable === "string" ? ifCond.Variable.replace(/^\$\.?/, "") : "";
          const comparisonOperator = typeof ifCond.Operator === "string" ? ifCond.Operator : "==";
          const rawVal = ifCond.Value;
          const value =
            typeof rawVal === "string"
              ? rawVal
              : typeof rawVal === "number"
                ? String(rawVal)
                : typeof rawVal === "boolean"
                  ? rawVal ? "true" : "false"
                  : "";
          conditionExpressions = [
            {
              id: `condition-${conditionIndex++}`,
              operator: null,
              variable,
              comparisonOperator,
              value
            }
          ];
        } else if (Array.isArray(state.Expressions)) {
          conditionExpressions = state.Expressions.map((expression) => {
            const parsed = parseConditionExpressionString(
              (expression as { expression?: string }).expression ?? ""
            );
            return {
              id: `condition-${conditionIndex++}`,
              operator:
                (expression as { operator?: string }).operator === "AND" ||
                (expression as { operator?: string }).operator === "OR"
                  ? ((expression as { operator: ConditionOperator }).operator as ConditionOperator)
                  : null,
              variable: parsed.variable,
              comparisonOperator: parsed.comparisonOperator,
              value: parsed.value
            };
          });
        }
        if (!conditionExpressions || conditionExpressions.length === 0) {
          conditionExpressions = [
            {
              id: `condition-${conditionIndex++}`,
              operator: null,
              variable: "",
              comparisonOperator: "==",
              value: ""
            }
          ];
        }
      }
      nodes.push({
        id,
        name: state.Label ?? stateName,
        kind,
        position: { x: 0, y: 0 },
        isExpanded: false,
        params,
        conditionExpressions,
        variableRows:
          kind === "flow_control.input"
            ? inputVariableRows
            : kind === "flow_control.output"
              ? []
              : undefined,
        containerId: context?.containerId ?? null,
        containerType: context?.containerType ?? null,
        branchIndex:
          context?.containerType === "parallel" ? context.branchIndex ?? 0 : null,
        containerFrame:
          kind === "flow_control.parallel"
            ? {
                ...getDefaultContainerFrameSize(
                  "parallel",
                  Array.isArray(state.Branches)
                    ? Math.max(DEFAULT_PARALLEL_BRANCHES, state.Branches.length)
                    : DEFAULT_PARALLEL_BRANCHES
                ),
                branchCount: Array.isArray(state.Branches)
                  ? Math.max(DEFAULT_PARALLEL_BRANCHES, state.Branches.length)
                  : DEFAULT_PARALLEL_BRANCHES
              }
            : kind === "flow_control.repeat"
              ? getDefaultContainerFrameSize("repeat", 1)
              : undefined
      });
    });

    Object.entries(groupStates).forEach(([stateName, state]) => {
      const fromId = idByState.get(stateName);
      if (!fromId) return;
      if (state.Type === "Condition" && isRecord(state.If)) {
        const thenStateName = state.If.Then;
        const elseStateName = state.Else;
        const trueTarget = typeof thenStateName === "string" ? idByState.get(thenStateName) : undefined;
        const falseTarget = typeof elseStateName === "string" ? idByState.get(elseStateName) : undefined;
        if (trueTarget) {
          edges.push({
            id: `edge-${edgeIndex++}`,
            from: fromId,
            fromPort: "true",
            to: trueTarget
          });
        }
        if (falseTarget) {
          edges.push({
            id: `edge-${edgeIndex++}`,
            from: fromId,
            fromPort: "false",
            to: falseTarget
          });
        }
      } else if (state.Type === "Choice" && Array.isArray(state.Choices)) {
        const trueChoice = state.Choices.find(
          (choice) => isRecord(choice) && (choice as { BooleanEquals?: unknown }).BooleanEquals === true
        );
        const falseChoice = state.Choices.find(
          (choice) => isRecord(choice) && (choice as { BooleanEquals?: unknown }).BooleanEquals === false
        );
        const remainingChoices = state.Choices.filter(
          (choice) => choice !== trueChoice && choice !== falseChoice
        );
        const resolveNext = (choice: Record<string, unknown> | undefined) => {
          const next = choice?.Next;
          return typeof next === "string" ? idByState.get(next) : undefined;
        };
        const trueTarget =
          resolveNext(trueChoice as Record<string, unknown> | undefined) ??
          resolveNext(remainingChoices[0] as Record<string, unknown> | undefined);
        const falseTarget =
          resolveNext(falseChoice as Record<string, unknown> | undefined) ??
          resolveNext(remainingChoices[1] as Record<string, unknown> | undefined);
        if (trueTarget) {
          edges.push({
            id: `edge-${edgeIndex++}`,
            from: fromId,
            fromPort: "true",
            to: trueTarget
          });
        }
        if (falseTarget) {
          edges.push({
            id: `edge-${edgeIndex++}`,
            from: fromId,
            fromPort: "false",
            to: falseTarget
          });
        }
      } else if (typeof state.Next === "string" && idByState.has(state.Next)) {
        edges.push({
          id: `edge-${edgeIndex++}`,
          from: fromId,
          fromPort: "next",
          to: idByState.get(state.Next) as string
        });
      }
    });

    Object.entries(groupStates).forEach(([stateName, state]) => {
      const containerId = idByState.get(stateName);
      if (!containerId) return;
      if (state.Type === "Repeat" && state.Body?.States) {
        parseStateGroup(state.Body.States, {
          containerId,
          containerType: "repeat",
          branchIndex: 0
        });
      }
      if (state.Type === "Parallel" && Array.isArray(state.Branches)) {
        state.Branches.forEach((branch, index) => {
          if (!branch.States) return;
          parseStateGroup(branch.States, {
            containerId,
            containerType: "parallel",
            branchIndex: index
          });
        });
      }
    });
  };

  parseStateGroup(states);

  let nextNodes = applyImportedLayout(nodes, edges, nodeTypeConfig);
  nextNodes = normalizeContainerFrames(normalizeContainerAssignments(nextNodes));
  const canvas = getCanvasSizeForNodes(nextNodes, nodeTypeConfig);
  return {
    nodes: nextNodes,
    edges: filterEdgesByContainerRules(nextNodes, edges),
    canvas: { ...canvas, zoom: 1 }
  };
}

function downloadJsonFile(fileName: string, data: Record<string, unknown>) {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function NodeCard({
  node,
  config,
  isSelected,
  inputConnected,
  outputs,
  onSelect,
  onToggleExpand,
  onDragStart,
  onStartConnect,
  onCompleteConnect,
  onParamChange,
  onConditionExpressionFieldChange,
  onAddConditionExpression,
  onRemoveConditionExpression,
  onVariableRowChange,
  onAddVariableRow,
  onRemoveVariableRow,
  onNameChange,
  isEditingName,
  onStartEditName,
  onFinishEditName,
  onOutputDragStart,
  onOutputDragEnd,
  onInputDragOver,
  onInputDrop,
  warningLabel,
  startEndBadge,
  effectiveHeight,
  nodeTypeConfig,
  skillset,
  nodes,
  edges,
  stateNameMap,
  skillsetMap
}: {
  node: EditorNode;
  config: NodeTypeConfig;
  isSelected: boolean;
  inputConnected: boolean;
  outputs: Array<{
    key: string;
    label: string;
    isConnected: boolean;
    isActive: boolean;
  }>;
  onSelect: () => void;
  onToggleExpand: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartConnect: (portKey: string) => void;
  onCompleteConnect: () => void;
  onParamChange: (key: string, value: string) => void;
  onConditionExpressionFieldChange: (
    expressionId: string,
    field: "variable" | "comparisonOperator" | "value",
    value: string
  ) => void;
  onAddConditionExpression: (operator: ConditionOperator) => void;
  onRemoveConditionExpression: (expressionId: string) => void;
  onVariableRowChange?: (rowId: string, field: "name" | "value", value: string) => void;
  onAddVariableRow?: (valueType: VariableValueType) => void;
  onRemoveVariableRow?: (rowId: string) => void;
  onNameChange: (value: string) => void;
  isEditingName: boolean;
  onStartEditName: () => void;
  onFinishEditName: () => void;
  onOutputDragStart: (event: DragEvent<HTMLButtonElement>, portKey: string) => void;
  onOutputDragEnd: () => void;
  onInputDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onInputDrop: (event: DragEvent<HTMLButtonElement>) => void;
  warningLabel?: string | null;
  startEndBadge?: {
    showStart: boolean;
    showEnd: boolean;
    isRootScope: boolean;
    startError?: string;
  } | null;
  /** 리본이 있을 때 포함한 전체 높이. 미전달 시 getNodeHeight만 사용(과거 동작) */
  effectiveHeight?: number;
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>;
  skillset?: import("@/domain/types").Skillset;
  nodes: EditorNode[];
  edges: EditorEdge[];
  stateNameMap: Map<string, string>;
  skillsetMap: Map<string, import("@/domain/types").Skillset>;
}) {
  const nodeHeight = getNodeHeight(node, nodeTypeConfig);
  const displayHeight = effectiveHeight ?? nodeHeight;
  const availableVariables = useMemo(
    () =>
      getAvailableVariables(
        node.id,
        nodes,
        edges,
        stateNameMap,
        (kind) => skillsetMap.get(kind)?.outputs
      ),
    [node.id, nodes, edges, stateNameMap, skillsetMap]
  );
  const outputOffsets = getPortOffsets(displayHeight, outputs.length);
  const conditionExpressions =
    node.kind === "flow_control.condition" ? node.conditionExpressions ?? [] : [];

  // 노드 타입별 색상 (Monitor와 동일)
  const getNodeTypeColors = (category: NodeCategory, kind: NodeKind) => {
    if (kind === "flow_control.condition") {
      return {
        border: "border-amber-200",
        bg: "bg-amber-50",
        text: "text-amber-700",
        indicator: "bg-amber-500"
      };
    }
    if (category === "skill") {
      return {
        border: "border-blue-200",
        bg: "bg-blue-50",
        text: "text-blue-700",
        indicator: "bg-blue-500"
      };
    }
    if (category === "event") {
      return {
        border: "border-purple-200",
        bg: "bg-purple-50",
        text: "text-purple-700",
        indicator: "bg-purple-500"
      };
    }
    // flow_control
    return {
      border: "border-cyan-200",
      bg: "bg-cyan-50",
      text: "text-cyan-700",
      indicator: "bg-cyan-500"
    };
  };

  const nodeTypeColors = getNodeTypeColors(config.category, node.kind);
  const nodeTypeLabel = node.kind === "flow_control.condition" 
    ? "Condition" 
    : NODE_CATEGORY_LABELS[config.category];

  // 툴팁 내용 생성
  const tooltipContent = skillset
    ? `${skillset.name} (${skillset.version})\nType: ${node.kind}\n\n${skillset.description}`
    : node.kind;

  const showStartRibbon =
    startEndBadge?.showStart && !startEndBadge?.showEnd && !startEndBadge?.startError;
  const showEndRibbon =
    Boolean(startEndBadge?.showEnd && !startEndBadge?.showStart);
  const showStartEndRibbon =
    Boolean(startEndBadge?.showStart && startEndBadge?.showEnd && !startEndBadge?.startError);
  const hasRibbon = showStartRibbon || showEndRibbon || showStartEndRibbon;

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 bg-white p-3 shadow-sm overflow-visible",
        isSelected ? "border-slate-900 ring-4 ring-slate-400 ring-offset-2" : "border-slate-200"
      )}
      data-node-card
      style={{
        width: NODE_METRICS.width,
        height: displayHeight
      }}
      onClick={onSelect}
      title={tooltipContent}
    >
      {/* Start/End 헤더 리본: 줌 아웃에서도 한눈에 구분. start+end 동시면 사선 구획 리본 */}
      {hasRibbon && (
        <>
          {showStartEndRibbon ? (
            <div
              className="absolute left-0 right-0 top-0 z-10 h-6 overflow-hidden rounded-t-[6px] shadow-sm"
              aria-hidden
            >
              {/* 사선으로 나눈 start(좌상) / end(우하) */}
              {/* 윗변 4:3, 아랫변 3:4 비율로 나누는 사선 */}
              <div
                className="absolute inset-0 bg-emerald-600"
                style={{ clipPath: "polygon(0 0, 57.14% 0, 42.86% 100%, 0 100%)" }}
              />
              <div
                className="absolute inset-0 bg-slate-500"
                style={{ clipPath: "polygon(57.14% 0, 100% 0, 100% 100%, 42.86% 100%)" }}
              />
              <span className="absolute left-1 top-0.5 text-[9px] font-bold text-white drop-shadow-sm">
                ▶ START
              </span>
              <span className="absolute right-1 bottom-0.5 text-[9px] font-bold text-white drop-shadow-sm">
                END ⏹
              </span>
            </div>
          ) : (
            <div
              className={cn(
                "absolute left-0 right-0 top-0 z-10 flex h-6 items-center justify-center rounded-t-[6px] text-[10px] font-bold text-white shadow-sm",
                showStartRibbon && "bg-emerald-600",
                showEndRibbon && "bg-slate-500"
              )}
              aria-hidden
            >
              {showStartRibbon ? "▶ START" : "⏹ END"}
            </div>
          )}
        </>
      )}
      {/* 왼쪽 타입 인디케이터 바 */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          nodeTypeColors.indicator
        )}
      />
      {config.inputEnabled !== false && (
        <button
          type="button"
          className={cn(
            "cursor-pointer absolute left-0 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-white shadow-sm z-10",
            inputConnected ? "border-slate-400" : "border-slate-200"
          )}
          style={{ top: displayHeight / 2 }}
          title={inputConnected ? "Input connected" : "Input"}
          onDragOver={(event) => {
            event.stopPropagation();
            onInputDragOver(event);
          }}
          onDrop={(event) => {
            event.stopPropagation();
            onInputDrop(event);
          }}
          onClick={(event) => {
            event.stopPropagation();
            onCompleteConnect();
          }}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              inputConnected ? "bg-slate-600" : "bg-slate-400"
            )}
          />
        </button>
      )}

      {outputs.map((output, index) => {
        // Output port 툴팁 내용 생성
        let outputTooltip = `Output: ${output.label}`;
        if (skillset) {
          // skill 노드의 경우 모든 outputs 정보를 표시
          if (output.key === "next" && Object.keys(skillset.outputs).length > 0) {
            const outputEntries = Object.entries(skillset.outputs);
            outputTooltip = outputEntries
              .map(([key, outputInfo]) => {
                return `${key}\nType: ${outputInfo.type}${outputInfo.description ? `\n${outputInfo.description}` : ""}`;
              })
              .join("\n\n");
          } else if (skillset.outputs[output.key]) {
            // 특정 output 키가 있는 경우
            const outputInfo = skillset.outputs[output.key];
            outputTooltip = `${output.key}\nType: ${outputInfo.type}${outputInfo.description ? `\n${outputInfo.description}` : ""}`;
          }
        }
        
        return (
          <div
            key={output.key}
            className="absolute right-0 flex items-center gap-1.5 z-20"
            style={{ top: outputOffsets[index], transform: "translate(50%, -50%)" }}
          >
            <button
              type="button"
              draggable
              className={cn(
                "cursor-pointer flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border bg-white shadow-sm",
                output.isActive
                  ? "border-slate-900"
                  : output.isConnected
                    ? "border-slate-400"
                    : "border-slate-200"
              )}
              title={outputTooltip}
            onDragStart={(event) => {
              event.stopPropagation();
              onOutputDragStart(event, output.key);
            }}
            onDragEnd={(event) => {
              event.stopPropagation();
              onOutputDragEnd();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onStartConnect(output.key);
            }}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                output.isActive
                  ? "bg-slate-900"
                  : output.isConnected
                    ? "bg-slate-600"
                    : "bg-slate-400"
              )}
            />
          </button>
        </div>
        );
      })}

      <div
        className={cn(
          "flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing pl-1",
          hasRibbon && "pt-6"
        )}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            target.closest("input") ||
            target.closest("button") ||
            target.closest("[data-no-drag]")
          ) {
            return;
          }
          event.stopPropagation();
          event.preventDefault();
          onDragStart(event);
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 min-w-0">
            {isEditingName ? (
              <input
                value={node.name}
                onChange={(event) => onNameChange(event.target.value)}
                onBlur={onFinishEditName}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.currentTarget.blur();
                    onFinishEditName();
                  }
                }}
                autoFocus
                className="flex-1 min-w-0 rounded border border-slate-200 bg-white text-sm font-semibold text-slate-800 focus:border-slate-300 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                data-no-drag
                className="cursor-pointer truncate text-left text-sm font-semibold text-slate-800 hover:text-slate-700 flex-1 min-w-0"
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onStartEditName();
                }}
                title="Double click to rename"
              >
                {node.name}
              </button>
            )}
          </div>
          
          {/* 노드 타입 배지 */}
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                nodeTypeColors.bg,
                nodeTypeColors.text,
                "border border-current"
              )}
            >
              {nodeTypeLabel}
            </span>
          </div>

          {/* Skill 노드: 펼쳤을 때 실제 Skill 이름도 노출 */}
          {skillset && node.isExpanded && (
            <div className="mb-1 text-[10px] text-slate-500 truncate" title={skillset.name}>
              {skillset.name}
            </div>
          )}

        </div>
        {warningLabel && (
          <span className="mt-1 inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-700">
            {warningLabel}
          </span>
        )}
        <button
          type="button"
          data-no-drag
          className="cursor-pointer flex-shrink-0 text-slate-500 hover:text-slate-900"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {node.isExpanded ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 15.75l7.5-7.5 7.5 7.5"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 8.25l-7.5 7.5-7.5-7.5"
              />
            </svg>
          )}
        </button>
      </div>


      {node.isExpanded && node.kind === "flow_control.condition" && (
        <div className="mt-3 space-y-2 text-xs text-slate-600 pr-12">
          {conditionExpressions.map((expression, index) => (
            <div key={expression.id} className="space-y-1">
              <span className="text-[10px] text-slate-500">Expression</span>

              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                {index > 0 && (
                  <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
                    {expression.operator}
                  </span>
                )}
                <div className="flex-1 min-w-[80px]" data-no-drag>
                  <VariableInput
                    value={expression.variable}
                    onChange={(value) =>
                      onConditionExpressionFieldChange(
                        expression.id,
                        "variable",
                        value
                      )
                    }
                    placeholder="$.var or $"
                    suggestions={availableVariables}
                  />
                </div>
                <select
                  value={expression.comparisonOperator}
                  onChange={(e) =>
                    onConditionExpressionFieldChange(
                      expression.id,
                      "comparisonOperator",
                      e.target.value
                    )
                  }
                  className="flex-shrink-0 w-16 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                  data-no-drag
                >
                  {CONDITION_COMPARISON_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <div className="flex-1 min-w-[80px]" data-no-drag>
                  <VariableInput
                    value={expression.value}
                    onChange={(value) =>
                      onConditionExpressionFieldChange(
                        expression.id,
                        "value",
                        value
                      )
                    }
                    placeholder="value or $"
                    suggestions={availableVariables}
                  />
                </div>
                {index > 0 && (
                  <button
                    type="button"
                    data-no-drag
                    className="cursor-pointer flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveConditionExpression(expression.id);
                    }}
                    title="Remove expression"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      stroke="currentColor"
                      className="h-3.5 w-3.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 12h-15"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-no-drag
              className="cursor-pointer rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
              onClick={(e) => {
                e.stopPropagation();
                onAddConditionExpression("AND");
              }}
            >
              AND
            </button>
            <button
              type="button"
              data-no-drag
              className="cursor-pointer rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
              onClick={(e) => {
                e.stopPropagation();
                onAddConditionExpression("OR");
              }}
            >
              OR
            </button>
          </div>
        </div>
      )}
      {node.isExpanded &&
        node.kind !== "flow_control.condition" &&
        (node.kind === "flow_control.input" || node.kind === "flow_control.output") &&
        node.variableRows && (
          <div className="mt-3 space-y-2 text-xs text-slate-600">
            {node.variableRows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 min-w-0">
                <input
                  value={row.name}
                  onChange={(event) =>
                    onVariableRowChange?.(row.id, "name", event.target.value)
                  }
                  placeholder="variable"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                />
                <input
                  value={row.value}
                  onChange={(event) =>
                    onVariableRowChange?.(row.id, "value", event.target.value)
                  }
                  placeholder={row.valueType}
                  className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                />
                {node.variableRows && node.variableRows.length > 0 && (
                  <button
                    type="button"
                    data-no-drag
                    className="cursor-pointer flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveVariableRow?.(row.id);
                    }}
                    title="Remove row"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      stroke="currentColor"
                      className="h-3.5 w-3.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 12h-15"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-1">
              {(["int", "bool", "double", "string"] as VariableValueType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  data-no-drag
                  className="cursor-pointer rounded-full border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddVariableRow?.(type);
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}
      {node.isExpanded &&
        node.kind !== "flow_control.condition" &&
        (node.kind === "flow_control.input" || node.kind === "flow_control.output") &&
        !node.variableRows && (
          <div className="mt-3 space-y-2 text-xs text-slate-600">
            <div className="flex flex-wrap gap-1">
              {(["int", "bool", "double", "string"] as VariableValueType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  data-no-drag
                  className="cursor-pointer rounded-full border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddVariableRow?.(type);
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}
      {node.isExpanded &&
        node.kind !== "flow_control.condition" &&
        node.kind !== "flow_control.input" &&
        node.kind !== "flow_control.output" &&
        config.paramFields.length > 0 && (
          <div className="mt-3 space-y-2 text-xs text-slate-600">
            {config.paramFields.map((field) => (
              <label key={field.key} className="block">
                <span className="text-[10px] text-slate-500">{field.label}</span>
                <div className="mt-1" data-no-drag>
                  <VariableInput
                    value={node.params[field.key] ?? ""}
                    onChange={(value) => onParamChange(field.key, value)}
                    placeholder={
                      field.placeholder ? `${field.placeholder} or $` : undefined
                    }
                    suggestions={availableVariables}
                    className="mt-1"
                  />
                </div>
              </label>
            ))}
          </div>
        )}
    </div>
  );
}

export function EditorPage({ workflowId }: EditorPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isNewWorkflow = workflowId === "new";
  const [showPalette, setShowPalette] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<ConnectingState>(null);
  const [selectedCategory, setSelectedCategory] = useState<NodeCategory>("skill");
  const [zoom, setZoom] = useState(1);
  const [canvasBase, setCanvasBase] = useState(() => {
    // 초기값은 CANVAS_DEFAULT로 설정, 마운트 후 뷰포트 크기로 업데이트
    return CANVAS_DEFAULT;
  });
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftOverride, setDraftOverride] = useState<WorkflowDraft | null>(null);
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<EditorEdge[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [isEditingWorkflowName, setIsEditingWorkflowName] = useState(false);
  const [workflowName, setWorkflowName] = useState<string>("");
  const [originalWorkflowName, setOriginalWorkflowName] = useState<string>("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [publishToast, setPublishToast] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const edgeErrorTimerRef = useRef<number | null>(null);
  const nextNodeIndex = useRef(1);
  const nextEdgeIndex = useRef(1);
  const nextConditionIndex = useRef(1);
  const nextVariableRowIndex = useRef(1);
  const loadedWorkflowId = useRef<string | null>(null);

  const { data: draft } = useQuery({
    queryKey: ["workflow-draft", workflowId],
    queryFn: () => workflowsApi.getDraft(workflowId),
    enabled: !isNewWorkflow
  });

  const { data: workflows, isLoading: isLoadingWorkflows } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });

  // Skillset 가져오기 (초기화 시 한 번만)
  const { data: skillsetsResponse } = useQuery({
    queryKey: ["skillsets"],
    queryFn: () => skillsetsApi.list()
  });

  // Skillset 기반으로 동적 노드 타입 생성
  const nodeTypeConfig = useMemo(() => {
    if (!skillsetsResponse) {
      return STATIC_NODE_TYPE_CONFIG as Record<NodeKind, NodeTypeConfig>;
    }
    return createNodeTypeConfigFromSkillsets(skillsetsResponse.skillsets);
  }, [skillsetsResponse]);

  // Skillset 정보를 노드 kind로 매핑
  const skillsetMap = useMemo(() => {
    if (!skillsetsResponse) return new Map<string, import("@/domain/types").Skillset>();
    const map = new Map<string, import("@/domain/types").Skillset>();
    skillsetsResponse.skillsets.forEach((skillset) => {
      map.set(`skill.${skillset.name}`, skillset);
    });
    return map;
  }, [skillsetsResponse]);

  // 노드 id → DSL state name (변수 참조 자동완성용)
  const stateNameMap = useMemo(() => buildStateNameMap(nodes), [nodes]);

  // 노드 타입 목록 생성
  const nodeTypes = useMemo(() => {
    const staticTypes: NodeKind[] = [
      "flow_control.input",
      "flow_control.condition",
      "flow_control.output",
      "flow_control.repeat",
      "flow_control.parallel",
      "event.webhook"
    ];
    const skillTypes: NodeKind[] = skillsetsResponse?.skillsets.map(
      (s) => `skill.${s.name}` as NodeKind
    ) ?? [];
    return [...skillTypes, ...staticTypes];
  }, [skillsetsResponse]);

  const activeDraft = draftOverride ?? draft;
  
  // 현재 workflow의 이름 가져오기
  useEffect(() => {
    if (!workflows) return;
    const currentWorkflow = workflows.find((w) => w.workflowId === workflowId);
    if (!currentWorkflow) return;
    // 이미 에디터에서 이름을 설정한 경우에는 리스트 refetch로 덮어쓰지 않음
    if (workflowName || originalWorkflowName) return;
    setWorkflowName(currentWorkflow.name);
    setOriginalWorkflowName(currentWorkflow.name);
  }, [workflows, workflowId, workflowName, originalWorkflowName]);

  const getViewportCanvasSize = useCallback(() => {
    if (!containerRef.current) return CANVAS_DEFAULT;
    const rect = containerRef.current.getBoundingClientRect();
    // 뷰포트 크기와 기본 크기 중 더 큰 값 사용
    return {
      width: Math.max(CANVAS_DEFAULT.width, Math.ceil(rect.width)),
      height: Math.max(CANVAS_DEFAULT.height, Math.ceil(rect.height))
    };
  }, []);

  const applyDraftToEditor = useCallback((draftToApply: WorkflowDraft | null) => {
    const getSize = () => {
      const viewportSize = getViewportCanvasSize();
      return viewportSize;
    };

    if (!draftToApply) {
      setNodes([]);
      setEdges([]);
      setCanvasBase(getSize());
      setZoom(1);
      setHasUnsavedChanges(false);
      return;
    }
    const parsed = parseEditorView(draftToApply.view_json, nodeTypes);
    let loadedNodes: EditorNode[] = [];
    let loadedEdges: EditorEdge[] = [];
    let canvas = parsed?.canvas;

    if (parsed) {
      const normalizedNodes = normalizeContainerFrames(
        normalizeContainerAssignments(parsed.nodes)
      );
      loadedNodes = normalizedNodes;
      loadedEdges = filterEdgesByContainerRules(normalizedNodes, parsed.edges);
    } else {
      const imported = parseDslToEditor(draftToApply.dsl_json, nodeTypeConfig);
      if (imported) {
        loadedNodes = imported.nodes;
        loadedEdges = imported.edges;
        canvas = imported.canvas;
      }
    }

    if (loadedNodes.length === 0 && loadedEdges.length === 0) {
      setNodes([]);
      setEdges([]);
      setCanvasBase(getSize());
      setZoom(1);
      setHasUnsavedChanges(false);
      return;
    }

    setNodes(loadedNodes);
    setEdges(loadedEdges);
    if (canvas) {
      const viewportSize = getViewportCanvasSize();
      setCanvasBase({
        width: Math.max(viewportSize.width, canvas.width),
        height: Math.max(viewportSize.height, canvas.height)
      });
      setZoom(clamp(canvas.zoom, ZOOM_LIMITS.min, ZOOM_LIMITS.max));
    } else {
      setCanvasBase(getSize());
      setZoom(1);
    }
    nextNodeIndex.current = getNextIndexFromIds(
      loadedNodes.map((node) => node.id),
      "node"
    );
    nextEdgeIndex.current = getNextIndexFromIds(
      loadedEdges.map((edge) => edge.id),
      "edge"
    );
    const conditionIds = loadedNodes.flatMap(
      (node) => node.conditionExpressions ?? []
    );
    nextConditionIndex.current = getNextIndexFromIds(
      conditionIds.map((expression) => expression.id),
      "condition"
    );
    const variableRowIds = loadedNodes.flatMap(
      (node) => node.variableRows ?? []
    );
    nextVariableRowIndex.current = getNextIndexFromIds(
      variableRowIds.map((row) => row.id),
      "var"
    );
    setSelectedNode(null);
    setSelectedEdgeId(null);
    setConnectingFrom(null);
    setEditingNodeId(null);
    setHasUnsavedChanges(false);
  }, [nodeTypeConfig, nodeTypes, getViewportCanvasSize]);

  useEffect(() => {
    if (!activeDraft) return;
    if (loadedWorkflowId.current === activeDraft.workflowId) return;
    loadedWorkflowId.current = activeDraft.workflowId;
    applyDraftToEditor(activeDraft);
  }, [activeDraft, applyDraftToEditor]);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateCanvasSize = () => {
      const viewportSize = getViewportCanvasSize();
      setCanvasBase((prev) => {
        // 저장된 크기나 현재 크기가 뷰포트보다 작으면 뷰포트 크기로 확장
        // 하지만 저장된 크기가 더 크면 유지 (노드들이 밖으로 나가지 않도록)
        const newWidth = Math.max(viewportSize.width, prev.width);
        const newHeight = Math.max(viewportSize.height, prev.height);
        // 크기가 실제로 변경된 경우에만 업데이트
        if (newWidth !== prev.width || newHeight !== prev.height) {
          return { width: newWidth, height: newHeight };
        }
        return prev;
      });
    };

    // 초기 크기 설정 (컨테이너가 마운트된 후 약간의 지연)
    const timeoutId = setTimeout(() => {
      updateCanvasSize();
    }, 0);

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    
    resizeObserver.observe(containerRef.current);

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [getViewportCanvasSize]);

  const { data: validationErrors = [] } = useQuery({
    queryKey: ["workflow-validation", workflowId],
    queryFn: () => workflowsApi.validateDraft(workflowId),
    enabled: Boolean(draft)
  });

  const saveMutation = useMutation({
    mutationFn: ({
      workflowId: targetWorkflowId,
      payload
    }: {
      workflowId: string;
      payload: WorkflowDraft;
    }) => workflowsApi.saveDraft(targetWorkflowId, payload),
    onSuccess: (saved) => {
      setDraftOverride(saved);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      if (saved.workflowId !== workflowId) {
        router.replace(`/editor/${saved.workflowId}`);
      }
      setHasUnsavedChanges(false);
      // 테스트용: 저장된 DSL JSON 확인
      const dslString = JSON.stringify(saved.dsl_json ?? {}, null, 2);
      console.log("[Save] DSL JSON:", dslString);
      navigator.clipboard?.writeText(dslString).catch(() => {});
    }
  });

  const publishMutation = useMutation({
    mutationFn: () => workflowsApi.publish(workflowId),
    onSuccess: () => {
      setShowPublishConfirm(false);
      setPublishToast(true);
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    }
  });

  const containerEmptyBranches = useMemo(() => {
    const map = new Map<string, Set<number>>();
    nodes.forEach((node) => {
      if (!isContainerNode(node)) return;
      const containerType = getContainerType(node.kind);
      if (!containerType) return;
      const branchCount = getContainerBranchCount(node);
      const empty = new Set<number>();
      if (containerType === "repeat") {
        const hasBodyNodes = nodes.some((child) => child.containerId === node.id);
        if (!hasBodyNodes) {
          empty.add(0);
        }
      } else {
        for (let index = 0; index < branchCount; index += 1) {
          const hasBranchNodes = nodes.some(
            (child) =>
              child.containerId === node.id && (child.branchIndex ?? 0) === index
          );
          if (!hasBranchNodes) {
            empty.add(index);
          }
        }
      }
      if (empty.size > 0) {
        map.set(node.id, empty);
      }
    });
    return map;
  }, [nodes]);

  const containerWarningLabels = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node) => {
      const empty = containerEmptyBranches.get(node.id);
      if (!empty) return;
      const containerType = getContainerType(node.kind);
      if (containerType === "repeat") {
        map.set(node.id, "Empty body");
      } else {
        map.set(node.id, `${empty.size} empty`);
      }
    });
    return map;
  }, [containerEmptyBranches, nodes]);

  const containerWarnings = useMemo<ValidationError[]>(() => {
    const warnings: ValidationError[] = [];
    nodes.forEach((node) => {
      const empty = containerEmptyBranches.get(node.id);
      if (!empty) return;
      const containerType = getContainerType(node.kind);
      if (containerType === "repeat") {
        warnings.push({
          id: `${node.id}-empty-body`,
          message: "Repeat body is empty.",
          nodeId: node.id
        });
        return;
      }
      empty.forEach((index) => {
        warnings.push({
          id: `${node.id}-branch-${index}`,
          message: `Parallel branch ${index + 1} is empty.`,
          nodeId: node.id
        });
      });
    });
    return warnings;
  }, [containerEmptyBranches, nodes]);

  const { startEndValidationErrors, startEndBadges } = useMemo(() => {
    const containerTypeById = getContainerTypeById(nodes);
    const containerIds = new Set(nodes.filter(isContainerNode).map((n) => n.id));
    const topLevelNodes = nodes.filter(
      (n) => !n.containerId || !containerIds.has(n.containerId)
    );
    const topLevelNodeIds = new Set(topLevelNodes.map((n) => n.id));
    const validEdgesLocal = edges.filter((edge) => {
      const fromNode = nodes.find((n) => n.id === edge.from);
      const toNode = nodes.find((n) => n.id === edge.to);
      if (!fromNode || !toNode) return false;
      const fromKey = getNodeContainerKey(fromNode, containerTypeById);
      const toKey = getNodeContainerKey(toNode, containerTypeById);
      if (!fromKey && !toKey) return true;
      return fromKey !== null && fromKey === toKey;
    });

    const scopes: Array<{
      scopeKey: string;
      nodeIds: string[];
      edges: Array<{ from: string; to: string }>;
      isRoot: boolean;
      containerId?: string;
    }> = [];

    scopes.push({
      scopeKey: "root",
      nodeIds: topLevelNodes.map((n) => n.id),
      edges: validEdgesLocal
        .filter((e) => topLevelNodeIds.has(e.from) && topLevelNodeIds.has(e.to))
        .map((e) => ({ from: e.from, to: e.to })),
      isRoot: true
    });

    nodes.forEach((node) => {
      if (!isContainerNode(node)) return;
      const containerType = getContainerType(node.kind);
      if (!containerType) return;
      if (containerType === "repeat") {
        const bodyNodes = nodes.filter((n) => n.containerId === node.id);
        const bodyIds = new Set(bodyNodes.map((n) => n.id));
        scopes.push({
          scopeKey: `${node.id}:body`,
          nodeIds: bodyNodes.map((n) => n.id),
          edges: validEdgesLocal
            .filter((e) => bodyIds.has(e.from) && bodyIds.has(e.to))
            .map((e) => ({ from: e.from, to: e.to })),
          isRoot: false,
          containerId: node.id
        });
        return;
      }
      const branchCount = getContainerBranchCount(node);
      for (let index = 0; index < branchCount; index += 1) {
        const branchNodes = nodes.filter(
          (n) =>
            n.containerId === node.id && (n.branchIndex ?? 0) === index
        );
        const branchIds = new Set(branchNodes.map((n) => n.id));
        scopes.push({
          scopeKey: `${node.id}:branch:${index}`,
          nodeIds: branchNodes.map((n) => n.id),
          edges: validEdgesLocal
            .filter((e) => branchIds.has(e.from) && branchIds.has(e.to))
            .map((e) => ({ from: e.from, to: e.to })),
          isRoot: false,
          containerId: node.id
        });
      }
    });

    const validationErrorsList: ValidationError[] = [];
    const badges = new Map<
      string,
      {
        showStart: boolean;
        showEnd: boolean;
        isRootScope: boolean;
        startError?: string;
      }
    >();

    const expandedContainerIds = new Set(
      nodes.filter((n) => isContainerNode(n) && n.isExpanded).map((n) => n.id)
    );

    scopes.forEach((scope) => {
      const graph: ScopeGraph = {
        nodeIds: scope.nodeIds,
        edges: scope.edges
      };
      const result = computeStartEndForScope(graph);
      const showBadges = scope.isRoot || (scope.containerId != null && expandedContainerIds.has(scope.containerId));

      if (result.startError) {
        const scopeLabel = scope.isRoot
          ? "Root workflow"
          : scope.scopeKey.includes(":body")
            ? `Repeat body (${scope.containerId})`
            : `Parallel branch (${scope.containerId})`;
        validationErrorsList.push({
          id: `start-end-${scope.scopeKey}`,
          message: `${scopeLabel}: ${result.startError}`,
          nodeId: scope.containerId ?? undefined
        });
      }

      const startCandidateSet = new Set(result.startCandidateIds ?? []);

      scope.nodeIds.forEach((nodeId) => {
        const isStart = result.startNodeId === nodeId;
        const isStartCandidateWithError =
          showBadges && result.startError && startCandidateSet.has(nodeId);
        const isEnd = result.endNodeIds.includes(nodeId);
        const existing = badges.get(nodeId);
        badges.set(nodeId, {
          showStart:
            (existing?.showStart ?? false) ||
            (showBadges && (isStart || isStartCandidateWithError)),
          showEnd: (existing?.showEnd ?? false) || (showBadges && isEnd),
          isRootScope: existing?.isRootScope ?? scope.isRoot,
          startError:
            existing?.startError ??
            (isStartCandidateWithError ? result.startError : undefined)
        });
      });
    });

    return {
      startEndValidationErrors: validationErrorsList,
      startEndBadges: badges
    };
  }, [nodes, edges]);

  const effectiveNodeHeightMap = useMemo(() => {
    const map = new Map<string, number>();
    nodes.forEach((node) => {
      const badge = startEndBadges.get(node.id);
      const hasRibbon = Boolean(badge?.showStart || badge?.showEnd);
      map.set(node.id, getEffectiveNodeHeight(node, nodeTypeConfig, hasRibbon));
    });
    return map;
  }, [nodes, nodeTypeConfig, startEndBadges]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const required = getCanvasSizeForNodes(nodes, nodeTypeConfig, effectiveNodeHeightMap);
    setCanvasBase((prev) => {
      const nextWidth = Math.max(prev.width, required.width);
      const nextHeight = Math.max(prev.height, required.height);
      if (nextWidth === prev.width && nextHeight === prev.height) {
        return prev;
      }
      return { width: nextWidth, height: nextHeight };
    });
  }, [nodes, nodeTypeConfig, effectiveNodeHeightMap]);

  const allValidationErrors = useMemo(
    () => [...validationErrors, ...containerWarnings, ...startEndValidationErrors],
    [containerWarnings, validationErrors, startEndValidationErrors]
  );

  const hasErrors = allValidationErrors.length > 0;

  const nodeMap = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const collapsedContainerIds = useMemo(() => {
    return new Set(
      nodes.filter((node) => isContainerNode(node) && !node.isExpanded).map((node) => node.id)
    );
  }, [nodes]);

  const visibleNodes = useMemo(() => {
    if (collapsedContainerIds.size === 0) return nodes;
    return nodes.filter(
      (node) => !node.containerId || !collapsedContainerIds.has(node.containerId)
    );
  }, [collapsedContainerIds, nodes]);

  const visibleNodeIds = useMemo(() => {
    return new Set(visibleNodes.map((node) => node.id));
  }, [visibleNodes]);

  const containerTypeById = useMemo(() => {
    return getContainerTypeById(nodes);
  }, [nodes]);

  const validEdges = useMemo(() => {
    return filterEdgesByContainerRules(nodes, edges);
  }, [edges, nodes]);

  const nodeTypesByCategory = useMemo(() => {
    return nodeTypes.reduce(
      (acc, kind) => {
        const config = nodeTypeConfig[kind];
        if (config) {
          acc[config.category].push(kind);
        }
        return acc;
      },
      {
        skill: [],
        flow_control: [],
        event: []
      } as Record<NodeCategory, NodeKind[]>
    );
  }, [nodeTypes, nodeTypeConfig]);

  const incomingEdges = useMemo(() => {
    const set = new Set<string>();
    validEdges.forEach((edge) => set.add(edge.to));
    return set;
  }, [validEdges]);

  const outgoingEdges = useMemo(() => {
    const map = new Map<string, EditorEdge>();
    validEdges.forEach((edge) => {
      map.set(`${edge.from}:${edge.fromPort}`, edge);
    });
    return map;
  }, [validEdges]);

  const getCanvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: (clientX - rect.left) / zoom,
        y: (clientY - rect.top) / zoom
      };
    },
    [zoom]
  );

  const getViewportCenter = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return {
        x: canvasBase.width / 2 - NODE_METRICS.width / 2,
        y: canvasBase.height / 2 - NODE_METRICS.collapsedHeight / 2
      };
    }
    return {
      x: (container.scrollLeft + container.clientWidth / 2) / zoom - NODE_METRICS.width / 2,
      y:
        (container.scrollTop + container.clientHeight / 2) / zoom -
        NODE_METRICS.collapsedHeight / 2
    };
  }, [canvasBase, zoom]);

  const resolveContainerAssignment = useCallback(
    (allNodes: EditorNode[], targetNode: EditorNode) => {
      if (isContainerNode(targetNode)) return null;
      const hasRibbon = Boolean(startEndBadges.get(targetNode.id)?.showStart || startEndBadges.get(targetNode.id)?.showEnd);
      const nodeHeight = getEffectiveNodeHeight(targetNode, nodeTypeConfig, hasRibbon);
      const center = {
        x: targetNode.position.x + NODE_METRICS.width / 2,
        y: targetNode.position.y + nodeHeight / 2
      };
      const containerNodes = allNodes.filter(
        (node) => isContainerNode(node) && node.isExpanded
      );
      for (const containerNode of containerNodes) {
        const layout = getContainerFrameLayout(containerNode, nodeTypeConfig);
        if (!layout) continue;
        for (const region of layout.regions) {
          const withinX =
            center.x >= region.bounds.x &&
            center.x <= region.bounds.x + region.bounds.width;
          const withinY =
            center.y >= region.bounds.y &&
            center.y <= region.bounds.y + region.bounds.height;
          if (!withinX || !withinY) continue;
          const containerType = getContainerType(containerNode.kind);
          if (!containerType) continue;
          return {
            containerId: containerNode.id,
            containerType,
            branchIndex: containerType === "parallel" ? region.index : null
          };
        }
      }
      return null;
    },
    [nodeTypeConfig, startEndBadges]
  );

  const finalizeNodeDrag = useCallback(
    (nodeId: string) => {
      setNodes((prev) => {
        const target = prev.find((node) => node.id === nodeId);
        if (!target || isContainerNode(target)) return prev;
        const assignment = resolveContainerAssignment(prev, target);
        const nextContainerId = assignment?.containerId ?? null;
        const nextContainerType = assignment?.containerType ?? null;
        const nextBranchIndex = assignment?.branchIndex ?? null;
        const changed =
          target.containerId !== nextContainerId ||
          target.containerType !== nextContainerType ||
          (target.branchIndex ?? null) !== (nextBranchIndex ?? null);
        if (!changed) return prev;
        const nextNodes = prev.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                containerId: nextContainerId,
                containerType: nextContainerType,
                branchIndex: nextBranchIndex
              }
            : node
        );
        setEdges((prevEdges) => filterEdgesByContainerRules(nextNodes, prevEdges));
        setHasUnsavedChanges(true);
        return nextNodes;
      });
    },
    [resolveContainerAssignment]
  );

  const handleContainerResizeStart = useCallback(
    (nodeId: string, handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) return;
      const target = nodeMap.get(nodeId);
      if (!target) return;
      const layout = getContainerFrameLayout(target, nodeTypeConfig);
      if (!layout) return;
      setResizeState({
        nodeId,
        handle,
        startPoint: point,
        startWidth: layout.frame.width,
        startHeight: layout.frame.height
      });
    },
    [getCanvasPoint, nodeMap, nodeTypeConfig]
  );

  useEffect(() => {
    if (!dragState) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) return;

      const nextX = point.x - dragState.offsetX;
      const nextY = point.y - dragState.offsetY;

      setNodes((prev) => {
        const target = prev.find((node) => node.id === dragState.nodeId);
        if (!target) return prev;
        const candidatePosition = { x: nextX, y: nextY };
        let requiredWidth = Math.max(
          canvasBase.width,
          candidatePosition.x + NODE_METRICS.width + CANVAS_PADDING.x
        );
        let requiredHeight = Math.max(
          canvasBase.height,
          candidatePosition.y + dragState.height + CANVAS_PADDING.y
        );
        if (isContainerNode(target)) {
          const layout = getContainerFrameLayout(
            { ...target, position: candidatePosition },
            nodeTypeConfig
          );
          if (layout) {
            requiredWidth = Math.max(
              requiredWidth,
              layout.frame.x + layout.frame.width + CANVAS_PADDING.x
            );
            requiredHeight = Math.max(
              requiredHeight,
              layout.frame.y + layout.frame.height + CANVAS_PADDING.y
            );
          }
        }

        if (requiredWidth > canvasBase.width || requiredHeight > canvasBase.height) {
          setCanvasBase((base) => ({
            width: Math.max(base.width, requiredWidth),
            height: Math.max(base.height, requiredHeight)
          }));
        }

        const { minX, minY, maxX, maxY } = getCanvasBounds(
          { width: requiredWidth, height: requiredHeight },
          dragState.height
        );
        const nextPosition = {
          x: clamp(candidatePosition.x, minX, maxX),
          y: clamp(candidatePosition.y, minY, maxY)
        };
        const delta = {
          x: nextPosition.x - target.position.x,
          y: nextPosition.y - target.position.y
        };
        if (delta.x === 0 && delta.y === 0) return prev;
        if (isContainerNode(target)) {
          return prev.map((node) => {
            if (node.id === target.id) {
              return { ...node, position: nextPosition };
            }
            if (node.containerId === target.id) {
              return {
                ...node,
                position: {
                  x: node.position.x + delta.x,
                  y: node.position.y + delta.y
                }
              };
            }
            return node;
          });
        }
        return prev.map((node) =>
          node.id === target.id ? { ...node, position: nextPosition } : node
        );
      });
    };

    const handlePointerUp = () => {
      setDragState(null);
      finalizeNodeDrag(dragState.nodeId);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [
    canvasBase.height,
    canvasBase.width,
    dragState,
    finalizeNodeDrag,
    getCanvasPoint,
    nodeTypeConfig
  ]);

  useEffect(() => {
    if (!resizeState) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) return;
      const deltaX = point.x - resizeState.startPoint.x;
      const deltaY = point.y - resizeState.startPoint.y;
      setNodes((prev) => {
        const target = prev.find((node) => node.id === resizeState.nodeId);
        if (!target) return prev;
        const layout = getContainerFrameLayout(target, nodeTypeConfig);
        if (!layout) return prev;
        const frameX = layout.frame.x;
        const frameY = layout.frame.y;
        let nextWidth = resizeState.startWidth;
        let nextHeight = resizeState.startHeight;
        if (resizeState.handle === "e" || resizeState.handle === "se") {
          nextWidth += deltaX;
        }
        if (resizeState.handle === "s" || resizeState.handle === "se") {
          nextHeight += deltaY;
        }
        nextWidth = Math.max(nextWidth, CONTAINER_FRAME_METRICS.minWidth);
        nextHeight = Math.max(nextHeight, CONTAINER_FRAME_METRICS.minHeight);
        const requiredWidth = frameX + nextWidth + CANVAS_PADDING.x;
        const requiredHeight = frameY + nextHeight + CANVAS_PADDING.y;
        if (requiredWidth > canvasBase.width || requiredHeight > canvasBase.height) {
          setCanvasBase((base) => ({
            width: Math.max(base.width, requiredWidth),
            height: Math.max(base.height, requiredHeight)
          }));
        }
        const containerType = getContainerType(target.kind);
        if (!containerType) return prev;
        const branchCount = getContainerBranchCount(target);
        const nextFrame: ContainerFrameData = {
          width: nextWidth,
          height: nextHeight,
          ...(containerType === "parallel" ? { branchCount } : {})
        };
        if (
          target.containerFrame?.width === nextWidth &&
          target.containerFrame?.height === nextHeight
        ) {
          return prev;
        }
        return prev.map((node) =>
          node.id === target.id ? { ...node, containerFrame: nextFrame } : node
        );
      });
    };

    const handlePointerUp = () => {
      setResizeState(null);
      setHasUnsavedChanges(true);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [canvasBase.height, canvasBase.width, getCanvasPoint, nodeTypeConfig, resizeState]);

  const buildDefaultParams = useCallback((kind: NodeKind) => {
    const config = nodeTypeConfig[kind];
    if (!config) return {};
    return config.paramFields.reduce(
      (acc, field) => ({
        ...acc,
        [field.key]: ""
      }),
      {} as Record<string, string>
    );
  }, [nodeTypeConfig]);

  const createConditionExpression = useCallback(
    (operator: ConditionOperator | null): ConditionExpression => ({
      id: `condition-${nextConditionIndex.current++}`,
      operator,
      variable: "",
      comparisonOperator: "==",
      value: ""
    }),
    []
  );

  const normalizeConditionExpressions = useCallback(
    (expressions: ConditionExpression[]) => {
      if (expressions.length === 0) {
        return [createConditionExpression(null)];
      }
      return expressions.map((expression, index) =>
        index === 0 ? { ...expression, operator: null } : expression
      );
    },
    [createConditionExpression]
  );

  const createNode = useCallback(
    (kind: NodeKind, position?: { x: number; y: number }) => {
      if (kind === "flow_control.input") {
        const existingInput = nodes.find(
          (node) => node.kind === "flow_control.input"
        );
        if (existingInput) {
          setSelectedNode(existingInput.id);
          setSelectedEdgeId(null);
          setEditingNodeId(null);
          return;
        }
      }

      const basePosition = position ?? getViewportCenter();
      const nodeHeight = NODE_METRICS.collapsedHeight;
      const { minX, minY, maxX, maxY } = getCanvasBounds(canvasBase, nodeHeight);
      const clampedPosition = {
        x: clamp(basePosition.x, minX, maxX),
        y: clamp(basePosition.y, minY, maxY)
      };

      const index = nextNodeIndex.current++;
      const id = `node-${index}`;
      const config = nodeTypeConfig[kind];
      const name = config ? `${config.label} ${index}` : `${kind} ${index}`;
      const params = buildDefaultParams(kind);
      if (kind === "flow_control.repeat" && !params.count) {
        params.count = "1";
      }
      const containerType = getContainerType(kind);
      const containerFrame =
        containerType !== null
          ? {
              ...getDefaultContainerFrameSize(containerType, DEFAULT_PARALLEL_BRANCHES),
              ...(containerType === "parallel"
                ? { branchCount: DEFAULT_PARALLEL_BRANCHES }
                : {})
            }
          : undefined;
      const baseNode: EditorNode = {
        id,
        name,
        kind,
        position: clampedPosition,
        isExpanded: false,
        params,
        conditionExpressions:
          kind === "flow_control.condition"
            ? [createConditionExpression(null)]
            : undefined,
        // input / output 노드는 초기 생성 시 파라미터 row 0개
        variableRows:
          kind === "flow_control.input" || kind === "flow_control.output"
            ? []
            : undefined,
        containerId: null,
        containerType: null,
        branchIndex: null,
        containerFrame
      };
      setNodes((prev) => {
        const assignment =
          containerType === null ? resolveContainerAssignment(prev, baseNode) : null;
        const nextNode = assignment
          ? { ...baseNode, ...assignment }
          : baseNode;
        return [...prev, nextNode];
      });
      setSelectedNode(id);
      setSelectedEdgeId(null);
    },
    [
      buildDefaultParams,
      canvasBase,
      createConditionExpression,
      getViewportCenter,
      nodeTypeConfig,
      nodes,
      resolveContainerAssignment
    ]
  );

  const handleSave = async () => {
    const view_json = buildViewJson(nodes, validEdges, canvasBase, zoom);
    const dsl_json = buildDslJson(nodes, validEdges);
    const updatedAt = new Date().toISOString();

    if (isNewWorkflow) {
      const name = workflowName.trim() || "Untitled Workflow";
      try {
        const created = await workflowsApi.create({ name });
        saveMutation.mutate({
          workflowId: created.workflowId,
          payload: {
            workflowId: created.workflowId,
            dsl_json,
            view_json,
            updatedAt
          }
        });
      } catch (error) {
        console.error("Failed to create workflow draft", error);
      }
      return;
    }

    saveMutation.mutate({
      workflowId,
      payload: {
        workflowId,
        dsl_json,
        view_json,
        updatedAt
      }
    });
    setHasUnsavedChanges(false);
  };

  const handleCancel = () => {
    setDraftOverride(draft ?? null);
    applyDraftToEditor(draft ?? null);
    setSelectedNode(null);
    setHasUnsavedChanges(false);
  };

  const handlePublish = () => {
    if (hasErrors) return;
    setShowPublishConfirm(true);
  };

  const handleConfirmPublish = () => {
    publishMutation.mutate();
  };

  const handleToggleExpand = (nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    const isContainer = target ? isContainerNode(target) : false;
    const willCollapse = Boolean(target && target.isExpanded && isContainer);
    const childIds = willCollapse
      ? new Set(nodes.filter((node) => node.containerId === nodeId).map((node) => node.id))
      : null;

    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        const nextExpanded = !node.isExpanded;
        const nextNode = { ...node, isExpanded: nextExpanded };
        const hasRibbon = Boolean(startEndBadges.get(node.id)?.showStart || startEndBadges.get(node.id)?.showEnd);
        const nodeHeight = getEffectiveNodeHeight(nextNode, nodeTypeConfig, hasRibbon);
        const { minX, minY, maxX, maxY } = getCanvasBounds(canvasBase, nodeHeight);
        const updated = {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
        setHasUnsavedChanges(true);
        return updated;
      })
    );

    if (willCollapse && childIds) {
      if (selectedNode && childIds.has(selectedNode)) {
        setSelectedNode(null);
      }
      if (editingNodeId && childIds.has(editingNodeId)) {
        setEditingNodeId(null);
      }
      if (connectingFrom && childIds.has(connectingFrom.nodeId)) {
        setConnectingFrom(null);
      }
      if (
        selectedEdgeId &&
        edges.some(
          (edge) =>
            edge.id === selectedEdgeId &&
            (childIds.has(edge.from) || childIds.has(edge.to))
        )
      ) {
        setSelectedEdgeId(null);
      }
    }
  };

  const handleParamChange = (nodeId: string, key: string, value: string) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? (() => {
              setHasUnsavedChanges(true);
              return { ...node, params: { ...node.params, [key]: value } };
            })()
          : node
      )
    );
  };

  const handleConditionExpressionFieldChange = (
    nodeId: string,
    expressionId: string,
    field: "variable" | "comparisonOperator" | "value",
    value: string
  ) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
        const expressions = node.conditionExpressions ?? [
          createConditionExpression(null)
        ];
        const nextExpressions = expressions.map((expression) =>
          expression.id === expressionId
            ? { ...expression, [field]: value }
            : expression
        );
        setHasUnsavedChanges(true);
        return { ...node, conditionExpressions: nextExpressions };
      })
    );
  };

  const handleAddConditionExpression = (
    nodeId: string,
    operator: ConditionOperator
  ) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
        const baseExpressions = normalizeConditionExpressions(
          node.conditionExpressions ?? []
        );
        const nextExpressions = normalizeConditionExpressions([
          ...baseExpressions,
          createConditionExpression(operator)
        ]);
        const nextNode = { ...node, conditionExpressions: nextExpressions };
        const hasRibbon = Boolean(startEndBadges.get(node.id)?.showStart || startEndBadges.get(node.id)?.showEnd);
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getEffectiveNodeHeight(nextNode, nodeTypeConfig, hasRibbon)
        );
        const updated = {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
        setHasUnsavedChanges(true);
        return updated;
      })
    );
  };

  const handleRemoveConditionExpression = (nodeId: string, expressionId: string) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
        const remaining = (node.conditionExpressions ?? []).filter(
          (expression) => expression.id !== expressionId
        );
        const nextExpressions = normalizeConditionExpressions(remaining);
        const nextNode = { ...node, conditionExpressions: nextExpressions };
        const hasRibbon = Boolean(startEndBadges.get(node.id)?.showStart || startEndBadges.get(node.id)?.showEnd);
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getEffectiveNodeHeight(nextNode, nodeTypeConfig, hasRibbon)
        );
        const updated = {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
        setHasUnsavedChanges(true);
        return updated;
      })
    );
  };

  const handleVariableRowChange = (
    nodeId: string,
    rowId: string,
    field: "name" | "value",
    value: string
  ) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (
          node.id !== nodeId ||
          (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
        )
          return node;
        const rows = node.variableRows ?? [];
        const nextRows = rows.map((row) =>
          row.id === rowId ? { ...row, [field]: value } : row
        );
        setHasUnsavedChanges(true);
        return { ...node, variableRows: nextRows };
      })
    );
  };

  const handleAddVariableRow = (nodeId: string, valueType: VariableValueType) => {
    setNodes((prev) =>
      prev.map((node) => {
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
        const hasRibbon = Boolean(startEndBadges.get(node.id)?.showStart || startEndBadges.get(node.id)?.showEnd);
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getEffectiveNodeHeight(nextNode, nodeTypeConfig, hasRibbon)
        );
        const updated = {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
        setHasUnsavedChanges(true);
        return updated;
      })
    );
  };

  const handleRemoveVariableRow = (nodeId: string, rowId: string) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (
          node.id !== nodeId ||
          (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
        )
          return node;
        const rows = node.variableRows ?? [];
        const nextRows = rows.filter((row) => row.id !== rowId);
        const nextNode = { ...node, variableRows: nextRows };
        const hasRibbon = Boolean(startEndBadges.get(node.id)?.showStart || startEndBadges.get(node.id)?.showEnd);
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getEffectiveNodeHeight(nextNode, nodeTypeConfig, hasRibbon)
        );
        const updated = {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
        setHasUnsavedChanges(true);
        return updated;
      })
    );
  };

  const handleNameChange = (nodeId: string, value: string) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? (() => {
              setHasUnsavedChanges(true);
              return { ...node, name: value };
            })()
          : node
      )
    );
  };

  const handleStartEditName = (nodeId: string) => {
    setEditingNodeId(nodeId);
    setSelectedNode(nodeId);
    setSelectedEdgeId(null);
  };

  const handleFinishEditName = () => {
    setEditingNodeId(null);
  };

  const handleDeleteNode = (nodeId: string) => {
    const connectedEdgeIds = edges
      .filter((edge) => edge.from === nodeId || edge.to === nodeId)
      .map((edge) => edge.id);
    setNodes((prev) => {
      const isContainer = prev.some(
        (node) => node.id === nodeId && isContainerNode(node)
      );
      const nextNodes = prev
        .filter((node) => node.id !== nodeId)
        .map((node) => {
          if (!isContainer) return node;
          if (node.containerId !== nodeId) return node;
          return {
            ...node,
            containerId: null,
            containerType: null,
            branchIndex: null
          };
        });
      setEdges((prevEdges) => {
        const trimmed = prevEdges.filter(
          (edge) => edge.from !== nodeId && edge.to !== nodeId
        );
        return filterEdgesByContainerRules(nextNodes, trimmed);
      });
      return nextNodes;
    });
    setSelectedNode((prev) => (prev === nodeId ? null : prev));
    setSelectedEdgeId((prev) =>
      prev && connectedEdgeIds.includes(prev) ? null : prev
    );
    setConnectingFrom((prev) =>
      prev && prev.nodeId === nodeId ? null : prev
    );
    setEditingNodeId((prev) => (prev === nodeId ? null : prev));
    setHasUnsavedChanges(true);
  };

  const handleDeleteEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((prev) => (prev === edgeId ? null : prev));
    setHasUnsavedChanges(true);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (selectedNode) {
        event.preventDefault();
        handleDeleteNode(selectedNode);
        return;
      }
      if (selectedEdgeId) {
        event.preventDefault();
        handleDeleteEdge(selectedEdgeId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDeleteEdge, handleDeleteNode, selectedEdgeId, selectedNode]);

  const handleAutoLayout = () => {
    if (nodes.length === 0) return;

    // DSL import 시 사용하던 레이아웃 로직을 그대로 재사용:
    // - 최상위 노드는 레이어 기반 좌→우 DAG
    // - Repeat 컨테이너 안은 세로 / Parallel 브랜치 안은 가로 배치
    const nextNodes = applyImportedLayout(nodes, validEdges, nodeTypeConfig);

    setNodes((prev) => {
      // 포지션이 실제로 변경된 경우에만 unsaved 플래그 설정
      const changed =
        prev.length !== nextNodes.length ||
        prev.some((node, index) => {
          const next = nextNodes[index];
          return (
            node.id !== next.id ||
            node.position.x !== next.position.x ||
            node.position.y !== next.position.y
          );
        });

      if (changed) {
        setHasUnsavedChanges(true);
      }
      return nextNodes;
    });
  };

  const showEdgeError = useCallback((message: string) => {
    setEdgeError(message);
    if (edgeErrorTimerRef.current) {
      window.clearTimeout(edgeErrorTimerRef.current);
    }
    edgeErrorTimerRef.current = window.setTimeout(() => {
      setEdgeError(null);
      edgeErrorTimerRef.current = null;
    }, 2400);
  }, []);

  const isEdgeAllowed = useCallback(
    (fromNode: EditorNode, toNode: EditorNode) => {
      const fromKey = getNodeContainerKey(fromNode, containerTypeById);
      const toKey = getNodeContainerKey(toNode, containerTypeById);
      if (!fromKey && !toKey) return true;
      return fromKey !== null && fromKey === toKey;
    },
    [containerTypeById]
  );

  const connectNodes = useCallback(
    (fromNodeId: string, fromPort: string, toNodeId: string) => {
      if (fromNodeId === toNodeId) return;
      const fromNode = nodeMap.get(fromNodeId);
      const toNode = nodeMap.get(toNodeId);
      if (!fromNode || !toNode) return;
      const toConfig = nodeTypeConfig[toNode.kind];
      if (toConfig?.inputEnabled === false) return;
      if (outgoingEdges.has(`${fromNodeId}:${fromPort}`)) return;
      if (!isEdgeAllowed(fromNode, toNode)) {
        showEdgeError("Edges cannot cross container boundaries.");
        return;
      }

      setEdges((prev) => [
        ...prev,
        {
          id: `edge-${nextEdgeIndex.current++}`,
          from: fromNodeId,
          fromPort,
          to: toNodeId
        }
      ]);
      setSelectedEdgeId(null);
      setHasUnsavedChanges(true);
    },
    [isEdgeAllowed, nodeMap, nodeTypeConfig, outgoingEdges, showEdgeError]
  );

  const handleStartConnect = (nodeId: string, portKey: string) => {
    if (outgoingEdges.has(`${nodeId}:${portKey}`)) {
      setConnectingFrom(null);
      return;
    }
    setEditingNodeId(null);
    setConnectingFrom((prev) => {
      if (prev && prev.nodeId === nodeId && prev.portKey === portKey) {
        return null;
      }
      return { nodeId, portKey };
    });
    setSelectedEdgeId(null);
  };

  const handleCompleteConnect = (nodeId: string) => {
    if (!connectingFrom || connectingFrom.nodeId === nodeId) {
      setConnectingFrom(null);
      return;
    }
    connectNodes(connectingFrom.nodeId, connectingFrom.portKey, nodeId);
    setConnectingFrom(null);
  };

  const handleOutputDragStart = (
    event: DragEvent<HTMLButtonElement>,
    nodeId: string,
    portKey: string
  ) => {
    event.dataTransfer.setData(
      "application/x-edge-from",
      JSON.stringify({ nodeId, portKey } as EdgeDragPayload)
    );
    event.dataTransfer.effectAllowed = "link";
    setConnectingFrom({ nodeId, portKey });
    setSelectedEdgeId(null);
    setEditingNodeId(null);
  };

  const handleOutputDragEnd = () => {
    setConnectingFrom(null);
  };

  const handleInputDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "link";
  };

  const handleInputDrop = (event: DragEvent<HTMLButtonElement>, nodeId: string) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/x-edge-from");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as EdgeDragPayload;
      if (!payload.nodeId || !payload.portKey) return;
      connectNodes(payload.nodeId, payload.portKey, nodeId);
    } catch {
      return;
    }
    setConnectingFrom(null);
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rawKind = event.dataTransfer.getData("application/x-node-kind");
    if (!rawKind) return;
    if (!nodeTypes.includes(rawKind as NodeKind)) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) return;

    const dropX = point.x - NODE_METRICS.width / 2;
    const dropY = point.y - NODE_METRICS.collapsedHeight / 2;
    createNode(rawKind as NodeKind, { x: dropX, y: dropY });
    setHasUnsavedChanges(true);
  };

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-node-card]")) return;
    setSelectedNode(null);
    setSelectedEdgeId(null);
    setConnectingFrom(null);
    setEditingNodeId(null);
  };

  const edgesToRender = useMemo(() => {
    return validEdges.filter((edge) => {
      if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) {
        return false;
      }
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);
      if (!fromNode || !toNode) return false;
      const config = nodeTypeConfig[fromNode.kind];
      if (!config) return false;
      const outputs = config.outputs;
      return outputs.some((output) => output.key === edge.fromPort);
    });
  }, [nodeMap, nodeTypeConfig, validEdges, visibleNodeIds]);

  const containerFramesToRender = useMemo(() => {
    return nodes
      .filter((node) => isContainerNode(node) && node.isExpanded)
      .map((node) => {
        const layout = getContainerFrameLayout(node, nodeTypeConfig);
        if (!layout) return null;
        const empty = containerEmptyBranches.get(node.id);
        const regions = layout.regions.map((region) => ({
          ...region,
          isEmpty: empty ? empty.has(region.index) : false
        }));
        return {
          node,
          label: getContainerHeaderLabel(node, regions.length),
          frame: layout.frame,
          headerHeight: layout.headerHeight,
          regions,
          highlight: Boolean(empty && empty.size > 0)
        };
      })
      .filter(Boolean) as Array<{
      node: EditorNode;
      label: string;
      frame: { x: number; y: number; width: number; height: number };
      headerHeight: number;
      regions: ContainerFrameRegion[];
      highlight: boolean;
    }>;
  }, [containerEmptyBranches, nodeTypeConfig, nodes]);

  const connectingLabel = useMemo(() => {
    if (!connectingFrom) return null;
    const node = nodeMap.get(connectingFrom.nodeId);
    if (!node) return null;
    const config = nodeTypeConfig[node.kind];
    if (!config) return `${node.name} - ${connectingFrom.portKey}`;
    const output = config.outputs.find(
      (item) => item.key === connectingFrom.portKey
    );
    return `${node.name} - ${output?.label ?? connectingFrom.portKey}`;
  }, [connectingFrom, nodeMap, nodeTypeConfig]);

  // 에디터 페이지에서 unsaved 변경 여부를 전역(window)에 노출
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __editorHasUnsavedChanges?: boolean }).__editorHasUnsavedChanges =
      hasUnsavedChanges;
    return () => {
      if (typeof window === "undefined") return;
      (window as unknown as { __editorHasUnsavedChanges?: boolean }).__editorHasUnsavedChanges =
        false;
    };
  }, [hasUnsavedChanges]);

  // 새로고침/탭 닫기 등 브라우저 단위 이동 시 경고
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!publishToast) return;
    const id = window.setTimeout(() => setPublishToast(false), 3000);
    return () => window.clearTimeout(id);
  }, [publishToast]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-6">
      {showPublishConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-dialog-title"
          onClick={() => setShowPublishConfirm(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <Card className="w-full max-w-sm p-4 shadow-xl">
            <h2 id="publish-dialog-title" className="text-lg font-semibold text-slate-800">
              Publish workflow?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This will create an immutable published version. You can continue editing the draft afterward.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setShowPublishConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmPublish}
                disabled={publishMutation.isPending}
              >
                {publishMutation.isPending ? "Publishing…" : "Publish"}
              </Button>
            </div>
          </Card>
          </div>
        </div>
      )}

      {publishToast && (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg"
          role="status"
        >
          Workflow published successfully.
        </div>
      )}

      <div className="flex shrink-0 items-start justify-between">
        <div>
          <p className="text-xs text-slate-500">Workflow Editor</p>
          <div className="flex items-center gap-2">
            {isNewWorkflow && isEditingWorkflowName ? (
              <input
                value={workflowName}
                onChange={(event) => setWorkflowName(event.target.value)}
                onBlur={() => {
                  setIsEditingWorkflowName(false);
                  // TODO: API 호출로 workflow 이름 업데이트
                  if (workflows) {
                    const currentWorkflow = workflows.find(
                      (w) => w.workflowId === workflowId
                    );
                    if (currentWorkflow && workflowName.trim() && workflowName !== currentWorkflow.name) {
                      // 이름이 변경되었고 유효하면 업데이트
                      queryClient.setQueryData<typeof workflows>(
                        ["workflows"],
                        (old) =>
                          old?.map((w) =>
                            w.workflowId === workflowId
                              ? { ...w, name: workflowName.trim() }
                              : w
                          )
                      );
                      setOriginalWorkflowName(workflowName.trim());
                    } else if (!workflowName.trim()) {
                      // 빈 이름이면 원래 값으로 복원
                      setWorkflowName(originalWorkflowName);
                    }
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    setWorkflowName(originalWorkflowName);
                    setIsEditingWorkflowName(false);
                  }
                }}
                autoFocus
                className="text-xl font-semibold rounded border border-slate-300 bg-white px-2 py-1 focus:border-slate-500 focus:outline-none min-w-[200px]"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="flex items-center gap-2 group">
                <h1
                  className="text-xl font-semibold cursor-pointer hover:text-slate-700 select-none"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!isNewWorkflow) return;
                    setIsEditingWorkflowName(true);
                  }}
                  title={isNewWorkflow ? "더블클릭하여 이름 변경" : "기존 워크플로우의 이름 변경은 추후 지원 예정입니다."}
                >
                  {isLoadingWorkflows ? "Loading..." : (workflowName || activeDraft?.workflowId || "Untitled Workflow")}
                </h1>
                {isNewWorkflow && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isNewWorkflow) return;
                      setIsEditingWorkflowName(true);
                    }}
                    className="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
                    title="이름 변경"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-4 h-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                      />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <StatusBadge status="DRAFT" />
            {workflows && (() => {
              const current = workflows.find((w) => w.workflowId === workflowId);
              const ver = current?.latestVersion?.versionNumber;
              return ver ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  Latest: v{ver}
                </span>
              ) : null;
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleAutoLayout}>
            Auto Layout
          </Button>
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleSave}>
            Save
          </Button>
          <Button onClick={handlePublish} disabled={hasErrors}>
            Publish
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => setShowPalette((prev) => !prev)}
          className="cursor-pointer absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg"
        >
          +
        </button>
        {showPalette && (
          <div className="absolute left-16 top-4 z-10 flex rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="w-32 border-r border-slate-200 p-3">
              <p className="text-[10px] font-semibold text-slate-500">Category</p>
              <div className="mt-2 space-y-1">
                {NODE_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategory(category.id)}
                    className={cn(
                      "cursor-pointer w-full rounded-md px-2 py-1 text-left text-xs",
                      selectedCategory === category.id
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    )}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-72 p-3">
              <p className="text-xs font-semibold text-slate-700">
                {NODE_CATEGORY_LABELS[selectedCategory]}
              </p>
              <div className="mt-3 space-y-2">
                {nodeTypesByCategory[selectedCategory].map((kind) => {
                  const config = nodeTypeConfig[kind];
                  return (
                    <button
                      key={kind}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-node-kind", kind);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => createNode(kind)}
                      className="cursor-pointer flex w-full items-center gap-3 rounded-md border border-slate-200 px-2 py-2 text-left text-xs text-slate-700 hover:border-slate-300"
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold",
                          config.colorClass
                        )}
                      >
                        {config.iconText}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-semibold">{config.label}</p>
                        <p className="text-[10px] text-slate-500">{kind}</p>
                      </div>
                      <span className="text-[10px] text-slate-400">Drag</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[10px] text-slate-400">
                Drag onto the canvas or click to add at center.
              </p>
            </div>
          </div>
        )}

        <Card className="flex min-h-0 min-w-0 flex-1 flex-col border-dashed">
          <div
            ref={containerRef}
            className="relative min-h-[560px] w-full min-w-0 flex-1 overflow-hidden rounded-md bg-slate-50"
          >
            <div
              ref={scrollRef}
              className="h-full w-full min-w-0 min-h-0 overflow-x-auto overflow-y-auto"
            >
              <div
                className="relative min-w-full min-h-full"
                style={{
                  width: canvasBase.width * zoom,
                  height: canvasBase.height * zoom
                }}
              >
                <div
                  ref={canvasRef}
                  className="absolute inset-0"
                  style={{
                    width: canvasBase.width,
                    height: canvasBase.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left"
                  }}
                  onDragOver={handleCanvasDragOver}
                  onDrop={handleCanvasDrop}
                  onClick={handleCanvasClick}
                >
                  {containerFramesToRender.map((frame) => (
                    <ContainerFrame
                      key={frame.node.id}
                      id={frame.node.id}
                      label={frame.label}
                      position={{ x: frame.frame.x, y: frame.frame.y }}
                      size={{ width: frame.frame.width, height: frame.frame.height }}
                      headerHeight={frame.headerHeight}
                      regions={frame.regions}
                      highlight={frame.highlight}
                      onResizeStart={(handle, event) =>
                        handleContainerResizeStart(frame.node.id, handle, event)
                      }
                    />
                  ))}

                  {visibleNodes.map((node) => {
                    const config = nodeTypeConfig[node.kind];
                    if (!config) return null;
                    const outputStates = config.outputs.map((output) => ({
                      key: output.key,
                      label: output.label,
                      isConnected: outgoingEdges.has(`${node.id}:${output.key}`),
                      isActive:
                        connectingFrom?.nodeId === node.id &&
                        connectingFrom.portKey === output.key
                    }));
                    const skillset = node.kind.startsWith("skill.")
                      ? skillsetMap.get(node.kind)
                      : undefined;
                    return (
                      <div
                        key={node.id}
                        className="absolute"
                        style={{ left: node.position.x, top: node.position.y }}
                      >
                        <NodeCard
                          node={node}
                          config={config}
                          isSelected={selectedNode === node.id}
                          inputConnected={incomingEdges.has(node.id)}
                          outputs={outputStates}
                          nodeTypeConfig={nodeTypeConfig}
                          skillset={skillset}
                          nodes={nodes}
                          edges={edges}
                          stateNameMap={stateNameMap}
                          skillsetMap={skillsetMap}
                          warningLabel={containerWarningLabels.get(node.id) ?? null}
                          startEndBadge={startEndBadges.get(node.id) ?? null}
                          effectiveHeight={effectiveNodeHeightMap.get(node.id)}
                          onSelect={() => {
                            setSelectedNode(node.id);
                            setSelectedEdgeId(null);
                            setEditingNodeId((prev) => (prev === node.id ? prev : null));
                          }}
                          onToggleExpand={() => handleToggleExpand(node.id)}
                          onDragStart={(event) => {
                            const point = getCanvasPoint(
                              event.clientX,
                              event.clientY
                            );
                            if (!point) return;
                            const offsetX = point.x - node.position.x;
                            const offsetY = point.y - node.position.y;
                            setSelectedNode(node.id);
                            setSelectedEdgeId(null);
                            setEditingNodeId(null);
                            setConnectingFrom(null);
                            setDragState({
                              nodeId: node.id,
                              offsetX,
                              offsetY,
                              height: effectiveNodeHeightMap.get(node.id) ?? getNodeHeight(node, nodeTypeConfig)
                            });
                          }}
                          onStartConnect={(portKey) =>
                            handleStartConnect(node.id, portKey)
                          }
                          onCompleteConnect={() => handleCompleteConnect(node.id)}
                          onParamChange={(key, value) =>
                            handleParamChange(node.id, key, value)
                          }
                          onConditionExpressionFieldChange={(
                            expressionId,
                            field,
                            value
                          ) =>
                            handleConditionExpressionFieldChange(
                              node.id,
                              expressionId,
                              field,
                              value
                            )
                          }
                          onAddConditionExpression={(operator) =>
                            handleAddConditionExpression(node.id, operator)
                          }
                          onRemoveConditionExpression={(expressionId) =>
                            handleRemoveConditionExpression(node.id, expressionId)
                          }
                          onVariableRowChange={(rowId, field, value) =>
                            handleVariableRowChange(node.id, rowId, field, value)
                          }
                          onAddVariableRow={(valueType) =>
                            handleAddVariableRow(node.id, valueType)
                          }
                          onRemoveVariableRow={(rowId) =>
                            handleRemoveVariableRow(node.id, rowId)
                          }
                          onNameChange={(value) => handleNameChange(node.id, value)}
                          isEditingName={editingNodeId === node.id}
                          onStartEditName={() => handleStartEditName(node.id)}
                          onFinishEditName={handleFinishEditName}
                          onOutputDragStart={(event, portKey) =>
                            handleOutputDragStart(event, node.id, portKey)
                          }
                          onOutputDragEnd={handleOutputDragEnd}
                          onInputDragOver={handleInputDragOver}
                          onInputDrop={(event) => handleInputDrop(event, node.id)}
                        />
                      </div>
                    );
                  })}

                  <svg
                    className="absolute inset-0 z-10 pointer-events-none"
                    width={canvasBase.width}
                    height={canvasBase.height}
                    viewBox={`0 0 ${canvasBase.width} ${canvasBase.height}`}
                    preserveAspectRatio="xMinYMin meet"
                  >
                    <defs>
                      <marker
                        id="arrow"
                        markerWidth="10"
                        markerHeight="10"
                        refX="8"
                        refY="5"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
                      </marker>
                      <marker
                        id="arrow-true"
                        markerWidth="10"
                        markerHeight="10"
                        refX="8"
                        refY="5"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                      </marker>
                      <marker
                        id="arrow-false"
                        markerWidth="10"
                        markerHeight="10"
                        refX="8"
                        refY="5"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                      </marker>
                    </defs>
                    {edgesToRender.map((edge) => {
                      const fromNode = nodeMap.get(edge.from);
                      const toNode = nodeMap.get(edge.to);
                      if (!fromNode || !toNode) return null;
                      const fromConfig = nodeTypeConfig[fromNode.kind];
                      if (!fromConfig) return null;
                      const outputs = fromConfig.outputs;
                      const outputIndex = outputs.findIndex(
                        (output) => output.key === edge.fromPort
                      );
                      if (outputIndex < 0) return null;
                      const toNodeHeight = effectiveNodeHeightMap.get(toNode.id) ?? getNodeHeight(toNode, nodeTypeConfig);
                      const fromNodeHeight = effectiveNodeHeightMap.get(fromNode.id) ?? getNodeHeight(fromNode, nodeTypeConfig);
                      const outputOffsets = getPortOffsets(fromNodeHeight, outputs.length);
                      const start = {
                        x: fromNode.position.x + NODE_METRICS.width,
                        y: fromNode.position.y + outputOffsets[outputIndex]
                      };
                      const end = {
                        x: toNode.position.x - 12,
                        y: toNode.position.y + toNodeHeight / 2
                      };
                      const curve = Math.max(60, Math.abs(end.x - start.x) / 2);
                      const controlX1 =
                        start.x + (end.x >= start.x ? curve : -curve);
                      const controlX2 =
                        end.x + (end.x >= start.x ? -curve : curve);
                      const path = `M ${start.x} ${start.y} C ${controlX1} ${start.y}, ${controlX2} ${end.y}, ${end.x} ${end.y}`;
                      const isConditionNode = fromNode.kind === "flow_control.condition";
                      const isTrueEdge = edge.fromPort === "true";
                      const isFalseEdge = edge.fromPort === "false";
                      let strokeColor = selectedEdgeId === edge.id ? "#0f172a" : "#94a3b8";
                      let markerId = "arrow";

                      if (isConditionNode && isTrueEdge) {
                        strokeColor = selectedEdgeId === edge.id ? "#059669" : "#10b981";
                        markerId = "arrow-true";
                      } else if (isConditionNode && isFalseEdge) {
                        strokeColor = selectedEdgeId === edge.id ? "#dc2626" : "#ef4444";
                        markerId = "arrow-false";
                      }

                      return (
                        <path
                          key={edge.id}
                          d={path}
                          stroke={strokeColor}
                          strokeWidth={selectedEdgeId === edge.id ? "2.5" : "2"}
                          fill="none"
                          markerEnd={`url(#${markerId})`}
                          className="cursor-pointer"
                          style={{ pointerEvents: "stroke" }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedEdgeId(edge.id);
                            setSelectedNode(null);
                            setEditingNodeId(null);
                          }}
                        />
                      );
                    })}
                  </svg>

                  {nodes.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-sm text-slate-400">
                      <p>Drag a node here or click in the palette.</p>
                      <p className="text-xs">
                        Use output ports to connect nodes with arrows.
                      </p>
                    </div>
                  )}

                  {edgeError && (
                    <div className="absolute bottom-12 left-4 rounded-full bg-rose-600 px-3 py-1 text-[10px] font-semibold text-white shadow">
                      {edgeError}
                    </div>
                  )}
                  {connectingFrom && (
                    <div className="absolute bottom-4 left-4 rounded-full bg-slate-900 px-3 py-1 text-[10px] text-white shadow">
                      Connecting: {connectingLabel ?? "Output"} -&gt; select target input.
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] text-slate-600 shadow">
              <button
                type="button"
                className="cursor-pointer rounded px-1 text-slate-600 hover:text-slate-900"
                onClick={() =>
                  setZoom((prev) =>
                    clamp(prev - ZOOM_LIMITS.step, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
                  )
                }
              >
                -
              </button>
              <span className="min-w-[36px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="cursor-pointer rounded px-1 text-slate-600 hover:text-slate-900"
                onClick={() =>
                  setZoom((prev) =>
                    clamp(prev + ZOOM_LIMITS.step, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
                  )
                }
              >
                +
              </button>
              <button
                type="button"
                className="cursor-pointer rounded px-1 text-slate-500 hover:text-slate-900"
                onClick={() => setZoom(1)}
              >
                Reset
              </button>
            </div>
          </div>
        </Card>
      </div>

      {hasErrors && (
        <div className="fixed bottom-6 right-6 z-20">
          <button
            type="button"
            className="cursor-pointer flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
            onClick={() => setShowValidation((prev) => !prev)}
          >
            {allValidationErrors.length} Validation Errors
          </button>
          {showValidation && (
            <div className="mt-3 w-72 rounded-lg border border-red-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
              <p className="font-semibold text-red-600">Errors</p>
              <ul className="mt-2 space-y-2">
                {allValidationErrors.map((error: ValidationError, index) => (
                  <li key={`${error.id}-${index}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedNode(error.nodeId ?? null)}
                      className="cursor-pointer text-left text-slate-700 hover:text-slate-900"
                    >
                      {error.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
