import { ENABLE_VLM_NODES } from "@/lib/featureFlags";
import {
  DEFAULT_PARALLEL_BRANCHES,
  FAILURE_CANVAS_BASE,
  NODE_METRICS,
  RETRY_THEME_COLORS
} from "./editorConstants";
import {
  applyImportedLayout,
  filterEdgesByContainerRules,
  getCanvasSizeForNodes,
  getDefaultContainerFrameSize,
  normalizeContainerAssignments,
  normalizeContainerFrames
} from "./editorContainerLayout";
import {
  dslOperatorToEditor,
  isRecord,
  parseConditionExpressionString
} from "./editorPureUtils";
import { getNodeHeight } from "./editorNodeLayout";
import type {
  ConditionExpression,
  ConditionOperator,
  ContainerType,
  EditorEdge,
  EditorNode,
  FailureHandlingGraph,
  NodeKind,
  NodeTypeConfig,
  VariableRow,
  VariableValueType
} from "./editorTypes";

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
  RepeatCount?: number;
  StartAt?: string;
  MaxAttempts?: number;
  /** Retry 본문 (Repeat·Parallel과 동일 키). 레거시 export 키 `State`도 import 시 허용 */
  States?: Record<string, DslState> | Array<Record<string, DslState>>;
  State?: Record<string, DslState>;
  BeforeRetryAfterFailure?: Record<string, DslState>;
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
  /** 루트 `States` 키 → 에디터 노드 id (OnFailure DSL 복원용) */
  rootStateNameToNodeId?: Map<string, string>;
};
export function getRetryNestedStatesMap(state: DslState): Record<string, DslState> | undefined {
  if (Array.isArray(state.States)) {
    const merged: Record<string, DslState> = {};
    for (const item of state.States) {
      if (isRecord(item)) {
        Object.assign(merged, item as Record<string, DslState>);
      }
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
  }
  if (isRecord(state.States)) {
    return state.States as Record<string, DslState>;
  }
  if (isRecord(state.State)) {
    return state.State as Record<string, DslState>;
  }
  return undefined;
}

export function inferDslSubflowStartAt(body: Record<string, DslState>): string | null {
  const keys = Object.keys(body);
  if (keys.length === 0) return null;
  if (keys.length === 1) return keys[0];
  const targeted = new Set<string>();
  for (const st of Object.values(body)) {
    if (!st || typeof st !== "object") continue;
    if (typeof st.Next === "string") targeted.add(st.Next);
    if (st.Type === "Condition" && isRecord(st.If) && typeof st.If.Then === "string") {
      targeted.add(st.If.Then);
    }
    if (typeof st.Else === "string") targeted.add(st.Else);
  }
  const roots = keys.filter((k) => !targeted.has(k));
  if (roots.length === 1) return roots[0];
  if (roots.length > 0) return [...roots].sort()[0];
  return [...keys].sort()[0];
}

export function findRetryLinearTerminal(
  body: Record<string, DslState>,
  startName: string,
  innerIdByState: Map<string, string>
): { stateName: string; nodeId: string } | null {
  if (!startName || !innerIdByState.has(startName)) return null;
  let currentName: string | null = startName;
  const visited = new Set<string>();
  while (currentName !== null && innerIdByState.has(currentName) && !visited.has(currentName)) {
    visited.add(currentName);
    const step: DslState | undefined = body[currentName];
    if (!step) break;
    if (step.Type === "Condition" || step.Type === "Choice") {
      return { stateName: currentName, nodeId: innerIdByState.get(currentName)! };
    }
    if (step.End === true) {
      return { stateName: currentName, nodeId: innerIdByState.get(currentName)! };
    }
    const nextName: string | null = typeof step.Next === "string" ? step.Next : null;
    if (!nextName || !body[nextName]) {
      return { stateName: currentName, nodeId: innerIdByState.get(currentName)! };
    }
    currentName = nextName;
  }
  return null;
}

export function parseDslToEditor(
  dslJson: Record<string, unknown>,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>,
  options?: { applyImportedLayout?: boolean }
): ParsedEditorGraph | null {
  if (!isRecord(dslJson)) return null;
  const states = (dslJson as { States?: Record<string, DslState> }).States;
  if (!states || !isRecord(states)) return null;

  const rawInputs = (dslJson as { Inputs?: unknown }).Inputs;

  const mapEntryToVariableRow = (
    name: string,
    entry: unknown,
    varRowIndex: { current: number }
  ): VariableRow | null => {
    if (!name.trim()) return null;
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
            ? rawValue
              ? "true"
              : "false"
            : "";
    return {
      id: `var-${varRowIndex.current++}`,
      name: name.trim(),
      value,
      valueType
    };
  };

  const varRowCounter = { current: 1 };
  let inputVariableRows: VariableRow[] = [];
  let syntheticInputFromBlock = false;
  let inputNextFromDsl: string | null = null;

  if (isRecord(rawInputs) && isRecord(rawInputs.Parameters)) {
    syntheticInputFromBlock = true;
    inputVariableRows = Object.entries(rawInputs.Parameters)
      .map(([name, entry]) => mapEntryToVariableRow(name, entry, varRowCounter))
      .filter((row): row is VariableRow => row != null);
    inputNextFromDsl =
      typeof rawInputs.Next === "string" ? rawInputs.Next : null;
  } else if (isRecord(rawInputs)) {
    inputVariableRows = Object.entries(rawInputs)
      .filter(
        ([name]) =>
          typeof name === "string" &&
          name.trim() !== "" &&
          name !== "Type" &&
          name !== "Skill" &&
          name !== "Next" &&
          name !== "Parameters"
      )
      .map(([name, entry]) => mapEntryToVariableRow(name, entry, varRowCounter))
      .filter((row): row is VariableRow => row != null);
  }

  let nodeIndex = 1;
  let inputNodeIdForSynthetic: string | null = null;
  let edgeIndex = 1;
  let conditionIndex = 1;
  const nodes: EditorNode[] = [];
  const edges: EditorEdge[] = [];

  if (syntheticInputFromBlock) {
    inputNodeIdForSynthetic = `node-${nodeIndex++}`;
    nodes.push({
      id: inputNodeIdForSynthetic,
      name: "Inputs",
      kind: "flow_control.input",
      position: { x: 0, y: 0 },
      isExpanded: false,
      params: {},
      variableRows: inputVariableRows,
      containerId: null,
      containerType: null,
      branchIndex: null
    });
  }

  const createNodeKind = (state: DslState, stateName: string): NodeKind => {
    if (state.Type === "Condition") return "flow_control.condition";
    if (state.Type === "Choice") return "flow_control.condition";
    if (state.Type === "Succeed") return "flow_control.output";
    if (state.Type === "Pass") {
      const label = state.Label != null ? String(state.Label) : "";
      if (
        ENABLE_VLM_NODES &&
        (stateName.startsWith("VLMPlanner") || /VLM\s*Planner/i.test(label))
      ) {
        return "flow_control.vlm";
      }
      return "flow_control.input";
    }
    if (state.Type === "Parallel") return "flow_control.parallel";
    if (state.Type === "Repeat") return "flow_control.repeat";
    if (state.Type === "Retry") return "flow_control.retry";
    const skillName = typeof state.Skill === "string" ? state.Skill : stateName;
    return `skill.${skillName}` as NodeKind;
  };

  const parseStateGroup = (
    groupStates: Record<string, DslState>,
    context?: {
      containerId?: string;
      containerType?: ContainerType;
      branchIndex?: number;
      retryOwnerId?: string;
      retryScopeType?: "main" | "failure";
    }
  ): Map<string, string> => {
    const idByState = new Map<string, string>();
    Object.entries(groupStates).forEach(([stateName, state]) => {
      const kind = createNodeKind(state, stateName);
      if (kind === "flow_control.input" && syntheticInputFromBlock && inputNodeIdForSynthetic) {
        idByState.set(stateName, inputNodeIdForSynthetic);
        return;
      }
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
      if (kind === "flow_control.repeat") {
        const repeatCount = typeof state.RepeatCount === "number" ? state.RepeatCount : typeof state.Count === "number" ? state.Count : undefined;
        if (repeatCount !== undefined) {
          params.count = `${repeatCount}`;
        }
      }
      if (kind === "flow_control.retry") {
        const ma = state.MaxAttempts;
        const n =
          typeof ma === "number" && Number.isFinite(ma)
            ? Math.max(1, Math.floor(ma))
            : 2;
        params.maxAttempts = String(n);
        const fail = state.BeforeRetryAfterFailure;
        const hasFail = isRecord(fail) && Object.keys(fail).length > 0;
        params.onFailureEnabled = hasFail ? "true" : "false";
        params.mainScopeEndId = "";
        params.failureScopeEndId = "";
      }
      let conditionExpressions: ConditionExpression[] | undefined;
      if (kind === "flow_control.condition") {
        const ifCond = isRecord(state.If) && isRecord(state.If.Condition) ? state.If.Condition : null;
        if (ifCond) {
          const rawVar = (ifCond as { Variable?: unknown }).Variable;
          const variable =
            typeof rawVar === "string"
              ? rawVar
              : typeof rawVar === "number" || typeof rawVar === "boolean"
                ? String(rawVar)
                : "";
          const comparisonOperator = dslOperatorToEditor(typeof ifCond.Operator === "string" ? ifCond.Operator : "Equals");
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
      const inRetryScope = Boolean(context?.retryOwnerId);
      nodes.push({
        id,
        name:
          kind === "flow_control.input"
            ? syntheticInputFromBlock
              ? "Inputs"
              : (state.Label ?? stateName)
            : state.Label ?? stateName,
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
        containerId: inRetryScope ? null : (context?.containerId ?? null),
        containerType: inRetryScope ? null : (context?.containerType ?? null),
        branchIndex: inRetryScope
          ? null
          : context?.containerType === "parallel"
            ? context.branchIndex ?? 0
            : null,
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
              : undefined,
        retryOwnerId: context?.retryOwnerId ?? null,
        retryScopeType: context?.retryScopeType ?? null,
        isRetryScopeEnd: false,
        ...(kind === "flow_control.retry" && !inRetryScope
          ? {
              retryThemeColor:
                RETRY_THEME_COLORS[stateName.length % RETRY_THEME_COLORS.length]!.key
            }
          : {})
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
      } else if (
        state.Type !== "Retry" &&
        typeof state.Next === "string" &&
        idByState.has(state.Next)
      ) {
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
      if (state.Type === "Repeat") {
        let bodyStates: Record<string, DslState> | undefined;
        if (Array.isArray(state.States)) {
          bodyStates = {};
          for (const item of state.States) {
            if (isRecord(item)) {
              Object.assign(bodyStates, item);
            }
          }
        } else if (isRecord(state.States)) {
          bodyStates = state.States as Record<string, DslState>;
        } else if (state.Body?.States) {
          bodyStates = state.Body.States;
        }
        if (bodyStates && Object.keys(bodyStates).length > 0) {
          parseStateGroup(bodyStates as Record<string, DslState>, {
            containerId,
            containerType: "repeat",
            branchIndex: 0
          });
        }
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
      if (state.Type === "Retry") {
        const retryId = idByState.get(stateName);
        if (!retryId) return;
        const mainBody = getRetryNestedStatesMap(state);
        const startAt =
          typeof state.StartAt === "string" && mainBody && mainBody[state.StartAt]
            ? state.StartAt
            : mainBody
              ? inferDslSubflowStartAt(mainBody)
              : null;
        if (mainBody && startAt) {
          const innerMap = parseStateGroup(mainBody, {
            retryOwnerId: retryId,
            retryScopeType: "main"
          });
          const mainStartNodeId = innerMap.get(startAt);
          if (mainStartNodeId) {
            edges.push({
              id: `edge-${edgeIndex++}`,
              from: retryId,
              fromPort: "main",
              to: mainStartNodeId
            });
          }
          const terminal = findRetryLinearTerminal(mainBody, startAt, innerMap);
          if (terminal) {
            const ti = nodes.findIndex((n) => n.id === terminal.nodeId);
            if (ti >= 0) {
              nodes[ti] = { ...nodes[ti]!, isRetryScopeEnd: true };
            }
            const ri = nodes.findIndex((n) => n.id === retryId);
            if (ri >= 0) {
              const rn = nodes[ri]!;
              nodes[ri] = {
                ...rn,
                params: { ...rn.params, mainScopeEndId: terminal.nodeId }
              };
            }
            if (typeof state.Next === "string" && idByState.has(state.Next)) {
              edges.push({
                id: `edge-${edgeIndex++}`,
                from: terminal.nodeId,
                fromPort: "next",
                to: idByState.get(state.Next) as string
              });
            }
          }
        }
        const failRaw = state.BeforeRetryAfterFailure;
        if (isRecord(failRaw) && Object.keys(failRaw).length > 0) {
          const failBody = failRaw as Record<string, DslState>;
          const fStart = inferDslSubflowStartAt(failBody);
          if (fStart) {
            const innerFailMap = parseStateGroup(failBody, {
              retryOwnerId: retryId,
              retryScopeType: "failure"
            });
            const failStartId = innerFailMap.get(fStart);
            if (failStartId) {
              edges.push({
                id: `edge-${edgeIndex++}`,
                from: retryId,
                fromPort: "failure",
                to: failStartId
              });
            }
            const fTerminal = findRetryLinearTerminal(failBody, fStart, innerFailMap);
            if (fTerminal) {
              const fi = nodes.findIndex((n) => n.id === fTerminal.nodeId);
              if (fi >= 0) {
                nodes[fi] = { ...nodes[fi]!, isRetryScopeEnd: true };
              }
              const ri = nodes.findIndex((n) => n.id === retryId);
              if (ri >= 0) {
                const rn = nodes[ri]!;
                nodes[ri] = {
                  ...rn,
                  params: { ...rn.params, failureScopeEndId: fTerminal.nodeId }
                };
              }
            }
          }
        }
      }
    });

    return idByState;
  };

  const workflowRootIdByState = parseStateGroup(states);

  if (
    syntheticInputFromBlock &&
    inputNodeIdForSynthetic &&
    workflowRootIdByState
  ) {
    const nextName =
      inputNextFromDsl ??
      (typeof dslJson.StartAt === "string" ? dslJson.StartAt : null);
    if (nextName) {
      const targetId = workflowRootIdByState.get(nextName);
      if (targetId && targetId !== inputNodeIdForSynthetic) {
        const alreadyLinked = edges.some(
          (e) =>
            e.from === inputNodeIdForSynthetic &&
            e.to === targetId &&
            e.fromPort === "next"
        );
        if (!alreadyLinked) {
          edges.push({
            id: `edge-${edgeIndex++}`,
            from: inputNodeIdForSynthetic,
            fromPort: "next",
            to: targetId
          });
        }
      }
    }
  }

  let nextNodes: EditorNode[];
  if (options?.applyImportedLayout === false) {
    nextNodes = normalizeContainerFrames(normalizeContainerAssignments(nodes));
  } else {
    nextNodes = applyImportedLayout(nodes, edges, nodeTypeConfig);
    nextNodes = normalizeContainerFrames(normalizeContainerAssignments(nextNodes));
  }
  const displayEdges = filterEdgesByContainerRules(nextNodes, edges);
  const canvas = getCanvasSizeForNodes(nextNodes, nodeTypeConfig);
  return {
    nodes: nextNodes,
    edges: displayEdges,
    canvas: { ...canvas, zoom: 1 },
    rootStateNameToNodeId: workflowRootIdByState ?? new Map<string, string>()
  };
}

/** import·DSL 복원용: 엔트리에서 `Next` 체인 최장 거리로 레이어(행) 부여 */
export function assignFailureLayersFromEntry(
  entryId: string,
  nodeIds: Set<string>,
  edges: EditorEdge[]
): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  nodeIds.forEach((id) => outgoing.set(id, []));
  for (const e of edges) {
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
      outgoing.get(e.from)!.push(e.to);
    }
  }
  const layers = new Map<string, number>();
  if (nodeIds.has(entryId)) {
    layers.set(entryId, 0);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, tos] of outgoing.entries()) {
      const base = layers.get(from);
      if (base === undefined) continue;
      for (const to of tos) {
        const nextL = base + 1;
        const cur = layers.get(to) ?? -1;
        if (nextL > cur) {
          layers.set(to, nextL);
          changed = true;
        }
      }
    }
  }
  const reachable = new Set<string>();
  const stack = [entryId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (!nodeIds.has(id) || reachable.has(id)) continue;
    reachable.add(id);
    for (const to of outgoing.get(id) ?? []) {
      stack.push(to);
    }
  }
  let maxL = 0;
  layers.forEach((v) => {
    maxL = Math.max(maxL, v);
  });
  for (const id of nodeIds) {
    if (!reachable.has(id)) {
      layers.set(id, maxL + 1);
    } else if (!layers.has(id)) {
      layers.set(id, 0);
    }
  }
  return layers;
}

/** view.failure 없이 OnFailure DSL만 있을 때: 위→아래 중앙 정렬 기본 레이아웃 */
export function layoutFailureGraphImportedDefaultVertical(
  nodes: EditorNode[],
  edges: EditorEdge[],
  entryNodeId: string,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
): EditorNode[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(entryNodeId)) return nodes;
  const layers = assignFailureLayersFromEntry(entryNodeId, nodeIds, edges);
  const byLayer = new Map<number, EditorNode[]>();
  for (const node of nodes) {
    const L = layers.get(node.id) ?? 0;
    const g = byLayer.get(L) ?? [];
    g.push(node);
    byLayer.set(L, g);
  }
  const sortedLayerKeys = [...byLayer.keys()].sort((a, b) => a - b);
  const positions = new Map<string, { x: number; y: number }>();
  const canvasCenterX = FAILURE_CANVAS_BASE.width / 2;
  let yCursor = 40;
  const colGap = 28;
  const rowGap = 56;

  for (const L of sortedLayerKeys) {
    const group = (byLayer.get(L) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    const maxH = Math.max(
      ...group.map((n) => getNodeHeight(n, nodeTypeConfig)),
      NODE_METRICS.collapsedHeight
    );
    const rowW =
      group.length * NODE_METRICS.width + Math.max(0, group.length - 1) * colGap;
    let x = canvasCenterX - rowW / 2;
    for (const node of group) {
      positions.set(node.id, { x, y: yCursor });
      x += NODE_METRICS.width + colGap;
    }
    yCursor += maxH + rowGap;
  }

  return nodes.map((n) => {
    const p = positions.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}

/** `dsl_json.OnFailure`만 있고 view.failure가 없을 때 실패 핸들링 캔버스를 복구한다. */
export function failureGraphFromOnFailureDsl(
  onFailureDsl: Record<string, unknown>,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
): FailureHandlingGraph | null {
  const parsed = parseDslToEditor(onFailureDsl, nodeTypeConfig, {
    applyImportedLayout: false
  });
  const stateMap = parsed?.rootStateNameToNodeId;
  if (!parsed || !stateMap || parsed.nodes.length === 0) return null;
  const startAt =
    typeof onFailureDsl.StartAt === "string" ? onFailureDsl.StartAt.trim() : "";
  if (!startAt) return null;
  const startNodeId = stateMap.get(startAt);
  if (!startNodeId) return null;

  const entryId = "failure-entry-1";
  const entryNode: EditorNode = {
    id: entryId,
    name: "On Workflow Failure",
    kind: "system.on_failure_entry",
    position: {
      x: FAILURE_CANVAS_BASE.width / 2 - NODE_METRICS.width / 2,
      y: 40
    },
    isExpanded: true,
    params: {}
  };

  const idMap = new Map<string, string>();
  idMap.set(entryId, entryId);
  parsed.nodes.forEach((node, index) => {
    idMap.set(node.id, `failure-node-${index + 1}`);
  });

  const remapNodeId = (id: string | null | undefined): string | null => {
    if (id == null) return null;
    return idMap.get(id) ?? id;
  };

  const remappedNodes: EditorNode[] = parsed.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id)!,
    containerId: remapNodeId(node.containerId),
    retryOwnerId:
      node.retryOwnerId != null
        ? idMap.get(node.retryOwnerId) ?? node.retryOwnerId
        : node.retryOwnerId
  }));

  const remappedEdges: EditorEdge[] = [];
  let edgeIx = 1;
  remappedEdges.push({
    id: `failure-edge-${edgeIx++}`,
    from: entryId,
    fromPort: "next",
    to: idMap.get(startNodeId)!
  });
  for (const edge of parsed.edges) {
    const from = idMap.get(edge.from);
    const to = idMap.get(edge.to);
    if (!from || !to) continue;
    remappedEdges.push({
      ...edge,
      id: `failure-edge-${edgeIx++}`,
      from,
      to
    });
  }

  const nodesBeforeLayout = [entryNode, ...remappedNodes];
  const laidOutNodes = layoutFailureGraphImportedDefaultVertical(
    nodesBeforeLayout,
    remappedEdges,
    entryId,
    nodeTypeConfig
  );

  return {
    enabled: true,
    drawerOpen: false,
    entryNodeId: entryId,
    nodes: laidOutNodes,
    edges: remappedEdges
  };
}

export function validateImportedDslForEditor(
  dslJson: Record<string, unknown>,
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
): { ok: true } | { ok: false; errors: string[] } {
  let parsed: ParsedEditorGraph | null;
  try {
    parsed = parseDslToEditor(dslJson, nodeTypeConfig);
  } catch (error) {
    return {
      ok: false,
      errors: [
        error instanceof Error
          ? `Could not parse workflow DSL: ${error.message}`
          : "Could not parse workflow DSL (unexpected error)."
      ]
    };
  }
  if (!parsed) {
    return {
      ok: false,
      errors: [
        "Invalid workflow DSL: expected a States map that the editor can read (check StartAt / States shape)."
      ]
    };
  }
  const unknownKinds = new Set<string>();
  for (const node of parsed.nodes) {
    if (!nodeTypeConfig[node.kind]) {
      unknownKinds.add(node.kind);
    }
  }
  if (unknownKinds.size > 0) {
    return {
      ok: false,
      errors: [...unknownKinds].map((kind) =>
        kind.startsWith("skill.")
          ? `Unknown skill (not in catalog): ${kind}`
          : `Unknown node type (not supported in this editor): ${kind}`
      )
    };
  }
  return { ok: true };
}
