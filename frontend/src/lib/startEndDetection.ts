/**
 * Scope-aware Start/End detection for workflow editor DAGs.
 * Used by the editor to show START/END badges and validate exactly-one-Start per scope.
 */

export type ScopeGraph = {
  nodeIds: string[];
  edges: Array<{ from: string; to: string }>;
};

export type StartEndResult = {
  /** Exactly one if valid; null if zero or multiple (see startError). */
  startNodeId: string | null;
  /** Set when scope has zero or more than one Start candidate. */
  startError?: string;
  /** When startError is set, IDs of nodes that are start candidates (for warning badges). */
  startCandidateIds: string[];
  /** Node IDs with no outgoing edges in this scope (terminal/End nodes). */
  endNodeIds: string[];
};

/**
 * Compute Start and End nodes for a single scope (root workflow, Repeat body, or Parallel branch).
 * - Start: node with zero incoming edges within the scope. Exactly one required.
 * - End: nodes with no outgoing edges within the scope.
 */
export function computeStartEndForScope(scopeGraph: ScopeGraph): StartEndResult {
  const { nodeIds, edges } = scopeGraph;
  const nodeIdSet = new Set(nodeIds);
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, Set<string>>();

  nodeIds.forEach((id) => {
    incoming.set(id, 0);
    outgoing.set(id, new Set());
  });

  edges.forEach(({ from, to }) => {
    if (!nodeIdSet.has(from) || !nodeIdSet.has(to)) return;
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
    outgoing.get(from)?.add(to);
  });

  const startCandidates = nodeIds.filter((id) => (incoming.get(id) ?? 0) === 0);
  const endNodeIds = nodeIds.filter((id) => (outgoing.get(id)?.size ?? 0) === 0);

  if (startCandidates.length === 0) {
    return {
      startNodeId: null,
      startError: "No start node (no node with zero incoming edges).",
      startCandidateIds: [],
      endNodeIds
    };
  }
  if (startCandidates.length > 1) {
    return {
      startNodeId: null,
      startError: `Multiple start nodes (${startCandidates.length} nodes with zero incoming edges).`,
      startCandidateIds: startCandidates,
      endNodeIds
    };
  }

  return {
    startNodeId: startCandidates[0],
    startCandidateIds: [],
    endNodeIds
  };
}
