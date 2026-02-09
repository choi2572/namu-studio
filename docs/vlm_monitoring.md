# VLM Dynamic Workflow Monitoring Extension

This document defines the extension to the existing Workflow Monitoring WebSocket protocol to support VLM-driven dynamic workflow generation during execution.

All existing event types (`initial`, `node_status_change`, `feedback`, `workflow_completed`, `error`) remain unchanged.

This extension is focused on **monitoring and replay**, not execution control.

---

---

## Goals

* Visualize VLM-generated workflow steps in real time in the Run Monitor UI.
* Persist dynamic graph mutations for replay.
* Allow future export of generated subflows into the Editor.
* Preserve backward compatibility with existing monitoring flows.

---

---

## Design Principles

1. **Append-only mutations**

   * VLM may only add new nodes and edges during a run.
   * Existing graph structure must not be modified in M1.

2. **Scoped generation**

   * All VLM-generated nodes must be attached inside a dedicated container owned by the VLM node.

3. **Replayability**

   * All dynamic changes are stored as events and replayed deterministically.

4. **Editor-compatible**

   * Generated nodes must be convertible to DSL fragments in the future.

---

---

## Generated Subflow Container

Each VLM node owns a reserved runtime container:

```
root/<VLMNodeName>/generated
```

Dynamic nodes MUST be appended under this container.

---

---

## New Event Type: graph_patch

A new WebSocket event emitted by middleware whenever a VLM node generates workflow steps during execution.

---

### Payload

```json
{
  "type": "graph_patch",
  "workflow_id": "wf_xxxxxxxxx",
  "timestamp": 1700000100,
  "rev": 1,
  "target": {
    "container_path": "root/VLMPlanner_1/generated"
  },
  "nodes_added": [
    {
      "node_name": "PickBolt_1",
      "node_type": "Skill",
      "skill": "Pick",
      "ui": { "x": 120, "y": 260 },
      "parameters": {
        "target": "$.Inputs.bolt"
      }
    }
  ],
  "edges_added": [
    {
      "from": "PickBolt_1",
      "to": "PlaceBinA_1",
      "label": ""
    }
  ],
  "start_at": "PickBolt_1"
}
```

---

---

## Graph Patch Rules

### Append-only

* Only node/edge additions allowed.
* No deletion or modification in M1.

---

### Ordering

* `rev` MUST be strictly increasing.
* Monitor must apply patches in order.
* Status events for newly added nodes MUST be sent after the corresponding patch.

---

### Node Identity

* `node_name` must be unique inside the workflow.
* Existing status routing logic must continue to work unchanged.

---

### Scope Restriction

* `container_path` always points to:

```
root/<VLMNodeName>/generated
```

---

---

## Monitoring UI Behavior

When enabled:

* Monitor applies graph_patch events to its local graph cache.
* Newly added nodes appear visually inside the VLM container frame.
* Highlighting and debug panels work identically to static nodes.

---

---

## Replay Requirements

Backend must persist:

* graph_patch events
* node status changes
* feedback events

Replay reconstructs runtime graphs by replaying patches before applying later state changes.

---

---

## Future Export Path (Not Implemented)

Generated subflows may later be exported into the Editor as draft workflows.

This requires:

* graph_patch patches convertible into DSL fragments
* stable node identifiers
* preserved container boundaries

---

---

## Feature Flags

| Flag                       | Component       | Default | Purpose                  |
| -------------------------- | --------------- | ------- | ------------------------ |
| ENABLE_DYNAMIC_GRAPH_PATCH | Frontend        | OFF     | Apply graph_patch events |
| ENABLE_VLM_NODES           | Frontend        | OFF     | Show VLM node in palette |
| MOCK_VLM_DYNAMIC_PATCH     | Middleware mock | OFF     | Emit graph_patch events  |

---

---

## Summary

This extension introduces dynamic workflow visualization for VLM planning without affecting existing execution flows.

It enables:

* real-time monitoring of generated plans,
* deterministic replay,
* and future editor round-tripping.