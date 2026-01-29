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
import { StatusBadge } from "@/components/StatusBadge";
import { WorkflowDraft } from "@/domain/types";
import { Breadcrumbs } from "@/features/editor/Breadcrumbs";
import {
  buildGraphRef,
  createBranchContext,
  createParallelContext,
  createRepeatContext,
  createRootContext,
  getAllowedNodeKinds,
  getEditorScope,
  getFocusModeLabel,
  navigateToContextIndex,
  popContext,
  pushParallelBranchContext,
  pushRepeatContext
} from "@/features/editor/editorContext";
import type { EditorContext, GraphPathSegment } from "@/features/editor/editorContext";
import type {
  ConditionExpression,
  ConditionOperator,
  EditorEdge,
  EditorGraph,
  EditorNode,
  NodeCategory,
  NodeKind,
  NodeOutputPort,
  NodeParamField,
  NodeTypeConfig,
  VariableRow,
  VariableValueType
} from "@/features/editor/editorTypes";
import { FocusModeEditor } from "@/features/editor/FocusModeEditor";
import { SubflowBanner } from "@/features/editor/SubflowBanner";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

type EditorPageProps = {
  workflowId: string;
};

type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
  height: number;
};

type ConnectingState = {
  nodeId: string;
  portKey: string;
} | null;

type EdgeDragPayload = {
  nodeId: string;
  portKey: string;
};

type NodeLocation = {
  nodeId: string;
  stateName: string;
  nodeName: string;
  contextStack: EditorContext[];
  ancestorBlockIds: string[];
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
  "flow_control.parallel": {
    label: "Parallel",
    category: "flow_control",
    iconText: "PA",
    colorClass: "border-cyan-200 bg-cyan-100 text-cyan-700",
    paramFields: [],
    outputs: [{ key: "next", label: "Next" }],
    block: {
      type: "parallel",
      editLabel: "Edit branches"
    }
  },
  "flow_control.repeat": {
    label: "Repeat",
    category: "flow_control",
    iconText: "RP",
    colorClass: "border-cyan-200 bg-cyan-100 text-cyan-700",
    paramFields: [{ key: "count", label: "Count", placeholder: "3" }],
    outputs: [{ key: "next", label: "Next" }],
    block: {
      type: "repeat",
      editLabel: "Edit body"
    }
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

function createEmptyGraph(
  canvasBase: { width: number; height: number } = CANVAS_DEFAULT,
  zoom = 1
): EditorGraph {
  return {
    version: "v1",
    nodes: [],
    edges: [],
    canvas: {
      width: canvasBase.width,
      height: canvasBase.height,
      zoom
    }
  };
}

function isParallelNode(node: EditorNode) {
  return node.kind === "flow_control.parallel";
}

function isRepeatNode(node: EditorNode) {
  return node.kind === "flow_control.repeat";
}

function normalizeGraph(graph: EditorGraph): EditorGraph {
  const normalizedCanvas = graph.canvas ?? {
    width: CANVAS_DEFAULT.width,
    height: CANVAS_DEFAULT.height,
    zoom: 1
  };
  const nodes = graph.nodes.map((node) => {
    if (isRepeatNode(node)) {
      const body = node.body ? normalizeGraph(node.body) : createEmptyGraph();
      return { ...node, body };
    }
    if (isParallelNode(node)) {
      const branches = (node.branches ?? []).map((branch) => normalizeGraph(branch));
      while (branches.length < 2) {
        branches.push(createEmptyGraph());
      }
      return { ...node, branches };
    }
    return node;
  });
  return {
    ...graph,
    canvas: normalizedCanvas,
    nodes
  };
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
  return (
    NODE_METRICS.expandedTopPadding +
    fieldCount * NODE_METRICS.fieldHeight +
    Math.max(0, fieldCount - 1) * NODE_METRICS.fieldGap
  );
}

function getNodeHeight(
  node: EditorNode,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  if (!node.isExpanded) return NODE_METRICS.collapsedHeight;
  return NODE_METRICS.collapsedHeight + getExpandedContentHeight(node, nodeTypeConfig);
}

function getNodeTypeLabel(
  kind: NodeKind,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
) {
  const config = nodeTypeConfig[kind];
  if (!config) return kind;
  return `${NODE_CATEGORY_LABELS[config.category]} - ${config.label}`;
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

function isValidConditionExpression(value: unknown): value is ConditionExpression {
  if (!isRecord(value)) return false;
  const operator = value.operator;
  return (
    typeof value.id === "string" &&
    (operator === null || operator === "AND" || operator === "OR") &&
    typeof value.expression === "string"
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
  return true;
}

function hydrateEditorNode(node: EditorNode, nodeTypes: NodeKind[]) {
  if (node.kind === "flow_control.repeat") {
    const rawBody = (node as EditorNode & { body?: Record<string, unknown> }).body;
    const parsedBody = rawBody && isRecord(rawBody)
      ? parseEditorGraph(rawBody, nodeTypes)
      : null;
    return {
      ...node,
      body: parsedBody ?? createEmptyGraph()
    };
  }
  if (node.kind === "flow_control.parallel") {
    const rawBranches = (node as EditorNode & { branches?: unknown }).branches;
    const branches = Array.isArray(rawBranches)
      ? rawBranches.map((branch) => {
          if (!isRecord(branch)) {
            return createEmptyGraph();
          }
          return parseEditorGraph(branch, nodeTypes) ?? createEmptyGraph();
        })
      : [];
    while (branches.length < 2) {
      branches.push(createEmptyGraph());
    }
    return {
      ...node,
      branches
    };
  }
  return node;
}

function parseEditorGraph(
  viewJson: Record<string, unknown>,
  nodeTypes: NodeKind[]
): EditorGraph | null {
  const rawNodes = viewJson.nodes;
  const rawEdges = viewJson.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;
  if (!rawNodes.every((node) => isValidEditorNode(node, nodeTypes)) || !rawEdges.every(isValidEditorEdge)) {
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
  const hydratedNodes = (rawNodes as EditorNode[]).map((node) =>
    hydrateEditorNode(node, nodeTypes)
  );
  return normalizeGraph({
    version: "v1",
    nodes: hydratedNodes,
    edges: rawEdges as EditorEdge[],
    canvas
  });
}

function getGraphAtPath(root: EditorGraph, path: GraphPathSegment[]) {
  let current = root;
  for (const segment of path) {
    const node = current.nodes.find((item) => item.id === segment.nodeId);
    if (!node) return createEmptyGraph();
    if (segment.kind === "repeatBody") {
      current = node.body ?? createEmptyGraph();
    } else {
      const branches = node.branches ?? [];
      current = branches[segment.branchIndex] ?? createEmptyGraph();
    }
  }
  return current;
}

function updateGraphAtPath(
  root: EditorGraph,
  path: GraphPathSegment[],
  updater: (graph: EditorGraph) => EditorGraph
): EditorGraph {
  if (path.length === 0) {
    return normalizeGraph(updater(root));
  }
  const [segment, ...rest] = path;
  return {
    ...root,
    nodes: root.nodes.map((node) => {
      if (node.id !== segment.nodeId) return node;
      if (segment.kind === "repeatBody") {
        const body = node.body ?? createEmptyGraph();
        const updatedBody = updateGraphAtPath(body, rest, updater);
        return { ...node, body: updatedBody };
      }
      const branches = node.branches ? [...node.branches] : [];
      while (branches.length < 2) {
        branches.push(createEmptyGraph());
      }
      while (branches.length <= segment.branchIndex) {
        branches.push(createEmptyGraph());
      }
      const updatedBranch = updateGraphAtPath(
        branches[segment.branchIndex],
        rest,
        updater
      );
      branches[segment.branchIndex] = updatedBranch;
      return { ...node, branches };
    })
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

function collectNodeLocations(
  graph: EditorGraph,
  contextStack: EditorContext[],
  ancestorBlockIds: string[]
): NodeLocation[] {
  const locations: NodeLocation[] = [];
  const stateNameMap = buildStateNameMap(graph.nodes);
  graph.nodes.forEach((node) => {
    const stateName = stateNameMap.get(node.id) ?? node.id;
    locations.push({
      nodeId: node.id,
      nodeName: node.name,
      stateName,
      contextStack,
      ancestorBlockIds
    });
    if (isRepeatNode(node)) {
      const repeatContext = createRepeatContext(node.id, node.name);
      const bodyGraph = node.body ?? createEmptyGraph();
      locations.push(
        ...collectNodeLocations(
          bodyGraph,
          [...contextStack, repeatContext],
          [...ancestorBlockIds, node.id]
        )
      );
    }
    if (isParallelNode(node)) {
      const parallelContext = createParallelContext(node.id, node.name);
      const branches = node.branches ?? [];
      branches.forEach((branch, index) => {
        const branchContext = createBranchContext(node.id, index);
        locations.push(
          ...collectNodeLocations(
            branch,
            [...contextStack, parallelContext, branchContext],
            [...ancestorBlockIds, node.id]
          )
        );
      });
    }
  });
  return locations;
}

function buildDslFromGraph(graph: EditorGraph): Record<string, unknown> {
  if (graph.nodes.length === 0) {
    return {};
  }
  const stateNameMap = buildStateNameMap(graph.nodes);
  const edgesByFrom = new Map<string, EditorEdge[]>();
  graph.edges.forEach((edge) => {
    if (!stateNameMap.has(edge.from) || !stateNameMap.has(edge.to)) return;
    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(edge);
    edgesByFrom.set(edge.from, list);
  });
  const startNode =
    graph.nodes.find((node) => node.kind === "flow_control.input") ?? graph.nodes[0];
  const states: Record<string, Record<string, unknown>> = {};

  const buildSubgraph = (subgraph: EditorGraph) => {
    if (subgraph.nodes.length === 0) {
      return { StartAt: "", States: {} };
    }
    const dsl = buildDslFromGraph(subgraph) as {
      StartAt?: string;
      States?: Record<string, unknown>;
    };
    return {
      StartAt: dsl.StartAt ?? "",
      States: dsl.States ?? {}
    };
  };

  graph.nodes.forEach((node) => {
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
      const choices: Record<string, unknown>[] = [];
      const trueTarget = getNext("true");
      if (trueTarget) {
        choices.push({
          Variable: "$.condition",
          BooleanEquals: true,
          Next: trueTarget
        });
      }
      const falseTarget = getNext("false");
      if (falseTarget) {
        choices.push({
          Variable: "$.condition",
          BooleanEquals: false,
          Next: falseTarget
        });
      }
      state = { Type: "Choice", Choices: choices };
      if (node.conditionExpressions && node.conditionExpressions.length > 0) {
        state.Expressions = node.conditionExpressions.map((expression) => ({
          operator: expression.operator,
          expression: expression.expression
        }));
      }
    } else if (isParallelNode(node)) {
      const branches = (node.branches ?? []).map((branch) => buildSubgraph(branch));
      state = {
        Type: "Parallel",
        Branches: branches
      };
      const next = getNext("next");
      if (next) {
        state.Next = next;
      } else {
        state.End = true;
      }
    } else if (isRepeatNode(node)) {
      const body = buildSubgraph(node.body ?? createEmptyGraph());
      const rawCount = Number.parseInt(node.params.count ?? "", 10);
      const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1;
      state = {
        Type: "Repeat",
        Count: count,
        Body: body
      };
      const next = getNext("next");
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
  return {
    Comment: "Generated from editor",
    StartAt: stateNameMap.get(startNode.id),
    States: states
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
  onConditionExpressionChange,
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
  nodeTypeConfig,
  skillset,
  blockLabel,
  onOpenSubEditor,
  hasError,
  hasNestedError
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
  onConditionExpressionChange: (expressionId: string, value: string) => void;
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
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>;
  skillset?: import("@/domain/types").Skillset;
  blockLabel?: string;
  onOpenSubEditor?: () => void;
  hasError?: boolean;
  hasNestedError?: boolean;
}) {
  const nodeHeight = getNodeHeight(node, nodeTypeConfig);
  const outputOffsets = getPortOffsets(nodeHeight, outputs.length);
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
  const isBlockNode = Boolean(config.block);
  const repeatCountRaw = Number.parseInt(node.params.count ?? "", 10);
  const repeatCount = Number.isFinite(repeatCountRaw) && repeatCountRaw > 0 ? repeatCountRaw : 1;
  const branchCount = node.branches?.length ?? 0;
  const blockSummary =
    config.block?.type === "parallel"
      ? `Branches: ${branchCount}`
      : config.block?.type === "repeat"
        ? `Repeat: ${repeatCount}`
        : null;

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 bg-white p-3 shadow-sm overflow-visible",
        isBlockNode && "border-[3px] border-slate-300",
        isSelected ? "border-slate-900 ring-4 ring-slate-400 ring-offset-2" : "border-slate-200"
      )}
      data-node-card
      style={{
        width: NODE_METRICS.width,
        height: nodeHeight
      }}
      onClick={onSelect}
      onDoubleClick={(event) => {
        if (!onOpenSubEditor || !blockLabel) return;
        const target = event.target as HTMLElement;
        if (
          target.closest("input") ||
          target.closest("button") ||
          target.closest("[data-no-drag]")
        ) {
          return;
        }
        event.stopPropagation();
        onOpenSubEditor();
      }}
      title={tooltipContent}
    >
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
          style={{ top: nodeHeight / 2 }}
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
        className="flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing pl-1"
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
          <div className="flex items-center gap-2 mb-1">
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
                className="w-full rounded border border-slate-200 bg-white text-sm font-semibold text-slate-800 focus:border-slate-300 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                data-no-drag
                className="cursor-pointer truncate text-left text-sm font-semibold text-slate-800 hover:text-slate-700"
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
            {isBlockNode && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3 w-3"
                >
                  <path d="M4 4h5v5H4V4Zm7 0h5v5h-5V4ZM4 11h5v5H4v-5Zm7 0h5v5h-5v-5Z" />
                </svg>
                Block
              </span>
            )}
            {(hasError || hasNestedError) && (
              <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                Invalid
              </span>
            )}
          </div>

          {isBlockNode && (
            <div className="mb-2 rounded-md border border-dashed border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
              <div className="flex items-center gap-1 font-semibold text-slate-700">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3 w-3"
                >
                  <path d="M6.5 4a2.5 2.5 0 0 0 0 5H8v2H6.5a2.5 2.5 0 1 0 0 5H9a2.5 2.5 0 0 0 0-5H7v-2h2a2.5 2.5 0 1 0 0-5H6.5Z" />
                </svg>
                Contains sub-flow
              </div>
              {blockSummary && <div className="text-slate-500">{blockSummary}</div>}
            </div>
          )}

          {blockLabel && onOpenSubEditor && (
            <button
              type="button"
              data-no-drag
              className="cursor-pointer inline-flex items-center rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
              onClick={(event) => {
                event.stopPropagation();
                onOpenSubEditor();
              }}
            >
              {blockLabel}
            </button>
          )}

        </div>
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
          {conditionExpressions.map((expression, index) => {
            const parts = (expression.expression ?? "").trim().split(" ");
            const variablePart = parts[0] ?? "";
            const operatorPart = parts[1] ?? "";
            const valuePart = parts.slice(2).join(" ");

            return (
              <div key={expression.id} className="space-y-1">
                <span className="text-[10px] text-slate-500">Expression</span>

                {/* 1줄째: AND/OR 배지 + variable + operator */}
                <div className="flex items-center gap-2 min-w-0">
                  {index > 0 && (
                    <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
                      {expression.operator}
                    </span>
                  )}
                  <input
                    value={variablePart}
                    onChange={(event) => {
                      const nextVariable = event.target.value;
                      const combined = [nextVariable, operatorPart, valuePart]
                        .filter((item) => item && item.length > 0)
                        .join(" ");
                      onConditionExpressionChange(expression.id, combined);
                    }}
                    placeholder="variable"
                    className="w-24 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                  />
                  <input
                    value={operatorPart}
                    onChange={(event) => {
                      const nextOperator = event.target.value;
                      const combined = [variablePart, nextOperator, valuePart]
                        .filter((item) => item && item.length > 0)
                        .join(" ");
                      onConditionExpressionChange(expression.id, combined);
                    }}
                    placeholder="=="
                    className="w-16 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                  />
                </div>

                {/* 2줄째: value를 한 줄 전체로 표시 */}
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    value={valuePart}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      const combined = [variablePart, operatorPart, nextValue]
                        .filter((item) => item && item.length > 0)
                        .join(" ");
                      onConditionExpressionChange(expression.id, combined);
                    }}
                    placeholder="value"
                    className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                  />
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
            );
          })}
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
                <input
                  value={node.params[field.key] ?? ""}
                  onChange={(event) => onParamChange(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                />
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
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftOverride, setDraftOverride] = useState<WorkflowDraft | null>(null);
  const [editorGraph, setEditorGraph] = useState<EditorGraph>(() => createEmptyGraph());
  const [editorContextStack, setEditorContextStack] = useState<EditorContext[]>(() => [
    createRootContext("Untitled")
  ]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isEditingWorkflowName, setIsEditingWorkflowName] = useState(false);
  const [workflowName, setWorkflowName] = useState<string>("");
  const [originalWorkflowName, setOriginalWorkflowName] = useState<string>("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  // 노드 타입 목록 생성
  const nodeTypes = useMemo(() => {
    const staticTypes: NodeKind[] = [
      "flow_control.input",
      "flow_control.condition",
      "flow_control.output",
      "flow_control.parallel",
      "flow_control.repeat",
      "event.webhook"
    ];
    const skillTypes: NodeKind[] = skillsetsResponse?.skillsets.map(
      (s) => `skill.${s.name}` as NodeKind
    ) ?? [];
    return [...skillTypes, ...staticTypes];
  }, [skillsetsResponse]);

  const activeDraft = draftOverride ?? draft;
  const graphRef = useMemo(
    () => buildGraphRef(editorContextStack),
    [editorContextStack]
  );
  const activeGraph = useMemo(
    () => getGraphAtPath(editorGraph, graphRef.path),
    [editorGraph, graphRef.path]
  );
  const nodes = activeGraph.nodes;
  const edges = activeGraph.edges;
  const activeCanvas = activeGraph.canvas ?? {
    width: CANVAS_DEFAULT.width,
    height: CANVAS_DEFAULT.height,
    zoom: 1
  };
  const canvasBase = {
    width: activeCanvas.width,
    height: activeCanvas.height
  };
  const zoom = activeCanvas.zoom;
  const editorScope = useMemo(
    () => getEditorScope(editorContextStack),
    [editorContextStack]
  );
  const allowedNodeKinds = useMemo(
    () => getAllowedNodeKinds(editorContextStack, nodeTypes, nodeTypeConfig),
    [editorContextStack, nodeTypes, nodeTypeConfig]
  );
  const isPaletteEnabled = editorScope !== "parallelOverview";
  const isParallelOverview = editorScope === "parallelOverview";
  const focusModeLabel = useMemo(
    () => getFocusModeLabel(editorContextStack),
    [editorContextStack]
  );
  const isFocusMode = Boolean(focusModeLabel);
  const parallelContext = editorContextStack[editorContextStack.length - 1];
  const parallelNode =
    isParallelOverview && parallelContext?.kind === "parallel"
      ? nodes.find((node) => node.id === parallelContext.nodeId)
      : null;
  const parallelBranches = parallelNode?.branches ?? [];

  const updateActiveGraph = useCallback(
    (updater: (graph: EditorGraph) => EditorGraph) => {
      setEditorGraph((prev) => updateGraphAtPath(prev, graphRef.path, updater));
    },
    [graphRef.path]
  );

  const updateActiveNodes = useCallback(
    (updater: (nodes: EditorNode[]) => EditorNode[]) => {
      updateActiveGraph((graph) => {
        const nextNodes = updater(graph.nodes);
        return { ...graph, nodes: nextNodes };
      });
    },
    [updateActiveGraph]
  );

  const updateActiveEdges = useCallback(
    (updater: (edges: EditorEdge[]) => EditorEdge[]) => {
      updateActiveGraph((graph) => {
        const nextEdges = updater(graph.edges);
        return { ...graph, edges: nextEdges };
      });
    },
    [updateActiveGraph]
  );

  const updateActiveCanvas = useCallback(
    (updater: (canvas: { width: number; height: number; zoom: number }) => {
      width: number;
      height: number;
      zoom: number;
    }) => {
      updateActiveGraph((graph) => {
        const currentCanvas = graph.canvas ?? {
          width: CANVAS_DEFAULT.width,
          height: CANVAS_DEFAULT.height,
          zoom: 1
        };
        return { ...graph, canvas: updater(currentCanvas) };
      });
    },
    [updateActiveGraph]
  );
  
  // 현재 workflow의 이름 가져오기
  useEffect(() => {
    if (workflows) {
      const currentWorkflow = workflows.find((w) => w.workflowId === workflowId);
      if (currentWorkflow) {
        setWorkflowName(currentWorkflow.name);
        setOriginalWorkflowName(currentWorkflow.name);
      }
    }
  }, [workflows, workflowId]);

  useEffect(() => {
    setEditorContextStack((prev) => {
      if (prev.length === 0) {
        return [createRootContext(workflowName || "Untitled")];
      }
      const updated = [...prev];
      if (updated[0].kind !== "root") {
        updated.unshift(createRootContext(workflowName || "Untitled"));
        return updated;
      }
      const nextRoot = createRootContext(workflowName || "Untitled");
      if (updated[0].label === nextRoot.label) {
        return prev;
      }
      updated[0] = nextRoot;
      return updated;
    });
  }, [workflowName]);

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
      setEditorGraph(createEmptyGraph(getSize(), 1));
      setEditorContextStack([createRootContext(workflowName || "Untitled")]);
      setHasUnsavedChanges(false);
      return;
    }
    const parsed = parseEditorGraph(draftToApply.view_json, nodeTypes);
    if (!parsed) {
      setEditorGraph(createEmptyGraph(getSize(), 1));
      setEditorContextStack([createRootContext(workflowName || "Untitled")]);
      setHasUnsavedChanges(false);
      return;
    }
    const viewportSize = getViewportCanvasSize();
    const canvas = parsed.canvas ?? {
      width: CANVAS_DEFAULT.width,
      height: CANVAS_DEFAULT.height,
      zoom: 1
    };
    const normalized = normalizeGraph({
      ...parsed,
      canvas: {
        width: Math.max(viewportSize.width, canvas.width),
        height: Math.max(viewportSize.height, canvas.height),
        zoom: clamp(canvas.zoom, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
      }
    });
    setEditorGraph(normalized);
    setEditorContextStack([createRootContext(workflowName || "Untitled")]);
    setHasUnsavedChanges(false);
  }, [nodeTypes, getViewportCanvasSize, workflowName]);

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
      updateActiveCanvas((prev) => {
        const newWidth = Math.max(viewportSize.width, prev.width);
        const newHeight = Math.max(viewportSize.height, prev.height);
        if (newWidth !== prev.width || newHeight !== prev.height) {
          return { ...prev, width: newWidth, height: newHeight };
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
  }, [getViewportCanvasSize, updateActiveCanvas]);

  useEffect(() => {
    setSelectedNode(null);
    setSelectedEdgeId(null);
    setConnectingFrom(null);
    setEditingNodeId(null);
  }, [editorContextStack]);

  useEffect(() => {
    nextNodeIndex.current = getNextIndexFromIds(
      nodes.map((node) => node.id),
      "node"
    );
    nextEdgeIndex.current = getNextIndexFromIds(
      edges.map((edge) => edge.id),
      "edge"
    );
    const conditionIds = nodes.flatMap((node) => node.conditionExpressions ?? []);
    nextConditionIndex.current = getNextIndexFromIds(
      conditionIds.map((expression) => expression.id),
      "condition"
    );
    const variableRowIds = nodes.flatMap((node) => node.variableRows ?? []);
    nextVariableRowIndex.current = getNextIndexFromIds(
      variableRowIds.map((row) => row.id),
      "var"
    );
  }, [edges, nodes]);

  const { data: validationErrors = [] } = useQuery({
    queryKey: ["workflow-validation", workflowId],
    queryFn: () => workflowsApi.validateDraft(workflowId),
    enabled: Boolean(draft)
  });

  const rootContext = useMemo(
    () => createRootContext(workflowName || "Untitled"),
    [workflowName]
  );

  const nodeLocations = useMemo(
    () => collectNodeLocations(editorGraph, [rootContext], []),
    [editorGraph, rootContext]
  );

  const locationsByStateName = useMemo(() => {
    const map = new Map<string, NodeLocation[]>();
    nodeLocations.forEach((location) => {
      const list = map.get(location.stateName) ?? [];
      list.push(location);
      map.set(location.stateName, list);
    });
    return map;
  }, [nodeLocations]);

  const validationMeta = useMemo(() => {
    const errorNodeIds = new Set<string>();
    const nestedBlockIds = new Set<string>();
    const entries = validationErrors.map((error) => {
      const matches =
        error.nodeId && locationsByStateName.get(error.nodeId)
          ? locationsByStateName.get(error.nodeId)
          : undefined;
      const location = matches?.[0];
      if (location) {
        errorNodeIds.add(location.nodeId);
        location.ancestorBlockIds.forEach((id) => nestedBlockIds.add(id));
      }
      const pathSegments = location
        ? [
            ...location.contextStack.slice(1).map((context) => context.label),
            location.nodeName
          ].filter((segment) => segment.length > 0)
        : [];
      const pathLabel = pathSegments.length > 0 ? pathSegments.join("/") : null;
      return { error, location, pathLabel };
    });
    return {
      entries,
      errorNodeIds,
      nestedBlockIds
    };
  }, [locationsByStateName, validationErrors]);

  const handleSelectValidationEntry = useCallback(
    (entry: { location?: NodeLocation | null }) => {
      if (!entry.location) return;
      setEditorContextStack(entry.location.contextStack);
      setSelectedNode(entry.location.nodeId);
      setSelectedEdgeId(null);
      setConnectingFrom(null);
      setEditingNodeId(null);
    },
    []
  );

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
    }
  });

  const publishMutation = useMutation({
    mutationFn: () => workflowsApi.publish(workflowId)
  });

  const hasErrors = validationErrors.length > 0;

  const nodeMap = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]));
  }, [nodes]);

  const nodeTypesByCategory = useMemo(() => {
    return allowedNodeKinds.reduce(
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
  }, [allowedNodeKinds, nodeTypeConfig]);

  const visibleCategories = useMemo(
    () => NODE_CATEGORIES.filter((category) => nodeTypesByCategory[category.id].length > 0),
    [nodeTypesByCategory]
  );

  useEffect(() => {
    if (visibleCategories.length === 0) return;
    if (!visibleCategories.some((category) => category.id === selectedCategory)) {
      setSelectedCategory(visibleCategories[0].id);
    }
  }, [selectedCategory, visibleCategories]);

  useEffect(() => {
    if (editorScope === "parallelOverview") {
      setShowPalette(false);
    }
  }, [editorScope]);

  const incomingEdges = useMemo(() => {
    const map = new Map<string, EditorEdge>();
    edges.forEach((edge) => {
      map.set(edge.to, edge);
    });
    return map;
  }, [edges]);

  const outgoingEdges = useMemo(() => {
    const map = new Map<string, EditorEdge>();
    edges.forEach((edge) => {
      map.set(`${edge.from}:${edge.fromPort}`, edge);
    });
    return map;
  }, [edges]);

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

  useEffect(() => {
    if (!dragState) return;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) return;

      const nextX = point.x - dragState.offsetX;
      const nextY = point.y - dragState.offsetY;
      const { minX, minY, maxX, maxY } = getCanvasBounds(
        canvasBase,
        dragState.height
      );

      updateActiveNodes((prev) =>
        prev.map((item) =>
          item.id === dragState.nodeId
            ? {
                ...item,
                position: {
                  x: clamp(nextX, minX, maxX),
                  y: clamp(nextY, minY, maxY)
                }
              }
            : item
        )
      );
    };

    const handlePointerUp = () => setDragState(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [canvasBase.height, canvasBase.width, dragState, getCanvasPoint, updateActiveNodes]);

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
      expression: ""
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
      if (!allowedNodeKinds.includes(kind)) {
        return;
      }
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
      const blockType = config?.block?.type;
      const blockDefaults =
        blockType === "repeat"
          ? { body: createEmptyGraph() }
          : blockType === "parallel"
            ? { branches: [createEmptyGraph(), createEmptyGraph()] }
            : {};
      updateActiveNodes((prev) => [
        ...prev,
        {
          id,
          name,
          kind,
          position: clampedPosition,
          isExpanded: false,
          params: buildDefaultParams(kind),
          conditionExpressions:
            kind === "flow_control.condition"
              ? [createConditionExpression(null)]
              : undefined,
          variableRows:
            kind === "flow_control.input" || kind === "flow_control.output"
              ? []
              : undefined,
          ...blockDefaults
        }
      ]);
      setSelectedNode(id);
      setSelectedEdgeId(null);
    },
    [
      allowedNodeKinds,
      buildDefaultParams,
      canvasBase,
      createConditionExpression,
      getViewportCenter,
      nodes,
      nodeTypeConfig,
      updateActiveNodes
    ]
  );

  const handleSave = async () => {
    const view_json = editorGraph;
    const dsl_json = buildDslFromGraph(editorGraph);
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
    publishMutation.mutate();
  };

  const handleEnterRepeatBody = useCallback(
    (nodeId: string) => {
      const targetNode = nodes.find((node) => node.id === nodeId);
      if (!targetNode) return;
      updateActiveNodes((prev) =>
        prev.map((node) => {
          if (node.id !== nodeId || !isRepeatNode(node)) return node;
          if (node.body) return node;
          return { ...node, body: createEmptyGraph() };
        })
      );
      setEditorContextStack((prev) =>
        pushRepeatContext(prev, nodeId, targetNode.name)
      );
    },
    [nodes, updateActiveNodes]
  );

  const handleEnterParallelBranches = useCallback(
    (nodeId: string, branchIndex = 0) => {
      const targetNode = nodes.find((node) => node.id === nodeId);
      if (!targetNode) return;
      updateActiveNodes((prev) =>
        prev.map((node) => {
          if (node.id !== nodeId || !isParallelNode(node)) return node;
          const branches = node.branches ? [...node.branches] : [];
          while (branches.length < 2) {
            branches.push(createEmptyGraph());
          }
          return { ...node, branches };
        })
      );
      setEditorContextStack((prev) =>
        pushParallelBranchContext(prev, nodeId, targetNode.name, branchIndex)
      );
    },
    [nodes, updateActiveNodes]
  );

  const handleSelectParallelBranch = useCallback(
    (nodeId: string, branchIndex: number) => {
      const targetNode = nodes.find((node) => node.id === nodeId);
      if (!targetNode) return;
      setEditorContextStack((prev) => {
        const last = prev[prev.length - 1];
        if (last?.kind === "branch" && last.nodeId === nodeId) {
          return [...prev.slice(0, -1), createBranchContext(nodeId, branchIndex)];
        }
        if (last?.kind === "parallel" && last.nodeId === nodeId) {
          return [...prev, createBranchContext(nodeId, branchIndex)];
        }
        return pushParallelBranchContext(prev, nodeId, targetNode.name, branchIndex);
      });
    },
    [nodes]
  );

  const handleBackContext = useCallback(() => {
    setEditorContextStack((prev) => popContext(prev));
  }, []);

  const handleBreadcrumbSelect = useCallback((index: number) => {
    setEditorContextStack((prev) => navigateToContextIndex(prev, index));
  }, []);

  const handleToggleExpand = (nodeId: string) => {
    updateActiveNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        const nextExpanded = !node.isExpanded;
        const nextNode = { ...node, isExpanded: nextExpanded };
        const nodeHeight = getNodeHeight(nextNode, nodeTypeConfig);
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
  };

  const handleParamChange = (nodeId: string, key: string, value: string) => {
    updateActiveNodes((prev) =>
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

  const handleConditionExpressionChange = (
    nodeId: string,
    expressionId: string,
    value: string
  ) => {
    updateActiveNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
        const expressions = node.conditionExpressions ?? [
          createConditionExpression(null)
        ];
        const nextExpressions = expressions.map((expression) =>
          expression.id === expressionId
            ? { ...expression, expression: value }
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
    updateActiveNodes((prev) =>
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
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getNodeHeight(nextNode, nodeTypeConfig)
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
    updateActiveNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId || node.kind !== "flow_control.condition") return node;
        const remaining = (node.conditionExpressions ?? []).filter(
          (expression) => expression.id !== expressionId
        );
        const nextExpressions = normalizeConditionExpressions(remaining);
        const nextNode = { ...node, conditionExpressions: nextExpressions };
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getNodeHeight(nextNode, nodeTypeConfig)
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
    updateActiveNodes((prev) =>
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
    updateActiveNodes((prev) =>
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
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getNodeHeight(nextNode, nodeTypeConfig)
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
    updateActiveNodes((prev) =>
      prev.map((node) => {
        if (
          node.id !== nodeId ||
          (node.kind !== "flow_control.input" && node.kind !== "flow_control.output")
        )
          return node;
        const rows = node.variableRows ?? [];
        const nextRows = rows.filter((row) => row.id !== rowId);
        const nextNode = { ...node, variableRows: nextRows };
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getNodeHeight(nextNode, nodeTypeConfig)
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
    updateActiveNodes((prev) =>
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
    updateActiveNodes((prev) => prev.filter((node) => node.id !== nodeId));
    updateActiveEdges((prev) =>
      prev.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
    );
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
    updateActiveEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
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

    const spacingX = 320;
    const rowGap = 60;
    const padding = 80;
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

    let requiredWidth = canvasBase.width;
    let requiredHeight = canvasBase.height;
    const nextPositions = new Map<string, { x: number; y: number }>();

    Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([layer, group]) => {
        const sortedGroup = [...group].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        let yCursor = padding;
        sortedGroup.forEach((node) => {
          const nodeHeight = getNodeHeight(node, nodeTypeConfig);
          const x = padding + layer * spacingX;
          const y = yCursor;
          yCursor += nodeHeight + rowGap;
          nextPositions.set(node.id, { x, y });
          requiredWidth = Math.max(
            requiredWidth,
            x + NODE_METRICS.width + padding
          );
          requiredHeight = Math.max(requiredHeight, y + nodeHeight + padding);
        });
      });

    updateActiveCanvas((prev) => ({
      ...prev,
      width: Math.max(prev.width, requiredWidth),
      height: Math.max(prev.height, requiredHeight)
    }));

    updateActiveNodes((prev) => {
      const next = prev.map((node) =>
        nextPositions.has(node.id)
          ? { ...node, position: nextPositions.get(node.id)! }
          : node
      );
      if (next !== prev) {
        setHasUnsavedChanges(true);
      }
      return next;
    });
  };

  const connectNodes = useCallback(
    (fromNodeId: string, fromPort: string, toNodeId: string) => {
      if (fromNodeId === toNodeId) return;
      const toNode = nodeMap.get(toNodeId);
      if (!toNode) return;
      const toConfig = nodeTypeConfig[toNode.kind];
      if (toConfig?.inputEnabled === false) return;
      if (incomingEdges.has(toNodeId)) return;
      if (outgoingEdges.has(`${fromNodeId}:${fromPort}`)) return;

      updateActiveEdges((prev) => [
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
    [incomingEdges, nodeMap, outgoingEdges, updateActiveEdges, nodeTypeConfig]
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
    if (incomingEdges.has(nodeId)) {
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
    if (!allowedNodeKinds.includes(rawKind as NodeKind)) return;
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
    return edges.filter((edge) => {
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);
      if (!fromNode || !toNode) return false;
      const config = nodeTypeConfig[fromNode.kind];
      if (!config) return false;
      const outputs = config.outputs;
      return outputs.some((output) => output.key === edge.fromPort);
    });
  }, [edges, nodeMap, nodeTypeConfig]);

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
  }, [connectingFrom, nodeMap]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500">Workflow Editor</p>
          <div className="flex items-center gap-2">
            {isEditingWorkflowName ? (
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
                    setIsEditingWorkflowName(true);
                  }}
                  title="더블클릭하여 이름 변경"
                >
                  {isLoadingWorkflows ? "Loading..." : (workflowName || activeDraft?.workflowId || "Untitled Workflow")}
                </h1>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
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
              </div>
            )}
            <StatusBadge status="DRAFT" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {editorContextStack.length > 1 && (
              <button
                type="button"
                onClick={handleBackContext}
                className="cursor-pointer inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                title="Back"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="h-3 w-3"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 19.5 3 12l7.5-7.5M3 12h18"
                  />
                </svg>
                Back
              </button>
            )}
            <Breadcrumbs contexts={editorContextStack} onSelect={handleBreadcrumbSelect} />
          </div>
          {activeDraft && (
            <p className="text-xs text-slate-500">
              Draft mode · Publish creates an immutable version · Last updated{" "}
              {formatDateTime(activeDraft.updatedAt)}
            </p>
          )}
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

      <div className="relative isolate">
        <button
          type="button"
          disabled={!isPaletteEnabled}
          onClick={() => {
            if (!isPaletteEnabled) return;
            setShowPalette((prev) => !prev);
          }}
          className={cn(
            "absolute left-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full shadow-lg",
            isPaletteEnabled
              ? "cursor-pointer bg-slate-900 text-white"
              : "cursor-not-allowed bg-slate-300 text-white"
          )}
        >
          +
        </button>
        {showPalette && isPaletteEnabled && (
          <div className="absolute left-16 top-4 z-30 flex rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="w-32 border-r border-slate-200 p-3">
              <p className="text-[10px] font-semibold text-slate-500">Category</p>
              <div className="mt-2 space-y-1">
                {visibleCategories.length > 0 ? (
                  visibleCategories.map((category) => (
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
                  ))
                ) : (
                  <p className="text-[10px] text-slate-400">No categories</p>
                )}
              </div>
            </div>
            <div className="w-72 p-3">
              <p className="text-xs font-semibold text-slate-700">
                {visibleCategories.length > 0
                  ? NODE_CATEGORY_LABELS[selectedCategory]
                  : "No nodes available"}
              </p>
              <div className="mt-3 space-y-2">
                {visibleCategories.length > 0 ? (
                  nodeTypesByCategory[selectedCategory].map((kind) => {
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
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-[10px] text-slate-500">
                    이 컨텍스트에서 추가 가능한 노드가 없습니다.
                  </div>
                )}
              </div>
              <p className="mt-3 text-[10px] text-slate-400">
                Drag onto the canvas or click to add at center.
              </p>
            </div>
          </div>
        )}

        <FocusModeEditor isActive={isFocusMode}>
          {isFocusMode && focusModeLabel && (
            <SubflowBanner label={focusModeLabel} onBack={handleBackContext} />
          )}
          <Card className="border-dashed min-w-0">
            {isParallelOverview ? (
              <div className="flex h-[560px] w-full items-center justify-center rounded-md bg-slate-50">
                <div className="max-w-md space-y-4 text-center">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Select a branch to edit
                    </p>
                    <p className="text-xs text-slate-500">
                      Parallel branches share the same focus editor.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {parallelBranches.map((_, index) => (
                      <button
                        key={`branch-${index}`}
                        type="button"
                        className="cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-900"
                        onClick={() => {
                          if (parallelContext?.kind === "parallel") {
                            handleSelectParallelBranch(parallelContext.nodeId, index);
                          }
                        }}
                      >
                        Branch {index + 1}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div
                ref={containerRef}
                className="relative h-[560px] w-full min-w-0 overflow-hidden rounded-md bg-slate-50"
              >
                {isFocusMode && focusModeLabel && (
                  <div className="pointer-events-none absolute left-4 top-16 z-20 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur">
                    Editing: {focusModeLabel}
                  </div>
                )}
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
                      {isFocusMode && (
                        <div className="pointer-events-none absolute inset-0 bg-slate-900/10" />
                      )}
                      <svg
                        className="absolute inset-0"
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
                          const outputOffsets = getPortOffsets(
                            getNodeHeight(fromNode, nodeTypeConfig),
                            outputs.length
                          );
                          const start = {
                            x: fromNode.position.x + NODE_METRICS.width,
                            y: fromNode.position.y + outputOffsets[outputIndex]
                          };
                          const end = {
                            x: toNode.position.x,
                            y: toNode.position.y + getNodeHeight(toNode, nodeTypeConfig) / 2
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

                      {nodes.map((node) => {
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
                        const blockLabel = config.block?.editLabel;
                        const onOpenSubEditor =
                          config.block?.type === "repeat"
                            ? () => handleEnterRepeatBody(node.id)
                            : config.block?.type === "parallel"
                              ? () => handleEnterParallelBranches(node.id)
                              : undefined;
                        const hasError = validationMeta.errorNodeIds.has(node.id);
                        const hasNestedError = validationMeta.nestedBlockIds.has(node.id);
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
                                  height: getNodeHeight(node, nodeTypeConfig)
                                });
                              }}
                              onStartConnect={(portKey) =>
                                handleStartConnect(node.id, portKey)
                              }
                              onCompleteConnect={() => handleCompleteConnect(node.id)}
                              onParamChange={(key, value) =>
                                handleParamChange(node.id, key, value)
                              }
                              onConditionExpressionChange={(expressionId, value) =>
                                handleConditionExpressionChange(
                                  node.id,
                                  expressionId,
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
                              blockLabel={blockLabel}
                              onOpenSubEditor={onOpenSubEditor}
                              hasError={hasError}
                              hasNestedError={hasNestedError}
                            />
                          </div>
                        );
                      })}

                      {nodes.length === 0 && (
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-sm text-slate-400">
                          <p>Drag a node here or click in the palette.</p>
                          <p className="text-xs">
                            Use output ports to connect nodes with arrows.
                          </p>
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
                      updateActiveCanvas((prev) => ({
                        ...prev,
                        zoom: clamp(prev.zoom - ZOOM_LIMITS.step, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
                      }))
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
                      updateActiveCanvas((prev) => ({
                        ...prev,
                        zoom: clamp(prev.zoom + ZOOM_LIMITS.step, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
                      }))
                    }
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="cursor-pointer rounded px-1 text-slate-500 hover:text-slate-900"
                    onClick={() =>
                      updateActiveCanvas((prev) => ({
                        ...prev,
                        zoom: 1
                      }))
                    }
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </Card>
        </FocusModeEditor>
      </div>

      {hasErrors && (
        <div className="fixed bottom-6 right-6 z-20">
          <button
            type="button"
            className="cursor-pointer flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
            onClick={() => setShowValidation((prev) => !prev)}
          >
            {validationErrors.length} Validation Errors
          </button>
          {showValidation && (
            <div className="mt-3 w-72 rounded-lg border border-red-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
              <p className="font-semibold text-red-600">Errors</p>
              <ul className="mt-2 space-y-2">
                {validationMeta.entries.map((entry, index) => (
                  <li key={`${entry.error.id}-${index}`} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => handleSelectValidationEntry(entry)}
                      className="cursor-pointer text-left text-slate-700 hover:text-slate-900"
                    >
                      {entry.error.message}
                    </button>
                    {entry.pathLabel && (
                      <p className="text-[10px] text-slate-400">
                        {entry.pathLabel}
                      </p>
                    )}
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
