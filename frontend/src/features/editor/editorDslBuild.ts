import type { Skillset } from "@/domain/types";
import {
  getRetryScopeEndNodeId,
  getRetryScopeNodeIds,
  getRetryScopeStartNodeId
} from "./editorRetryScope";
import { comparisonOperatorToDsl } from "./editorPureUtils";
import {
  getContainerBranchCount,
  getContainerType,
  getRepeatCount,
  isContainerNode
} from "./editorContainerLayout";
import { getSkillDisplayType } from "./editorSkillset";
import type {
  ContainerType,
  EditorEdge,
  EditorNode,
  EditorViewJson,
  FailureHandlingGraph,
  VariableValueType
} from "./editorTypes";

export function buildStateNameMap(nodes: EditorNode[]) {
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
  startAt?: string | null;
  states?: Record<string, Record<string, unknown>>;
  branches?: Array<{ StartAt: string | null; States: Record<string, Record<string, unknown>> }>;
};

export function findStartNode(nodes: EditorNode[], edges: EditorEdge[]) {
  if (nodes.length === 0) return null;
  const inputNode = nodes.find((node) => node.kind === "flow_control.input");
  if (inputNode) return inputNode;
  const incoming = new Set(edges.map((edge) => edge.to));
  const candidate = nodes.find((node) => !incoming.has(node.id));
  return candidate ?? nodes[0];
}

/** Input 행 → DSL Condition 등에 넣을 타입이 있는 JSON 값 */
export function typedValueFromInputVariableRow(
  valueType: VariableValueType,
  value: string
): number | boolean | string {
  switch (valueType) {
    case "int": {
      const n = Number.parseInt(value, 10);
      return Number.isFinite(n) ? n : 0;
    }
    case "double": {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "bool":
      return value === "true" || value === "1";
    default:
      return value;
  }
}

export function buildInputValuesMapFromNode(
  inputNode: EditorNode | undefined
): Map<string, number | boolean | string> {
  const map = new Map<string, number | boolean | string>();
  inputNode?.variableRows?.forEach(({ name, value, valueType }) => {
    if (!name.trim()) return;
    map.set(name.trim(), typedValueFromInputVariableRow(valueType, value));
  });
  return map;
}

const CONDITION_INPUTS_REF = /^\$\.Inputs\.([A-Za-z_][A-Za-z0-9_]*)$/;

/** Condition·Skill 파라미터 문자열: `$.Inputs.x`는 입력 기본값으로 치환, 그 외 `$` 경로는 유지, 리터럴은 숫자·불로 직렬화 */
export function conditionFieldToDslValue(
  raw: string,
  inputValues: Map<string, number | boolean | string> | undefined
): string | number | boolean {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return "";
  if (trimmed.startsWith("$")) {
    const m = trimmed.match(CONDITION_INPUTS_REF);
    if (m && inputValues?.has(m[1])) {
      return inputValues.get(m[1])!;
    }
    return trimmed;
  }
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  const n = Number(trimmed);
  if (Number.isFinite(n) && trimmed !== "") {
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      return n;
    }
  }
  return trimmed;
}

export function buildStateRecords(
  nodes: EditorNode[],
  edges: EditorEdge[],
  stateNameMap: Map<string, string>,
  containerPayloads?: Map<string, ContainerDslPayload>,
  skillsetMap?: Map<string, Skillset>,
  allNodes?: EditorNode[],
  allEdges?: EditorEdge[],
  inputValuesForConditions?: Map<string, number | boolean | string>
) {
  const fullNodes = allNodes ?? nodes;
  const fullEdges = allEdges ?? edges;
  const edgesByFrom = new Map<string, EditorEdge[]>();
  edges.forEach((edge) => {
    if (!stateNameMap.has(edge.from) || !stateNameMap.has(edge.to)) return;
    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(edge);
    edgesByFrom.set(edge.from, list);
  });
  const states: Record<string, Record<string, unknown>> = {};
  nodes.forEach((node) => {
    if (node.kind === "flow_control.input") {
      return;
    }
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
      const Operator = comparisonOperatorToDsl(firstExpr?.comparisonOperator ?? "==");
      const Variable = conditionFieldToDslValue(variableRaw, inputValuesForConditions);
      const valueRaw = firstExpr?.value ?? "";
      const Value = conditionFieldToDslValue(valueRaw, inputValuesForConditions);
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
        RepeatCount: payload?.repeatCount ?? getRepeatCount(node),
        StartAt: payload?.startAt ?? null,
        States: payload?.states ?? {}
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
    } else if (node.kind === "flow_control.retry") {
      const onFailureEnabled = node.params.onFailureEnabled !== "false";
      const containerPayloadsMap = containerPayloads ?? new Map();
      const mainScopeIds = getRetryScopeNodeIds(node.id, "main", fullNodes, fullEdges);
      const mainScopeEndId = getRetryScopeEndNodeId(node.id, "main", fullNodes, fullEdges);
      let next: string | null = null;
      if (mainScopeEndId) {
        const outEdge = fullEdges.find((e) => e.from === mainScopeEndId);
        if (outEdge && !mainScopeIds.has(outEdge.to)) next = stateNameMap.get(outEdge.to) ?? null;
      }
      const mainScope = buildRetryScopeSubflow(
        node.id,
        "main",
        fullNodes,
        fullEdges,
        stateNameMap,
        containerPayloadsMap,
        skillsetMap,
        inputValuesForConditions
      );
      const failureScope = onFailureEnabled
        ? buildRetryScopeSubflow(
            node.id,
            "failure",
            fullNodes,
            fullEdges,
            stateNameMap,
            containerPayloadsMap,
            skillsetMap,
            inputValuesForConditions
          )
        : null;
      const maxAttempts = Math.max(1, Number.parseInt(node.params.maxAttempts ?? "2", 10) || 2);
      state = {
        Type: "Retry",
        MaxAttempts: maxAttempts,
        StartAt: mainScope.startAt ?? undefined,
        States: mainScope.states
      };
      if (next) state.Next = next;
      else state.End = true;
      if (failureScope && Object.keys(failureScope.states).length > 0) {
        state.BeforeRetryAfterFailure = failureScope.states;
      }
    } else if (node.kind === "flow_control.vlm") {
      const next = getNext("next");
      state = { Type: "Pass", Parameters: {} };
      if (next) {
        state.Next = next;
      } else {
        state.End = true;
      }
    } else {
      const next = getNext("next");
      // DSL Skill 값: 표시와 동일하게 namespace.skilltype( namespace.name ) 형태
      const skillset = skillsetMap?.get(node.kind);
      const skillName =
        skillset != null
          ? getSkillDisplayType(skillset)
          : node.kind.startsWith("skill.")
            ? node.kind.replace("skill.", "")
            : node.kind;
      const skillParameters = Object.fromEntries(
        Object.entries(node.params).map(([paramKey, paramVal]) => [
          paramKey,
          conditionFieldToDslValue(paramVal, inputValuesForConditions)
        ])
      );
      state = {
        Type: "Skill",
        Skill: skillName,
        Parameters: skillParameters
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

export function buildDslJson(
  nodes: EditorNode[],
  edges: EditorEdge[],
  skillsetMap?: Map<string, Skillset>,
  failureGraph?: FailureHandlingGraph
) {
  if (nodes.length === 0) {
    return {};
  }
  const containerNodes = nodes.filter(isContainerNode);
  const containerIds = new Set(containerNodes.map((node) => node.id));
  const topLevelNodes = nodes.filter(
    (node) => (!node.containerId || !containerIds.has(node.containerId)) && !node.retryOwnerId
  );
  const topLevelNodeIds = new Set(topLevelNodes.map((node) => node.id));
  const topLevelEdges = edges.filter(
    (edge) => topLevelNodeIds.has(edge.from) && topLevelNodeIds.has(edge.to)
  );
  const stateNameMap = buildStateNameMap(nodes);
  const inputNode = topLevelNodes.find((n) => n.kind === "flow_control.input");
  const inputValuesForConditions = buildInputValuesMapFromNode(inputNode);
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
        containerPayloads,
        skillsetMap,
        undefined,
        undefined,
        inputValuesForConditions
      );
      containerPayloads.set(container.id, {
        type: "repeat",
        repeatCount: getRepeatCount(container),
        startAt: bodyStartNode ? (stateNameMap.get(bodyStartNode.id) ?? null) : null,
        states: bodyStates
      });
      return;
    }
    const branchCount = getContainerBranchCount(container);
    const branches = Array.from({ length: branchCount }, (_, index) => {
      const branchNodes = nodes.filter(
        (node) => node.containerId === container.id && (node.branchIndex ?? 0) === index
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
        containerPayloads,
        skillsetMap,
        undefined,
        undefined,
        inputValuesForConditions
      );
      return {
        StartAt: branchStartNode ? (stateNameMap.get(branchStartNode.id) ?? null) : null,
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
    containerPayloads,
    skillsetMap,
    nodes,
    edges,
    inputValuesForConditions
  );
  const inputNextEdge = inputNode
    ? topLevelEdges.find((e) => e.from === inputNode.id && e.fromPort === "next")
    : undefined;
  const inputNextStateName = inputNextEdge ? stateNameMap.get(inputNextEdge.to) : undefined;

  const inputsParameters: Record<string, { Type: string; Value: number | boolean | string }> = {};
  inputNode?.variableRows?.forEach(({ name, value, valueType }) => {
    if (!name.trim()) return;
    const Type = valueType;
    const Value = typedValueFromInputVariableRow(valueType, value);
    inputsParameters[name.trim()] = { Type, Value };
  });

  const workflowStartAt = inputNode
    ? inputNextStateName
    : startNode
      ? stateNameMap.get(startNode.id)
      : undefined;

  const inputsBlock: Record<string, unknown> | null =
    inputNode != null
      ? {
          Type: "Pass",
          Skill: "flow_control.input",
          ...(inputNextStateName ? { Next: inputNextStateName } : {}),
          Parameters: inputsParameters
        }
      : null;

  const baseDsl: Record<string, unknown> = {
    Comment: "Generated from editor",
    StartAt: workflowStartAt,
    ...(inputsBlock ? { Inputs: inputsBlock } : {}),
    States: states
  };

  if (!failureGraph || !failureGraph.enabled) {
    return baseDsl;
  }

  const onFailure = buildOnFailureDsl(failureGraph, stateNameMap, inputValuesForConditions);
  if (!onFailure) {
    return baseDsl;
  }

  return {
    ...baseDsl,
    OnFailure: onFailure
  };
}

export function buildOnFailureDsl(
  failureGraph: FailureHandlingGraph,
  stateNameMap: Map<string, string>,
  inputValuesForConditions?: Map<string, number | boolean | string>
) {
  const { nodes, edges, entryNodeId } = failureGraph;
  if (!nodes.length) return null;

  const entry = nodes.find((n) => n.id === entryNodeId);
  if (!entry) return null;

  const firstEdge = edges.find((e) => e.from === entry.id);
  if (!firstEdge) {
    // enable 되었지만 유저 정의 노드가 하나도 없는 경우: OnFailure 직렬화 생략
    return null;
  }

  const startNode = nodes.find((n) => n.id === firstEdge.to);
  if (!startNode) return null;

  const failureNodes = nodes.filter((n) => n.id !== entry.id);
  const failureNodeIds = new Set(failureNodes.map((n) => n.id));
  const failureEdges = edges.filter((e) => failureNodeIds.has(e.from) && failureNodeIds.has(e.to));

  const failureStateNameMap = new Map<string, string>();
  Array.from(failureNodeIds).forEach((id, index) => {
    const existing = stateNameMap.get(id);
    failureStateNameMap.set(id, existing ?? `OnFailure_${index + 1}`);
  });

  const states = buildStateRecords(
    failureNodes,
    failureEdges,
    failureStateNameMap,
    new Map(),
    undefined,
    undefined,
    undefined,
    inputValuesForConditions
  );

  const startStateName = failureStateNameMap.get(startNode.id);
  if (!startStateName) return null;

  const visited = new Set<string>();
  let currentName: string | undefined | null = startStateName;
  let lastName: string | null = null;
  while (currentName && !visited.has(currentName)) {
    visited.add(currentName);
    lastName = currentName;
    const state = states[currentName] as (Record<string, unknown> & { Next?: string }) | undefined;
    if (!state || !state.Next) break;
    currentName = state.Next;
  }
  if (lastName && states[lastName]) {
    if (!states[lastName].Next) {
      states[lastName].End = true;
    }
  }

  return {
    StartAt: startStateName,
    States: states
  };
}

export function buildViewJson(
  nodes: EditorNode[],
  edges: EditorEdge[],
  canvasBase: { width: number; height: number },
  zoom: number,
  failureGraph: FailureHandlingGraph,
  /** 최종 `dsl_json`에 OnFailure가 있을 때만 실패 캔버스 레이아웃을 남긴다. */
  persistFailureLayout: boolean
): EditorViewJson {
  const base: EditorViewJson = {
    version: "v1",
    nodes,
    edges,
    canvas: {
      width: canvasBase.width,
      height: canvasBase.height,
      zoom
    }
  };
  if (persistFailureLayout) {
    base.failure = {
      entryNodeId: failureGraph.entryNodeId,
      nodes: failureGraph.nodes,
      edges: failureGraph.edges
    };
  }
  return base;
}
export function buildRetryScopeSubflow(
  retryNodeId: string,
  scopeType: "main" | "failure",
  nodes: EditorNode[],
  edges: EditorEdge[],
  stateNameMap: Map<string, string>,
  containerPayloads: Map<string, ContainerDslPayload>,
  skillsetMap?: Map<string, Skillset>,
  inputValuesForConditions?: Map<string, number | boolean | string>
): { startAt: string | null; states: Record<string, Record<string, unknown>> } {
  const scopeNodeIds = getRetryScopeNodeIds(retryNodeId, scopeType, nodes, edges);
  if (scopeNodeIds.size === 0) return { startAt: null, states: {} };
  const startId = getRetryScopeStartNodeId(retryNodeId, scopeType, edges);
  if (!startId) return { startAt: null, states: {} };
  const scopeNodes = nodes.filter((n) => scopeNodeIds.has(n.id));
  const scopeEdges = edges.filter((e) => scopeNodeIds.has(e.from) && scopeNodeIds.has(e.to));
  const states = buildStateRecords(
    scopeNodes,
    scopeEdges,
    stateNameMap,
    containerPayloads,
    skillsetMap,
    undefined,
    undefined,
    inputValuesForConditions
  );
  const startAt = stateNameMap.get(startId) ?? null;
  return { startAt, states };
}
