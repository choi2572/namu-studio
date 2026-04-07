import type { FailureHandlingGraph } from "./editorTypes";
import { FAILURE_CANVAS_BASE, NODE_METRICS } from "./editorConstants";

export function createInitialFailureGraph(enabled: boolean): FailureHandlingGraph {
  const entryId = "failure-entry-1";
  return {
    enabled,
    drawerOpen: false,
    entryNodeId: entryId,
    nodes: [
      {
        id: entryId,
        name: "On Workflow Failure",
        kind: "system.on_failure_entry",
        position: {
          x: FAILURE_CANVAS_BASE.width / 2 - NODE_METRICS.width / 2,
          y: 40
        },
        isExpanded: true,
        params: {}
      }
    ],
    edges: []
  };
}
