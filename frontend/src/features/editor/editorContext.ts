import type { NodeKind, NodeTypeConfig } from "@/features/editor/editorTypes";

export type EditorContext =
  | { kind: "root"; label: string }
  | { kind: "parallel"; nodeId: string; label: string }
  | { kind: "branch"; nodeId: string; branchIndex: number; label: string }
  | { kind: "repeat"; nodeId: string; label: string };

export type GraphPathSegment =
  | { kind: "parallelBranch"; nodeId: string; branchIndex: number }
  | { kind: "repeatBody"; nodeId: string };

export type GraphRef = {
  path: GraphPathSegment[];
};

export type EditorScope = "root" | "repeat" | "parallelBranch" | "parallelOverview";

const WAIT_NODE_KINDS = new Set<NodeKind>([
  "flow_control.wait" as NodeKind,
  "event.wait" as NodeKind
]);

export function formatWorkflowLabel(name: string) {
  const trimmed = name.trim();
  return `Workflow ${trimmed || "Untitled"}`;
}

export function formatParallelLabel(name: string) {
  return `Parallel:${name}`;
}

export function formatRepeatLabel(name: string) {
  return `Repeat:${name}`;
}

export function formatBranchLabel(index: number) {
  return `Branch:${index + 1}`;
}

export function createRootContext(name: string): EditorContext {
  return { kind: "root", label: formatWorkflowLabel(name) };
}

export function createParallelContext(nodeId: string, nodeName: string): EditorContext {
  return { kind: "parallel", nodeId, label: formatParallelLabel(nodeName) };
}

export function createBranchContext(
  nodeId: string,
  branchIndex: number
): EditorContext {
  return {
    kind: "branch",
    nodeId,
    branchIndex,
    label: formatBranchLabel(branchIndex)
  };
}

export function createRepeatContext(nodeId: string, nodeName: string): EditorContext {
  return { kind: "repeat", nodeId, label: formatRepeatLabel(nodeName) };
}

export function pushRepeatContext(
  stack: EditorContext[],
  nodeId: string,
  nodeName: string
): EditorContext[] {
  return [...stack, createRepeatContext(nodeId, nodeName)];
}

export function pushParallelBranchContext(
  stack: EditorContext[],
  nodeId: string,
  nodeName: string,
  branchIndex: number
): EditorContext[] {
  return [
    ...stack,
    createParallelContext(nodeId, nodeName),
    createBranchContext(nodeId, branchIndex)
  ];
}

export function popContext(stack: EditorContext[]): EditorContext[] {
  if (stack.length <= 1) return stack;
  return stack.slice(0, -1);
}

export function navigateToContextIndex(
  stack: EditorContext[],
  index: number
): EditorContext[] {
  if (index < 0) return stack;
  return stack.slice(0, Math.min(stack.length, index + 1));
}

export function buildGraphRef(stack: EditorContext[]): GraphRef {
  const path: GraphPathSegment[] = [];
  stack.forEach((context) => {
    if (context.kind === "branch") {
      path.push({
        kind: "parallelBranch",
        nodeId: context.nodeId,
        branchIndex: context.branchIndex
      });
    }
    if (context.kind === "repeat") {
      path.push({ kind: "repeatBody", nodeId: context.nodeId });
    }
  });
  return { path };
}

export function getEditorScope(stack: EditorContext[]): EditorScope {
  if (stack.length === 0) return "root";
  const last = stack[stack.length - 1];
  if (last.kind === "parallel") return "parallelOverview";
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const context = stack[i];
    if (context.kind === "repeat") return "repeat";
    if (context.kind === "branch") return "parallelBranch";
  }
  return "root";
}

export function getAllowedNodeKinds(
  stack: EditorContext[],
  nodeTypes: NodeKind[],
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>
): NodeKind[] {
  const scope = getEditorScope(stack);
  if (scope === "root") return nodeTypes;
  if (scope === "parallelOverview") return [];
  if (scope === "repeat") {
    return nodeTypes.filter((kind) => nodeTypeConfig[kind]?.category === "skill");
  }
  if (scope === "parallelBranch") {
    return nodeTypes.filter((kind) => {
      const config = nodeTypeConfig[kind];
      if (config?.category === "skill") return true;
      return WAIT_NODE_KINDS.has(kind);
    });
  }
  return nodeTypes;
}
