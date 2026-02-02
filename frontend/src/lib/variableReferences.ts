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
 * Get all upstream node ids reachable from currentNodeId by following edges backward.
 * If current node is inside a container (repeat/parallel), the container has no incoming edge
 * from outside in the flat edges list, so we explicitly add the container and traverse from it.
 */
function getAllUpstreamNodeIds(
  currentNodeId: string,
  nodes: EditorNode[],
  edges: EditorEdge[]
): Set<string> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const current = nodeMap.get(currentNodeId);
  if (!current) return new Set();

  const incomingByTo = new Map<string, EditorEdge[]>();
  edges.forEach((edge) => {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) return;
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
  // Inside repeat/parallel there is no edge from container to first body node in the flat list
  if (current.containerId && !upstream.has(current.containerId)) {
    upstream.add(current.containerId);
    visit(current.containerId);
  }
  return upstream;
}

/**
 * Returns list of variable suggestions available for the given node (already executed = all upstream).
 * - Workflow Inputs: $.Inputs.<name> from the Input node's variableRows (if upstream)
 * - Upstream nodes: $.node_name.var_name for params and output keys (no .next, no input_node.output)
 * Repeat/Parallel inside can use variables from outer (upstream) nodes.
 */
export function getAvailableVariables(
  currentNodeId: string,
  nodes: EditorNode[],
  edges: EditorEdge[],
  stateNameMap: Map<string, string>,
  skillsetOutputsByKind: (kind: string) => SkillsetOutputs | undefined
): VariableSuggestion[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const upstreamIds = getAllUpstreamNodeIds(currentNodeId, nodes, edges);
  const suggestions: VariableSuggestion[] = [];

  // 1) $.Inputs.<name> from Input node's variableRows (no input_node.output)
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

  // 2) $.node_name.var_name for each upstream node: params + output keys (no .next, no input .output)
  upstreamIds.forEach((fromId) => {
    const fromNode = nodeMap.get(fromId);
    if (!fromNode) return;
    const stateName = stateNameMap.get(fromId);
    if (!stateName) return;

    if (fromNode.kind === "flow_control.input") {
      // Only $.Inputs.xxx above; do not suggest input_node.output
      return;
    }

    // Params: $.node_name.param_key (parameters are accessible)
    if (fromNode.params && typeof fromNode.params === "object") {
      Object.keys(fromNode.params).forEach((key) => {
        if (/^[A-Za-z0-9_]+$/.test(key)) {
          suggestions.push({
            path: `$.${stateName}.${key}`,
            type: "any",
            label: `${stateName}.${key} (param)`
          });
        }
      });
    }

    if (fromNode.kind.startsWith("skill.")) {
      const outputs = skillsetOutputsByKind(fromNode.kind);
      if (outputs && Object.keys(outputs).length > 0) {
        Object.entries(outputs).forEach(([key, info]) => {
          suggestions.push({
            path: `$.${stateName}.${key}`,
            type: info.type,
            label: `${stateName}.${key} (${info.type})`
          });
          suggestions.push({
            path: `$.${stateName}.output.${key}`,
            type: info.type,
            label: `${stateName}.output.${key} (${info.type})`
          });
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
      // No .next suggestions
    }
  });

  // Dedupe by path (e.g. param key and output key can be same)
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    if (seen.has(s.path)) return false;
    seen.add(s.path);
    return true;
  });
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
