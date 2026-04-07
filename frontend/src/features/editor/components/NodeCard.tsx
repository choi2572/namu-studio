"use client";

import { useCallback, useMemo } from "react";
import type {
  DragEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import { VariableInput } from "@/components/VariableInput";
import type { Skillset } from "@/domain/types";
import { cn } from "@/lib/cn";
import { getAvailableVariables } from "@/lib/variableReferences";

import {
  CONDITION_COMPARISON_OPERATORS,
  NODE_CATEGORY_LABELS,
  NODE_METRICS,
  RETRY_THEME_COLORS
} from "../editorConstants";
import { getNodeHeight, getPortOffsets } from "../editorNodeLayout";
import { getRetryScopeStartNodeId } from "../editorRetryScope";
import { getSkillDisplayType } from "../editorSkillset";
import { SearchableNodeDropdown } from "./SearchableNodeDropdown";
import type {
  ConditionOperator,
  EditorEdge,
  EditorNode,
  NodeCategory,
  NodeKind,
  NodeTypeConfig,
  VariableValueType
} from "../editorTypes";

export function NodeCard({
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
  skillsetMap,
  portLayout = "horizontal"
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
  /** TODO: EditorPage에서 전달되지만 카드 UI에서 아직 호출하지 않음 — 스코프 끝 토글 연동 시 사용. */
  onRetryScopeEndChange?: (checked: boolean) => void;
  warningLabel?: string | null;
  startEndBadge?: {
    showStart: boolean;
    showEnd: boolean;
    isRootScope: boolean;
    startError?: string;
  } | null;
  /** 리본이 있을 때 포함한 전체 높이. 미전달 시 getNodeHeight만 사용(과거 동작) */
  effectiveHeight?: number;
  /** 실패 캔버스: 위(입력) / 아래(출력). 기본은 좌(입력) / 우(출력) */
  portLayout?: "horizontal" | "vertical";
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>;
  skillset?: Skillset;
  nodes: EditorNode[];
  edges: EditorEdge[];
  stateNameMap: Map<string, string>;
  skillsetMap: Map<string, Skillset>;
}) {
  const nodeHeight = getNodeHeight(node, nodeTypeConfig);
  const displayHeight = effectiveHeight ?? nodeHeight;
  const isVertical = portLayout === "vertical";
  const outputOffsetsVertical = getPortOffsets(NODE_METRICS.width, outputs.length);
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
    // Retry 노드는 개별 테마 색상을 사용하므로, 여기서는 기본값만 정의하고
    // 실제 적용은 아래에서 retryThemeColor를 통해 덮어쓴다.
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
    // flow_control (기본)
    return {
      border: "border-cyan-200",
      bg: "bg-cyan-50",
      text: "text-cyan-700",
      indicator: "bg-cyan-500"
    };
  };

  let nodeTypeColors = getNodeTypeColors(config.category, node.kind);
  if (node.kind === "flow_control.retry" && node.retryThemeColor) {
    const theme =
      RETRY_THEME_COLORS.find((t) => t.key === node.retryThemeColor) ??
      RETRY_THEME_COLORS[0];
    nodeTypeColors = {
      border: theme.border,
      bg: theme.bg,
      text: theme.text,
      indicator: theme.indicator
    };
  }
  const nodeTypeLabel = NODE_CATEGORY_LABELS[config.category];

  // 툴팁 내용 생성 (type은 namespace.name 형태로 표시)
  const tooltipContent = skillset
    ? `${skillset.name} (${skillset.version})\nType: ${getSkillDisplayType(skillset)}\n\n${skillset.description}`
    : node.kind;

  const showStartRibbon =
    startEndBadge?.showStart && !startEndBadge?.showEnd && !startEndBadge?.startError;
  const showEndRibbon =
    Boolean(startEndBadge?.showEnd && !startEndBadge?.showStart);
  const showStartEndRibbon =
    Boolean(startEndBadge?.showStart && startEndBadge?.showEnd && !startEndBadge?.startError);
  const hasRibbon = showStartRibbon || showEndRibbon || showStartEndRibbon;

  const getRetryScopeCandidates = useCallback(
    (scopeType: "main" | "failure"): EditorNode[] => {
      if (node.kind !== "flow_control.retry") return [];
      const startId = getRetryScopeStartNodeId(node.id, scopeType, edges);
      if (!startId) return [];
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const outEdges = new Map<string, EditorEdge>();
      edges.forEach((e) => {
        if (nodeMap.has(e.from) && nodeMap.has(e.to)) outEdges.set(e.from, e);
      });
      const result: EditorNode[] = [];
      let current: string | null = startId;
      while (current) {
        const currentNode = nodeMap.get(current);
        if (!currentNode) break;
        // flow_control 노드를 만나면 그 전까지만 후보로 사용
        if (currentNode.kind.startsWith("flow_control.")) break;
        result.push(currentNode);
        const next: string | null = outEdges.get(current)?.to ?? null;
        if (!next) break;
        current = next;
      }
      return result;
    },
    [node.id, node.kind, nodes, edges]
  );

  const mainScopeCandidates = useMemo(
    () => getRetryScopeCandidates("main"),
    [getRetryScopeCandidates]
  );
  const failureScopeCandidates = useMemo(
    () => getRetryScopeCandidates("failure"),
    [getRetryScopeCandidates]
  );

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 bg-white p-3 shadow-sm overflow-visible",
        // 접힌 상태에서는 카드 전체(바깥 패딩 영역 포함)를 드래그 핸들처럼 보이도록 커서 표시
        !node.isExpanded && "cursor-grab active:cursor-grabbing",
        isSelected ? "border-slate-900 ring-4 ring-slate-400 ring-offset-2" : "border-slate-200"
      )}
      data-node-card
      style={{
        width: NODE_METRICS.width,
        height: displayHeight
      }}
      onClick={onSelect}
      onPointerDown={(event) => {
        // 접힌 상태에서만 카드 바깥 패딩 영역도 드래그 시작점으로 사용
        if (node.isExpanded) return;
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
            "cursor-pointer absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-white shadow-sm z-10",
            inputConnected ? "border-slate-400" : "border-slate-200",
            isVertical ? "left-1/2" : "left-0"
          )}
          style={
            isVertical
              ? { top: 0 }
              : { top: displayHeight / 2 }
          }
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
        let outputTooltip = `Output: ${output.label}`;
        if (skillset) {
          if (output.key === "next" && Object.keys(skillset.outputs).length > 0) {
            const outputEntries = Object.entries(skillset.outputs);
            outputTooltip = outputEntries
              .map(([key, outputInfo]) => {
                return `${key}\nType: ${outputInfo.type}${outputInfo.description ? `\n${outputInfo.description}` : ""}`;
              })
              .join("\n\n");
          } else if (skillset.outputs[output.key]) {
            const outputInfo = skillset.outputs[output.key];
            outputTooltip = `${output.key}\nType: ${outputInfo.type}${outputInfo.description ? `\n${outputInfo.description}` : ""}`;
          }
        }
        const style = isVertical
          ? {
              left: outputOffsetsVertical[index],
              top: displayHeight,
              // 경계선에 걸치도록 중앙을 경계선에 맞춤
              transform: "translate(-50%, -50%)"
            }
          : {
              top: outputOffsets[index],
              transform: "translate(50%, -50%)"
            };
        return (
          <div
            key={output.key}
            className={cn(
              "absolute flex items-center gap-1.5 z-20",
              isVertical ? "justify-center" : "right-0"
            )}
            style={style}
          >
            <button
              type="button"
              draggable
              data-no-drag
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
                  node.kind === "flow_control.retry" && output.key === "failure"
                    ? output.isActive
                      ? "bg-rose-700"
                      : output.isConnected
                        ? "bg-rose-500"
                        : "bg-rose-400"
                    : output.isActive
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
          // 기존 디자인 유지 (얇은 패딩)
          "flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing pl-1",
          hasRibbon && "pt-6"
        )}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;

          // 펼쳐진 상태에서는 기존처럼 input / button / data-no-drag 영역은 드래그 제외
          if (node.isExpanded) {
            if (
              target.closest("input") ||
              target.closest("button") ||
              target.closest("[data-no-drag]")
            ) {
              return;
            }
          } else {
            // 접힌 상태에서는 unfold 버튼/포트 등 data-no-drag 만 제외하고
            // 이름/패딩 포함 헤더 전체를 드래그 영역으로 사용
            if (target.closest("[data-no-drag]")) {
              return;
            }
          }

          event.stopPropagation();
          event.preventDefault();
          onDragStart(event);
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 min-w-0 group">
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
              <>
                <button
                  type="button"
                  // 펼쳐진 상태에서만 이름 더블클릭으로 리네임 가능 + 드래그 제외
                  // 접힌 상태에서는 data-no-drag / cursor-pointer 를 제거해서
                  // 헤더 전체(이름 영역 포함)가 드래그 핸들이 되도록 함
                  {...(node.isExpanded
                    ? {
                        "data-no-drag": true,
                        className:
                          "cursor-pointer truncate text-left text-sm font-semibold text-slate-800 hover:text-slate-700 flex-1 min-w-0"
                      }
                    : {
                        className:
                          "cursor-grab active:cursor-grabbing truncate text-left text-sm font-semibold text-slate-800 flex-1 min-w-0"
                      })}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!node.isExpanded) return;
                    onStartEditName();
                  }}
                  title="Double click to rename"
                >
                  {node.name}
                </button>
                <button
                  type="button"
                  data-no-drag
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditName();
                  }}
                  className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  title="이름 변경"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-3 h-3"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                    />
                  </svg>
                </button>
              </>
            )}
          </div>
          
          {/* 노드 타입 배지 + Retry 스코프 배지 */}
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
            {node.retryScopeType && node.retryOwnerId && (() => {
              const ownerNode = nodes.find((n) => n.id === node.retryOwnerId);
              const mainTheme =
                node.retryScopeType === "main" && ownerNode?.retryThemeColor
                  ? RETRY_THEME_COLORS.find((t) => t.key === ownerNode.retryThemeColor) ??
                    RETRY_THEME_COLORS[0]
                  : null;
              const badgeClass =
                node.retryScopeType === "main"
                  ? mainTheme
                    ? `${mainTheme.border} ${mainTheme.bg} ${mainTheme.text}`
                    : "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-rose-500 bg-rose-50 text-rose-700";
              return (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold border",
                    badgeClass
                  )}
                  title={
                    node.retryScopeType === "main"
                      ? "Retry main scope member"
                      : "Retry failure scope member"
                  }
                >
                  {node.retryScopeType === "main" ? (
                    <span className="text-[10px]">↻</span>
                  ) : (
                    <span className="text-[10px]">!</span>
                  )}
                </span>
              );
            })()}
          </div>

          {/* Skill 노드: 펼쳤을 때 타입을 namespace.name 형태로 노출 */}
          {skillset && node.isExpanded && (
            <div className="mb-1 text-[10px] text-slate-500 truncate" title={getSkillDisplayType(skillset)}>
              {getSkillDisplayType(skillset)}
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
      {node.isExpanded && node.kind === "flow_control.retry" && (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          <label className="block" data-no-drag>
            <span className="text-[10px] text-slate-500">On Failure</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                checked={node.params.onFailureEnabled !== "false"}
                onChange={(event) => {
                  onParamChange("onFailureEnabled", event.target.checked ? "true" : "false");
                }}
              />
              <span className="text-xs text-slate-600">Run on-failure flow before retry</span>
            </div>
          </label>
          {/* Main retry scope end 선택 */}
          <div className="mt-2 space-y-1" data-no-drag>
            <span className="text-[10px] text-slate-500">Main scope end</span>
            <SearchableNodeDropdown
              nodes={mainScopeCandidates}
              selectedId={node.params.mainScopeEndId ?? ""}
              placeholder="Select main scope end"
              onChange={(id) => onParamChange("mainScopeEndId", id)}
            />
          </div>

          {/* Failure scope end 선택 (onFailureEnabled = true 일 때만) */}
          {node.params.onFailureEnabled !== "false" && (
            <div className="mt-2 space-y-1" data-no-drag>
              <span className="text-[10px] text-slate-500">Failure scope end</span>
              <SearchableNodeDropdown
                nodes={failureScopeCandidates}
                selectedId={node.params.failureScopeEndId ?? ""}
                placeholder="Select failure scope end"
                onChange={(id) => onParamChange("failureScopeEndId", id)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
