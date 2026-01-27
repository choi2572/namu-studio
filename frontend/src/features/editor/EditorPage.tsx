"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DragEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { workflowsApi } from "@/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { ValidationError, WorkflowDraft } from "@/domain/types";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

type EditorPageProps = {
  workflowId: string;
};

type NodeKind =
  | "skill.pick"
  | "skill.place"
  | "flow_control.input"
  | "flow_control.condition"
  | "flow_control.output"
  | "event.webhook";

type NodeCategory = "skill" | "flow_control" | "event";

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

type ConditionExpression = {
  id: string;
  operator: ConditionOperator | null;
  expression: string;
};

type VariableRow = {
  id: string;
  name: string;
  value: string;
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

type ConnectingState = {
  nodeId: string;
  portKey: string;
} | null;

type EdgeDragPayload = {
  nodeId: string;
  portKey: string;
};

const NODE_TYPES: NodeKind[] = [
  "skill.pick",
  "skill.place",
  "flow_control.input",
  "flow_control.condition",
  "flow_control.output",
  "event.webhook"
];

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

const NODE_TYPE_CONFIG: Record<NodeKind, NodeTypeConfig> = {
  "skill.pick": {
    label: "Pick",
    category: "skill",
    iconText: "PK",
    colorClass: "border-blue-200 bg-blue-100 text-blue-700",
    paramFields: [
      { key: "target", label: "Target", placeholder: "bin-A" },
      { key: "quantity", label: "Quantity", placeholder: "1" }
    ],
    outputs: [{ key: "next", label: "Next" }]
  },
  "skill.place": {
    label: "Place",
    category: "skill",
    iconText: "PL",
    colorClass: "border-emerald-200 bg-emerald-100 text-emerald-700",
    paramFields: [
      { key: "destination", label: "Destination", placeholder: "slot-3" },
      { key: "orientation", label: "Orientation", placeholder: "north" }
    ],
    outputs: [{ key: "next", label: "Next" }]
  },
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

function getExpandedContentHeight(node: EditorNode) {
  if (node.kind === "flow_control.condition") {
    const expressionCount = Math.max(1, node.conditionExpressions?.length ?? 1);
    const expressionsHeight =
      expressionCount * NODE_METRICS.fieldHeight +
      Math.max(0, expressionCount - 1) * NODE_METRICS.fieldGap;
    const buttonsHeight = NODE_METRICS.conditionButtonHeight + NODE_METRICS.fieldGap;
    return NODE_METRICS.expandedTopPadding + expressionsHeight + buttonsHeight;
  }

  if (node.kind === "flow_control.input" || node.kind === "flow_control.output") {
    const rowCount = Math.max(1, node.variableRows?.length ?? 1);
    const rowsHeight =
      rowCount * NODE_METRICS.fieldHeight +
      Math.max(0, rowCount - 1) * NODE_METRICS.fieldGap;
    const addButtonHeight = NODE_METRICS.fieldHeight + NODE_METRICS.fieldGap;
    return NODE_METRICS.expandedTopPadding + rowsHeight + addButtonHeight;
  }

  const fieldCount = NODE_TYPE_CONFIG[node.kind].paramFields.length;
  if (fieldCount === 0) return 0;
  return (
    NODE_METRICS.expandedTopPadding +
    fieldCount * NODE_METRICS.fieldHeight +
    Math.max(0, fieldCount - 1) * NODE_METRICS.fieldGap
  );
}

function getNodeHeight(node: EditorNode) {
  if (!node.isExpanded) return NODE_METRICS.collapsedHeight;
  return NODE_METRICS.collapsedHeight + getExpandedContentHeight(node);
}

function getNodeTypeLabel(kind: NodeKind) {
  const config = NODE_TYPE_CONFIG[kind];
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
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.value === "string"
  );
}

function isValidEditorNode(value: unknown): value is EditorNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.name !== "string") return false;
  if (typeof value.kind !== "string" || !NODE_TYPES.includes(value.kind as NodeKind)) {
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

function parseEditorView(viewJson: Record<string, unknown>): EditorViewJson | null {
  const rawNodes = viewJson.nodes;
  const rawEdges = viewJson.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;
  if (!rawNodes.every(isValidEditorNode) || !rawEdges.every(isValidEditorEdge)) {
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
    nodes: rawNodes as EditorNode[],
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

function buildDslJson(nodes: EditorNode[], edges: EditorEdge[]) {
  if (nodes.length === 0) {
    return {};
  }
  const stateNameMap = buildStateNameMap(nodes);
  const edgesByFrom = new Map<string, EditorEdge[]>();
  edges.forEach((edge) => {
    if (!stateNameMap.has(edge.from) || !stateNameMap.has(edge.to)) return;
    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(edge);
    edgesByFrom.set(edge.from, list);
  });
  const startNode =
    nodes.find((node) => node.kind === "flow_control.input") ?? nodes[0];
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
    } else {
      const next = getNext("next");
      state = {
        Type: node.kind === "flow_control.input" ? "Pass" : "Task",
        Resource: node.kind,
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
  onNameChange,
  isEditingName,
  onStartEditName,
  onFinishEditName,
  onOutputDragStart,
  onOutputDragEnd,
  onInputDragOver,
  onInputDrop
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
  onAddVariableRow?: () => void;
  onRemoveVariableRow?: (rowId: string) => void;
  onNameChange: (value: string) => void;
  isEditingName: boolean;
  onStartEditName: () => void;
  onFinishEditName: () => void;
  onOutputDragStart: (event: DragEvent<HTMLButtonElement>, portKey: string) => void;
  onOutputDragEnd: () => void;
  onInputDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onInputDrop: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const nodeHeight = getNodeHeight(node);
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

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 bg-white p-3 shadow-sm overflow-visible",
        isSelected ? "border-slate-900 ring-4 ring-slate-400 ring-offset-2" : "border-slate-200"
      )}
      data-node-card
      style={{
        width: NODE_METRICS.width,
        height: nodeHeight
      }}
      onClick={onSelect}
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
            "absolute left-0 flex h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-white shadow-sm z-10",
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
              "h-1.5 w-1.5 rounded-full",
              inputConnected ? "bg-slate-600" : "bg-slate-400"
            )}
          />
        </button>
      )}

      {outputs.map((output, index) => (
        <div
          key={output.key}
          className="absolute right-0 flex items-center gap-1.5 z-20"
          style={{ top: outputOffsets[index], transform: "translate(50%, -50%)" }}
        >
          <span
            className={cn(
              "text-[9px] whitespace-nowrap text-right",
              output.isActive 
                ? "text-slate-700 font-medium opacity-80" 
                : "text-slate-400 opacity-60"
            )}
          >
            {output.label}
          </span>
          <button
            type="button"
            draggable
            className={cn(
              "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border bg-white shadow-sm",
              output.isActive
                ? "border-slate-900"
                : output.isConnected
                  ? "border-slate-400"
                  : "border-slate-200"
            )}
            title={`Output ${output.label}`}
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
                "h-1.5 w-1.5 rounded-full",
                output.isActive
                  ? "bg-slate-900"
                  : output.isConnected
                    ? "bg-slate-600"
                    : "bg-slate-400"
              )}
            />
          </button>
        </div>
      ))}

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
                className="truncate text-left text-sm font-semibold text-slate-800 hover:text-slate-700"
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

          {(!node.isExpanded || config.category === "skill") && (
            <p className="text-xs text-slate-600 truncate">{node.kind}</p>
          )}
        </div>
        <button
          type="button"
          data-no-drag
          className="flex-shrink-0 text-slate-500 hover:text-slate-900"
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
              <div className="flex items-center gap-2 min-w-0">
                {index > 0 && (
                  <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
                    {expression.operator}
                  </span>
                )}
                <input
                  value={expression.expression}
                  onChange={(event) =>
                    onConditionExpressionChange(expression.id, event.target.value)
                  }
                  placeholder="payload.ok === true"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                />
                {index > 0 && (
                  <button
                    type="button"
                    data-no-drag
                    className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
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
              className="rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
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
              className="rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
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
            {node.variableRows.map((row, rowIndex) => (
              <div key={row.id} className="flex items-center gap-2 min-w-0">
                <input
                  value={row.name}
                  onChange={(event) =>
                    onVariableRowChange?.(row.id, "name", event.target.value)
                  }
                  placeholder="Variable name"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                />
                <input
                  value={row.value}
                  onChange={(event) =>
                    onVariableRowChange?.(row.id, "value", event.target.value)
                  }
                  placeholder="Value"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-slate-400 focus:outline-none"
                />
                {node.variableRows && node.variableRows.length > 1 && (
                  <button
                    type="button"
                    data-no-drag
                    className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
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
            <button
              type="button"
              data-no-drag
              className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
              onClick={(e) => {
                e.stopPropagation();
                onAddVariableRow?.();
              }}
              title="Add row"
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
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            </button>
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
  const [isEditingWorkflowName, setIsEditingWorkflowName] = useState(false);
  const [workflowName, setWorkflowName] = useState<string>("");
  const [originalWorkflowName, setOriginalWorkflowName] = useState<string>("");

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

  const { data: workflows } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => workflowsApi.list()
  });

  const activeDraft = draftOverride ?? draft;
  
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
      return;
    }
    const parsed = parseEditorView(draftToApply.view_json);
    if (!parsed) {
      setNodes([]);
      setEdges([]);
      setCanvasBase(getSize());
      setZoom(1);
      return;
    }
    setNodes(parsed.nodes);
    setEdges(parsed.edges);
    if (parsed.canvas) {
      const viewportSize = getViewportCanvasSize();
      setCanvasBase({
        width: Math.max(viewportSize.width, parsed.canvas.width),
        height: Math.max(viewportSize.height, parsed.canvas.height)
      });
      setZoom(
        clamp(parsed.canvas.zoom, ZOOM_LIMITS.min, ZOOM_LIMITS.max)
      );
    } else {
      setCanvasBase(getSize());
      setZoom(1);
    }
    nextNodeIndex.current = getNextIndexFromIds(
      parsed.nodes.map((node) => node.id),
      "node"
    );
    nextEdgeIndex.current = getNextIndexFromIds(
      parsed.edges.map((edge) => edge.id),
      "edge"
    );
    const conditionIds = parsed.nodes.flatMap(
      (node) => node.conditionExpressions ?? []
    );
    nextConditionIndex.current = getNextIndexFromIds(
      conditionIds.map((expression) => expression.id),
      "condition"
    );
    const variableRowIds = parsed.nodes.flatMap(
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
  }, []);

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
      downloadJsonFile(`${saved.workflowId}.asl.json`, saved.dsl_json);
      if (saved.workflowId !== workflowId) {
        router.replace(`/editor/${saved.workflowId}`);
      }
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
    return NODE_TYPES.reduce(
      (acc, kind) => {
        acc[NODE_TYPE_CONFIG[kind].category].push(kind);
        return acc;
      },
      {
        skill: [],
        flow_control: [],
        event: []
      } as Record<NodeCategory, NodeKind[]>
    );
  }, []);

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

      setNodes((prev) =>
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
  }, [canvasBase.height, canvasBase.width, dragState, getCanvasPoint]);

  const buildDefaultParams = useCallback((kind: NodeKind) => {
    return NODE_TYPE_CONFIG[kind].paramFields.reduce(
      (acc, field) => ({
        ...acc,
        [field.key]: ""
      }),
      {} as Record<string, string>
    );
  }, []);

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
      const name = `${NODE_TYPE_CONFIG[kind].label} ${index}`;
      setNodes((prev) => [
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
              ? [{ id: `var-${nextVariableRowIndex.current++}`, name: "", value: "" }]
              : undefined
        }
      ]);
      setSelectedNode(id);
      setSelectedEdgeId(null);
    },
    [
      buildDefaultParams,
      canvasBase,
      createConditionExpression,
      getViewportCenter,
      nodes
    ]
  );

  const handleSave = async () => {
    const view_json = buildViewJson(nodes, edges, canvasBase, zoom);
    const dsl_json = buildDslJson(nodes, edges);
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
  };

  const handleCancel = () => {
    setDraftOverride(draft ?? null);
    applyDraftToEditor(draft ?? null);
    setSelectedNode(null);
  };

  const handlePublish = () => {
    if (hasErrors) return;
    publishMutation.mutate();
  };

  const handleToggleExpand = (nodeId: string) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        const nextExpanded = !node.isExpanded;
        const nextNode = { ...node, isExpanded: nextExpanded };
        const nodeHeight = getNodeHeight(nextNode);
        const { minX, minY, maxX, maxY } = getCanvasBounds(canvasBase, nodeHeight);
        return {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
      })
    );
  };

  const handleParamChange = (nodeId: string, key: string, value: string) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? { ...node, params: { ...node.params, [key]: value } }
          : node
      )
    );
  };

  const handleConditionExpressionChange = (
    nodeId: string,
    expressionId: string,
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
            ? { ...expression, expression: value }
            : expression
        );
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
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getNodeHeight(nextNode)
        );
        return {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
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
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getNodeHeight(nextNode)
        );
        return {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
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
        return { ...node, variableRows: nextRows };
      })
    );
  };

  const handleAddVariableRow = (nodeId: string) => {
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
          { id: `var-${nextVariableRowIndex.current++}`, name: "", value: "" }
        ];
        const nextNode = { ...node, variableRows: nextRows };
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getNodeHeight(nextNode)
        );
        return {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
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
        if (nextRows.length === 0) {
          nextRows.push({ id: `var-${nextVariableRowIndex.current++}`, name: "", value: "" });
        }
        const nextNode = { ...node, variableRows: nextRows };
        const { minX, minY, maxX, maxY } = getCanvasBounds(
          canvasBase,
          getNodeHeight(nextNode)
        );
        return {
          ...nextNode,
          position: {
            x: clamp(node.position.x, minX, maxX),
            y: clamp(node.position.y, minY, maxY)
          }
        };
      })
    );
  };

  const handleNameChange = (nodeId: string, value: string) => {
    setNodes((prev) =>
      prev.map((node) => (node.id === nodeId ? { ...node, name: value } : node))
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
    setNodes((prev) => prev.filter((node) => node.id !== nodeId));
    setEdges((prev) =>
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
  };

  const handleDeleteEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((prev) => (prev === edgeId ? null : prev));
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
          const nodeHeight = getNodeHeight(node);
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

    setCanvasBase((prev) => ({
      width: Math.max(prev.width, requiredWidth),
      height: Math.max(prev.height, requiredHeight)
    }));

    setNodes((prev) =>
      prev.map((node) =>
        nextPositions.has(node.id)
          ? { ...node, position: nextPositions.get(node.id)! }
          : node
      )
    );
  };

  const connectNodes = useCallback(
    (fromNodeId: string, fromPort: string, toNodeId: string) => {
      if (fromNodeId === toNodeId) return;
      const toNode = nodeMap.get(toNodeId);
      if (!toNode) return;
      if (NODE_TYPE_CONFIG[toNode.kind].inputEnabled === false) return;
      if (incomingEdges.has(toNodeId)) return;
      if (outgoingEdges.has(`${fromNodeId}:${fromPort}`)) return;

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
    },
    [incomingEdges, nodeMap, outgoingEdges]
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
    if (!NODE_TYPES.includes(rawKind as NodeKind)) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) return;

    const dropX = point.x - NODE_METRICS.width / 2;
    const dropY = point.y - NODE_METRICS.collapsedHeight / 2;
    createNode(rawKind as NodeKind, { x: dropX, y: dropY });
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
      const outputs = NODE_TYPE_CONFIG[fromNode.kind].outputs;
      return outputs.some((output) => output.key === edge.fromPort);
    });
  }, [edges, nodeMap]);

  const connectingLabel = useMemo(() => {
    if (!connectingFrom) return null;
    const node = nodeMap.get(connectingFrom.nodeId);
    if (!node) return null;
    const output = NODE_TYPE_CONFIG[node.kind].outputs.find(
      (item) => item.key === connectingFrom.portKey
    );
    return `${node.name} - ${output?.label ?? connectingFrom.portKey}`;
  }, [connectingFrom, nodeMap]);

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
                  {workflowName || activeDraft?.workflowId || "Loading..."}
                </h1>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditingWorkflowName(true);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
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

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPalette((prev) => !prev)}
          className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg"
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
                      "w-full rounded-md px-2 py-1 text-left text-xs",
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
                  const config = NODE_TYPE_CONFIG[kind];
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
                      className="flex w-full items-center gap-3 rounded-md border border-slate-200 px-2 py-2 text-left text-xs text-slate-700 hover:border-slate-300"
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

        <Card className="border-dashed min-w-0">
          <div
            ref={containerRef}
            className="relative h-[560px] w-full min-w-0 overflow-hidden rounded-md bg-slate-50"
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
                      const outputs = NODE_TYPE_CONFIG[fromNode.kind].outputs;
                      const outputIndex = outputs.findIndex(
                        (output) => output.key === edge.fromPort
                      );
                      if (outputIndex < 0) return null;
                      const outputOffsets = getPortOffsets(
                        getNodeHeight(fromNode),
                        outputs.length
                      );
                      const start = {
                        x: fromNode.position.x + NODE_METRICS.width,
                        y: fromNode.position.y + outputOffsets[outputIndex]
                      };
                      const end = {
                        x: toNode.position.x,
                        y: toNode.position.y + getNodeHeight(toNode) / 2
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
                    const config = NODE_TYPE_CONFIG[node.kind];
                    const outputStates = config.outputs.map((output) => ({
                      key: output.key,
                      label: output.label,
                      isConnected: outgoingEdges.has(`${node.id}:${output.key}`),
                      isActive:
                        connectingFrom?.nodeId === node.id &&
                        connectingFrom.portKey === output.key
                    }));
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
                              height: getNodeHeight(node)
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
                          onAddVariableRow={() => handleAddVariableRow(node.id)}
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
                className="rounded px-1 text-slate-600 hover:text-slate-900"
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
                className="rounded px-1 text-slate-600 hover:text-slate-900"
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
                className="rounded px-1 text-slate-500 hover:text-slate-900"
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
            className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
            onClick={() => setShowValidation((prev) => !prev)}
          >
            {validationErrors.length} Validation Errors
          </button>
          {showValidation && (
            <div className="mt-3 w-72 rounded-lg border border-red-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
              <p className="font-semibold text-red-600">Errors</p>
              <ul className="mt-2 space-y-2">
                {validationErrors.map((error: ValidationError) => (
                  <li key={error.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedNode(error.nodeId ?? null)}
                      className="text-left text-slate-700 hover:text-slate-900"
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
