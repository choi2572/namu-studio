/**
 * Build monitor graph from DSL: path-based node IDs, containers (Repeat/Parallel), edges.
 * Used by DagView for always-unfolded container frames and nested node status.
 */

import {
  nodePathId,
  NODE_PATH,
  rootPathId,
  repeatBodyPathId,
  parallelBranchPathId,
  pathIdToApiStateName
} from "@/lib/ids";

export type MonitorNode = {
  pathId: string;
  stateName: string;
  nodeName: string;
  apiStateName: string;
  containerPathId: string | null;
  isContainer: boolean;
  containerType: "repeat" | "parallel" | null;
  branchIndex: number | null;
  /** DSL State.Type (Skill, Condition, Repeat, Parallel, Wait 등) */
  dslType: string;
  /** Skill 노드일 때 DSL State.Skill (스킬 타입명, 예: PickObject) */
  skillName: string | null;
};

export type MonitorEdge = {
  id: string;
  from: string;
  to: string;
  /** Condition 노드에서 나가는 엣지일 때: Then(녹색) / Else(주황) 구분 */
  conditionBranch?: "then" | "else";
};

export type MonitorContainerRegion = {
  index: number;
  label: string;
  pathIds: string[];
};

export type MonitorContainer = {
  pathId: string;
  stateName: string;
  label: string;
  type: "repeat" | "parallel";
  branchCount: number;
  regions: MonitorContainerRegion[];
};

export type MonitorGraph = {
  nodes: MonitorNode[];
  edges: MonitorEdge[];
  containers: MonitorContainer[];
  stateNameToPathId: Map<string, string>;
};

type DslState = {
  Type?: string;
  Next?: string;
  End?: boolean;
  Label?: string;
  Skill?: string;
  Count?: number;
  If?: { Then?: string };
  Else?: string;
  Choices?: Array<{ Next?: string }>;
  Body?: { StartAt?: string; States?: Record<string, DslState> };
  Branches?: Array<{ StartAt?: string; States?: Record<string, DslState> }>;
};

function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}

function collectNodesAndEdges(
  states: Record<string, DslState>,
  pathPrefix: string[],
  containerPathId: string | null,
  containerType: "repeat" | "parallel" | null,
  branchIndex: number | null,
  nodes: MonitorNode[],
  edges: MonitorEdge[],
  edgeIdCounter: { current: number }
): void {
  const pathBase = pathPrefix.length > 0 ? pathPrefix[pathPrefix.length - 1] : NODE_PATH.ROOT;
  Object.entries(states).forEach(([stateName, state]) => {
    if (!isRecord(state)) return;
    const type = state.Type as string | undefined;
    const label = (state.Label as string) ?? stateName;
    const pathId = nodePathId([...pathPrefix, stateName]);
    const apiStateName = pathIdToApiStateName(pathId);
    const dslType = type ?? "Task";
    const skillName =
      dslType === "Skill" && typeof state.Skill === "string" ? state.Skill : null;

    nodes.push({
      pathId,
      stateName,
      nodeName: label,
      apiStateName,
      containerPathId,
      isContainer: type === "Repeat" || type === "Parallel",
      containerType: type === "Repeat" ? "repeat" : type === "Parallel" ? "parallel" : null,
      branchIndex,
      dslType,
      skillName
    });

    if (typeof state.Next === "string" && states[state.Next]) {
      const toPathId = nodePathId([...pathPrefix, state.Next]);
      edges.push({
        id: `edge-${edgeIdCounter.current++}`,
        from: pathId,
        to: toPathId
      });
    }

    if (type === "Condition") {
      const thenTarget = isRecord(state.If) && typeof state.If.Then === "string" ? state.If.Then : null;
      const elseTarget = typeof state.Else === "string" ? state.Else : null;
      if (thenTarget && Object.prototype.hasOwnProperty.call(states, thenTarget)) {
        const toPathId = nodePathId([...pathPrefix, thenTarget]);
        edges.push({
          id: `edge-${edgeIdCounter.current++}`,
          from: pathId,
          to: toPathId,
          conditionBranch: "then"
        });
      }
      if (elseTarget && Object.prototype.hasOwnProperty.call(states, elseTarget)) {
        const toPathId = nodePathId([...pathPrefix, elseTarget]);
        edges.push({
          id: `edge-${edgeIdCounter.current++}`,
          from: pathId,
          to: toPathId,
          conditionBranch: "else"
        });
      }
    }

    if ((type === "Choice" || type === "Condition") && Array.isArray(state.Choices)) {
      state.Choices.forEach((choice) => {
        const target = choice && typeof choice === "object" && "Next" in choice ? (choice as { Next?: string }).Next : undefined;
        if (typeof target === "string" && states[target]) {
          const toPathId = nodePathId([...pathPrefix, target]);
          edges.push({
            id: `edge-${edgeIdCounter.current++}`,
            from: pathId,
            to: toPathId
          });
        }
      });
    }

    if (type === "Repeat" && state.Body?.States && isRecord(state.Body.States)) {
      const bodyPathPrefix = [...pathPrefix, stateName, NODE_PATH.BODY];
      const repeatPathId = nodePathId([...pathPrefix, stateName]);
      collectNodesAndEdges(
        state.Body.States as Record<string, DslState>,
        bodyPathPrefix,
        repeatPathId,
        "repeat",
        null,
        nodes,
        edges,
        edgeIdCounter
      );
    }

    if (type === "Parallel" && Array.isArray(state.Branches)) {
      state.Branches.forEach((branch, index) => {
        const branchStates = branch?.States;
        if (!branchStates || !isRecord(branchStates)) return;
        const branchPathPrefix = [...pathPrefix, stateName, `${NODE_PATH.BRANCH_PREFIX}${index}`];
        const parallelPathId = nodePathId([...pathPrefix, stateName]);
        collectNodesAndEdges(
          branchStates as Record<string, DslState>,
          branchPathPrefix,
          parallelPathId,
          "parallel",
          index,
          nodes,
          edges,
          edgeIdCounter
        );
      });
    }
  });
}

function buildContainers(nodes: MonitorNode[]): MonitorContainer[] {
  const containers: MonitorContainer[] = [];
  const containerNodes = nodes.filter((n) => n.isContainer && n.containerType);
  containerNodes.forEach((node) => {
    if (!node.containerType) return;
    const children = nodes.filter((n) => n.containerPathId === node.pathId);
    if (node.containerType === "repeat") {
      const bodyPathIds = children.map((c) => c.pathId);
      containers.push({
        pathId: node.pathId,
        stateName: node.stateName,
        label: node.nodeName,
        type: "repeat",
        branchCount: 1,
        regions: [{ index: 0, label: "Body", pathIds: bodyPathIds }]
      });
    } else {
      const branchCount = Math.max(
        1,
        ...children.map((c) => (c.branchIndex ?? 0) + 1)
      );
      const regions: MonitorContainerRegion[] = Array.from({ length: branchCount }, (_, index) => ({
        index,
        label: `Branch ${index + 1}`,
        pathIds: children.filter((c) => (c.branchIndex ?? 0) === index).map((c) => c.pathId)
      }));
      containers.push({
        pathId: node.pathId,
        stateName: node.stateName,
        label: node.nodeName,
        type: "parallel",
        branchCount,
        regions
      });
    }
  });
  return containers;
}

/**
 * Build monitor graph from workflow DSL.
 * - Top-level states get pathId root/stateName.
 * - Repeat body states get root/repeatName/body/stateName.
 * - Parallel branch states get root/parallelName/branch:i/stateName.
 */
export function buildMonitorGraph(dslJson: Record<string, unknown> | null | undefined): MonitorGraph | null {
  if (!dslJson || !isRecord(dslJson)) return null;
  const states = (dslJson as { States?: Record<string, DslState> }).States;
  if (!states || !isRecord(states)) return null;

  const nodes: MonitorNode[] = [];
  const edges: MonitorEdge[] = [];
  const edgeIdCounter = { current: 0 };

  collectNodesAndEdges(
    states,
    [NODE_PATH.ROOT],
    null,
    null,
    null,
    nodes,
    edges,
    edgeIdCounter
  );

  const containers = buildContainers(nodes);
  const stateNameToPathId = new Map<string, string>();
  nodes.forEach((n) => {
    stateNameToPathId.set(n.apiStateName, n.pathId);
    if (n.containerPathId === null) {
      stateNameToPathId.set(n.stateName, n.pathId);
    }
  });

  return {
    nodes,
    edges,
    containers,
    stateNameToPathId
  };
}

export {
  rootPathId,
  repeatBodyPathId,
  parallelBranchPathId,
  pathIdToApiStateName
};
