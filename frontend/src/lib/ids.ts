let counter = 0;

export function createId(prefix: string) {
  counter += 1;
  return `${prefix}-${counter.toString().padStart(3, "0")}`;
}

// --- Path-based node IDs (editor + monitor + timeline) ---
export const NODE_PATH = {
  ROOT: "root",
  BODY: "body",
  BRANCH_PREFIX: "branch:"
} as const;

/**
 * Build a deterministic node ID from DSL path segments.
 * Examples: ["root", "NodeA"] -> "root/NodeA"
 *           ["root", "Repeat1", "body", "NodeX"] -> "root/Repeat1/body/NodeX"
 *           ["root", "Parallel1", "branch:0", "NodeY"] -> "root/Parallel1/branch:0/NodeY"
 */
export function nodePathId(segments: string[]): string {
  return segments.filter(Boolean).join("/");
}

/**
 * Parse a path-based node ID back into segments.
 */
export function parsePathId(pathId: string): string[] {
  if (!pathId) return [];
  return pathId.split("/").filter(Boolean);
}

/**
 * Top-level node path ID (root/stateName).
 */
export function rootPathId(stateName: string): string {
  return nodePathId([NODE_PATH.ROOT, stateName]);
}

/**
 * Repeat body node path ID (root/repeatStateName/body/stateName).
 */
export function repeatBodyPathId(repeatStateName: string, stateName: string): string {
  return nodePathId([NODE_PATH.ROOT, repeatStateName, NODE_PATH.BODY, stateName]);
}

/**
 * Parallel branch node path ID (root/parallelStateName/branch:i/stateName).
 */
export function parallelBranchPathId(parallelStateName: string, branchIndex: number, stateName: string): string {
  return nodePathId([
    NODE_PATH.ROOT,
    parallelStateName,
    `${NODE_PATH.BRANCH_PREFIX}${branchIndex}`,
    stateName
  ]);
}

/**
 * API stateName used for getNodeDebug(runId, stateName).
 * Top-level: stateName; nested: full pathId so backend can support path-based lookup later.
 */
export function pathIdToApiStateName(pathId: string): string {
  const segments = parsePathId(pathId);
  if (segments.length <= 2 && segments[0] === NODE_PATH.ROOT) {
    return segments[1] ?? pathId;
  }
  return pathId;
}
