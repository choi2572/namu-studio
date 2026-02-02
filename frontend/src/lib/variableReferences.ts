/**
 * Scope-aware variable reference helpers for the Workflow Editor.
 * Supports JSONPath-like syntax: $.Inputs.foo, $.NodeA.output.bar
 */

export type VariableSuggestion = {
  path: string;
  type?: string;
  label?: string;
};

export type EditorNode = {
  id: string;
  name: string;
  kind: string;
  params: Record<string, string>;
  containerId?: string | null;
  containerType?: string | null;
  branchIndex?: number | null;
  variableRows?: Array< { id: string; name: string; value: string; valueType: string } >;
};

export type EditorEdge = {
  id: string;
  from: string;
  fromPort: string;
  to: string;
};

export type SkillsetOutputs = Record<string, { type: string; description?: string }>;

function getContainerKey(
  node: EditorNode,
  containerTypeById: Map<string, string>
): string | null {
  const containerId = node.containerId;
  if (!containerId) return null;
  const containerType = node.containerType ?? containerTypeById.get(containerId);
  if (!containerType) return null;
  if (containerType === "parallel") {
    const branchIndex = node.branchIndex ?? 0;
    return `${containerId}:branch:${branchIndex}`;
  }
  return `${containerId}:body`;
}

function getContainerTypeFromKind(kind: string): string | null {
  if (kind === "flow_control.repeat") return "repeat";
  if (kind === "flow_control.parallel") return "parallel";
  return null;
}

/**
 * Build a map of node id -> DSL state name (used in $.StateName).
 */
export function buildStateNameMap(nodes: EditorNode[]): Map<string, string> {
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

/**
 * Get all upstream node ids reachable from currentNodeId by following edges backward,
 * within the same scope (same container or both top-level).
 */
function getUpstreamNodeIdsInScope(
  currentNodeId: string,
  nodes: EditorNode[],
  edges: EditorEdge[]
): Set<string> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const current = nodeMap.get(currentNodeId);
  if (!current) return new Set();

  const containerTypeById = new Map<string, string>();
  nodes.forEach((node) => {
    const type = getContainerTypeFromKind(node.kind);
    if (type) containerTypeById.set(node.id, type);
  });

  const currentKey = getContainerKey(current, containerTypeById);
  const inSameScope = (node: EditorNode) =>
    getContainerKey(node, containerTypeById) === currentKey;

  const incomingByTo = new Map<string, EditorEdge[]>();
  edges.forEach((edge) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode || !inSameScope(fromNode) || !inSameScope(toNode)) return;
    const list = incomingByTo.get(edge.to) ?? [];
    list.push(edge);
    incomingByTo.set(edge.to, list);
  });

  const upstream = new Set<string>();
  const visit = (nodeId: string) => {
    const inEdges = incomingByTo.get(nodeId) ?? [];
    inEdges.forEach((e) => {
      if (!upstream.has(e.from)) {
        upstream.add(e.from);
        visit(e.from);
      }
    });
  };
  visit(currentNodeId);
  return upstream;
}

/**
 * Returns list of variable suggestions available for the given node:
 * - Workflow Inputs: $.Inputs.<name> from the Input node's variableRows (if upstream)
 * - Upstream node outputs: $.StateName.output.<key> for each upstream node
 * Respects Repeat/Parallel scope (only same container or root).
 */
export function getAvailableVariables(
  currentNodeId: string,
  nodes: EditorNode[],
  edges: EditorEdge[],
  stateNameMap: Map<string, string>,
  skillsetOutputsByKind: (kind: string) => SkillsetOutputs | undefined
): VariableSuggestion[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const upstreamIds = getUpstreamNodeIdsInScope(currentNodeId, nodes, edges);
  const suggestions: VariableSuggestion[] = [];

  // 1) $.Inputs.<name> from Input node's variableRows
  const inputNode = nodes.find((n) => n.kind === "flow_control.input");
  if (inputNode && upstreamIds.has(inputNode.id)) {
    const rows = inputNode.variableRows ?? [];
    rows.forEach((row) => {
      const name = (row.name || "").trim();
      if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        suggestions.push({
          path: `$.Inputs.${name}`,
          type: row.valueType,
          label: `Input: ${name}`
        });
      }
    });
  }

  // 2) $.StateName.output.<key> for each upstream node
  upstreamIds.forEach((fromId) => {
    const fromNode = nodeMap.get(fromId);
    if (!fromNode) return;
    const stateName = stateNameMap.get(fromId);
    if (!stateName) return;

    if (fromNode.kind === "flow_control.input") {
      suggestions.push({
        path: `$.${stateName}.output`,
        type: "object",
        label: `Output: ${fromNode.name}`
      });
      return;
    }

    if (fromNode.kind.startsWith("skill.")) {
      const outputs = skillsetOutputsByKind(fromNode.kind);
      if (outputs && Object.keys(outputs).length > 0) {
        Object.entries(outputs).forEach(([key, info]) => {
          suggestions.push({
            path: `$.${stateName}.output.${key}`,
            type: info.type,
            label: `${stateName}.${key} (${info.type})`
          });
        });
      } else {
        suggestions.push({
          path: `$.${stateName}.output.next`,
          type: "any",
          label: `Output: ${stateName}`
        });
      }
      return;
    }

    if (
      fromNode.kind === "flow_control.condition" ||
      fromNode.kind === "flow_control.repeat" ||
      fromNode.kind === "flow_control.parallel" ||
      fromNode.kind === "event.webhook"
    ) {
      suggestions.push({
        path: `$.${stateName}.output.next`,
        type: "any",
        label: `Output: ${stateName}`
      });
    }
  });

  return suggestions;
}

/**
 * Filter suggestions by the fragment user typed after `$`.
 * e.g. filter "Inp" matches $.Inputs.foo; filter "NodeA.out" matches $.NodeA.output.score
 */
export function filterVariableSuggestions(
  suggestions: VariableSuggestion[],
  filter: string
): VariableSuggestion[] {
  const lower = filter.toLowerCase().replace(/^\$\.?/, "");
  if (!lower) return suggestions;
  return suggestions.filter(
    (s) =>
      s.path.toLowerCase().replace(/^\$\.?/, "").startsWith(lower) ||
      s.path.toLowerCase().includes(lower)
  );
}

/**
 * Validate a value: if it looks like a variable reference (starts with $),
 * check it is a valid path and in scope (exists in available paths).
 */
export function validateVariablePath(
  value: string,
  availablePaths: string[]
): { valid: boolean; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true };
  if (!trimmed.startsWith("$")) return { valid: true };

  const pathSet = new Set(availablePaths);
  if (pathSet.has(trimmed)) return { valid: true };

  const normalized = trimmed.replace(/^\$\.?/, "$.");
  if (pathSet.has(normalized)) return { valid: true };

  const prefixMatch = availablePaths.some(
    (p) => p === trimmed || p.startsWith(trimmed + ".") || trimmed.startsWith(p + ".")
  );
  if (prefixMatch) return { valid: true };

  if (!/^\$\.([A-Za-z0-9_]+\.?)+$/.test(trimmed)) {
    return { valid: false, error: "Invalid variable path (use $.Inputs.name or $.NodeName.output.key)" };
  }

  return {
    valid: false,
    error: "Variable not in scope. Use $ to see available variables."
  };
}
