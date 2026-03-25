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
  RepeatCount?: number;
  StartAt?: string;
  States?: Array<Record<string, DslState>>;
  // Condition DSL: If 블록 안/밖 모두 지원 (If.Then / If.Else 또는 루트 Else)
  If?: { Condition?: unknown; Then?: string; Else?: string };
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
    const rawType = type ?? "Task";
    const typeLc = rawType.toLowerCase();
    const dslType = typeLc === "skill" ? "Skill" : rawType;
    const skillName =
      typeLc === "skill" && typeof state.Skill === "string" ? state.Skill : null;

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
      const thenTarget =
        isRecord(state.If) && typeof state.If.Then === "string" ? state.If.Then : null;
      const elseFromIf =
        isRecord(state.If) && typeof state.If.Else === "string" ? state.If.Else : null;
      const elseFromRoot = typeof state.Else === "string" ? state.Else : null;
      const elseTarget = elseFromIf ?? elseFromRoot;

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

    if (type === "Repeat") {
      let bodyStates: Record<string, DslState> | undefined;
      if (Array.isArray(state.States)) {
        bodyStates = {};
        for (const item of state.States) {
          if (isRecord(item)) {
            Object.assign(bodyStates, item as Record<string, DslState>);
          }
        }
      } else if (state.Body?.States && isRecord(state.Body.States)) {
        bodyStates = state.Body.States as Record<string, DslState>;
      }
      if (bodyStates && Object.keys(bodyStates).length > 0) {
        const bodyPathPrefix = [...pathPrefix, stateName, NODE_PATH.BODY];
        const repeatPathId = nodePathId([...pathPrefix, stateName]);
        collectNodesAndEdges(
          bodyStates,
          bodyPathPrefix,
          repeatPathId,
          "repeat",
          null,
          nodes,
          edges,
          edgeIdCounter
        );
      }
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
      const branchIndexFromPathId = (pathId: string): number => {
        const segments = pathId.split("/").filter(Boolean);
        const branchSeg = segments.find((s) => s.startsWith("branch:"));
        if (!branchSeg) return 0;
        const num = parseInt(branchSeg.replace("branch:", ""), 10);
        return Number.isFinite(num) ? num : 0;
      };
      const byBranch = new Map<number, string[]>();
      children.forEach((c) => {
        const idx = c.branchIndex ?? branchIndexFromPathId(c.pathId);
        const list = byBranch.get(idx) ?? [];
        list.push(c.pathId);
        byBranch.set(idx, list);
      });
      const branchIndices = Array.from(byBranch.keys()).sort((a, b) => a - b);
      const branchCount = Math.max(1, ...branchIndices.map((i) => i + 1));
      const regions: MonitorContainerRegion[] = Array.from({ length: branchCount }, (_, index) => ({
        index,
        label: `Branch ${index + 1}`,
        pathIds: byBranch.get(index) ?? []
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

/** Flat edges for DagView when not using monitorGraph-internal edges only (matches MonitorPage DSL extraction). */
export type MonitorDslEdge = { id: string; from: string; to: string };

export function extractMonitorEdgesFromDsl(
  dslJson: Record<string, unknown> | null | undefined
): MonitorDslEdge[] {
  if (!dslJson || !isRecord(dslJson)) return [];

  const dsl = dslJson as {
    States?: Record<
      string,
      {
        Next?: string;
        Choices?: Array<{ Next?: string }>;
        End?: boolean;
        Type?: string;
      }
    >;
  };

  if (!dsl.States) return [];

  const edgeMap = new Map<string, { from: string; to: string }>();
  let edgeIndex = 0;

  Object.entries(dsl.States).forEach(([stateName, state]) => {
    if (!isRecord(state)) return;
    if (state.Next && typeof state.Next === "string") {
      const edgeKey = `${stateName}-${state.Next}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, { from: stateName, to: state.Next });
      }
    }
    if (state.Choices && Array.isArray(state.Choices)) {
      state.Choices.forEach((choice) => {
        if (typeof choice === "object" && choice !== null && "Next" in choice) {
          const c = choice as { Next?: string };
          if (c.Next && typeof c.Next === "string") {
            const edgeKey = `${stateName}-${c.Next}`;
            if (!edgeMap.has(edgeKey)) {
              edgeMap.set(edgeKey, { from: stateName, to: c.Next });
            }
          }
        }
      });
    }
    if (state.Type === "Condition" && state.Next && typeof state.Next === "string") {
      const edgeKey = `${stateName}-${state.Next}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, { from: stateName, to: state.Next });
      }
    }
  });

  return Array.from(edgeMap.values()).map((edge) => ({
    id: `edge-${edgeIndex++}`,
    from: edge.from,
    to: edge.to
  }));
}

/** VLM graph_patch payload (from RunEvent GRAPH_PATCH). */
export type GraphPatchPayload = {
  target?: { container_path?: string };
  nodes_added?: Array<{
    node_name: string;
    node_type?: string;
    skill?: string;
    ui?: { x?: number; y?: number };
    parameters?: Record<string, unknown>;
  }>;
  edges_added?: Array<{ from: string; to: string; label?: string }>;
  /** Optional replanning: remove these node names from the container before applying nodes_added/edges_added. */
  nodes_removed?: string[];
  start_at?: string;
  rev?: number;
};

/**
 * Apply graph_patch payloads in order to a base monitor graph (append-only).
 * Used when ENABLE_DYNAMIC_GRAPH_PATCH is on. Creates synthetic container and nodes under target container_path.
 * If baseGraph is null but there are payloads, builds a graph from patches only (so DAG can show dynamic nodes).
 */
export function applyGraphPatches(
  baseGraph: MonitorGraph | null,
  patchPayloads: GraphPatchPayload[]
): MonitorGraph | null {
  if (patchPayloads.length === 0) return baseGraph;

  const nodes = baseGraph ? [...baseGraph.nodes] : [];
  const edges = baseGraph ? [...baseGraph.edges] : [];
  let edgeIdCounter = Math.max(0, ...edges.map((e) => parseInt(e.id.replace(/\D/g, ""), 10) || 0));

  const pathIdsByStateName = new Map<string, string>();
  nodes.forEach((n) => {
    pathIdsByStateName.set(n.apiStateName, n.pathId);
    if (n.containerPathId === null) pathIdsByStateName.set(n.stateName, n.pathId);
  });

  function resolvePathId(nodeName: string, containerPath: string): string {
    const underContainer = `${containerPath}/${nodeName}`;
    if (nodes.some((n) => n.pathId === underContainer)) return underContainer;
    return pathIdsByStateName.get(nodeName) ?? nodePathId([NODE_PATH.ROOT, nodeName]);
  }

  for (const payload of patchPayloads) {
    const containerPath = payload.target?.container_path ?? "root/VLMPlanner_1/generated";
    const segments = containerPath.split("/").filter(Boolean);
    const vlmNodeName = segments.length >= 2 ? segments[1] : "VLMPlanner_1";
    const parentPathId = nodePathId([NODE_PATH.ROOT, vlmNodeName]);

    // Replanning: remove nodes (and incident edges) before applying additions
    const toRemove = payload.nodes_removed ?? [];
    if (toRemove.length > 0) {
      const pathIdsToRemove = new Set(
        toRemove.map((name) => `${containerPath}/${name}`)
      );
      const filteredNodes = nodes.filter((n) => !pathIdsToRemove.has(n.pathId));
      nodes.length = 0;
      nodes.push(...filteredNodes);
      edges.splice(
        0,
        edges.length,
        ...edges.filter(
          (e) =>
            !pathIdsToRemove.has(e.from) && !pathIdsToRemove.has(e.to)
        )
      );
      pathIdsByStateName.clear();
      nodes.forEach((n) => {
        pathIdsByStateName.set(n.apiStateName, n.pathId);
        if (n.containerPathId === null)
          pathIdsByStateName.set(n.stateName, n.pathId);
      });
    }

    const existingParent = nodes.find((n) => n.pathId === parentPathId);
    if (!existingParent) {
      nodes.push({
        pathId: parentPathId,
        stateName: vlmNodeName,
        nodeName: "VLM Planner",
        apiStateName: vlmNodeName,
        containerPathId: null,
        isContainer: true,
        containerType: "repeat",
        branchIndex: null,
        dslType: "Repeat",
        skillName: null
      });
    } else if (!existingParent.isContainer && (payload.nodes_added?.length ?? 0) > 0) {
      // Base graph had this as Pass (non-container); upgrade to container so generated children render
      existingParent.isContainer = true;
      existingParent.containerType = "repeat";
      existingParent.nodeName = "VLM Planner";
      existingParent.dslType = "Repeat";
    }

    for (const na of payload.nodes_added ?? []) {
      const pathId = `${containerPath}/${na.node_name}`;
      if (nodes.some((n) => n.pathId === pathId)) continue;
      pathIdsByStateName.set(na.node_name, pathId);
      nodes.push({
        pathId,
        stateName: na.node_name,
        nodeName: na.node_name,
        apiStateName: na.node_name,
        containerPathId: parentPathId,
        isContainer: false,
        containerType: null,
        branchIndex: null,
        dslType: na.node_type ?? "Skill",
        skillName: na.skill ?? null
      });
    }

    for (const ea of payload.edges_added ?? []) {
      const fromPathId = resolvePathId(ea.from, containerPath);
      const toPathId = resolvePathId(ea.to, containerPath);
      if (!nodes.some((n) => n.pathId === fromPathId) || !nodes.some((n) => n.pathId === toPathId)) continue;
      if (edges.some((e) => e.from === fromPathId && e.to === toPathId)) continue;
      edges.push({
        id: `edge-${++edgeIdCounter}`,
        from: fromPathId,
        to: toPathId
      });
    }
  }

  const containers = buildContainers(nodes);
  const stateNameToPathId = new Map<string, string>();
  nodes.forEach((n) => {
    stateNameToPathId.set(n.apiStateName, n.pathId);
    if (n.containerPathId === null) stateNameToPathId.set(n.stateName, n.pathId);
  });

  return { nodes, edges, containers, stateNameToPathId };
}

export {
  rootPathId,
  repeatBodyPathId,
  parallelBranchPathId,
  pathIdToApiStateName
};
