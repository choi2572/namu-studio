# 🗄️ Data Model (v0)

> This document defines the backend’s **persistent data model** for M1.  
> Backend is the Source of Truth for workflow definitions, run state, node state, and history.  
>  
> This model must comply with `00_system_rules.md`.

---

## 0. Design Goals

- Persist enough information to support:
  - Workflow editor load/save/publish
  - Live monitoring (polling-based)
  - Node-level debugging (input/output/state/feedback)
  - Replay of historical runs (timeline event list)
  - Run history list view (global)
- Keep M1 minimal:
  - No nested workflows
  - No loop/cycle
  - Parallel is 2-branch only (Split + Join or one Parallel state in DSL)
- Prefer **append-only events** for history + **current snapshot** for fast UI.

---

## 1. Entity Overview

### Primary Entities
- **Workflow**
- **WorkflowVersion**
- **WorkflowView** (layout metadata)
- **Run**
- **NodeRun** (per node execution record)
- **RunEvent** (timeline entries)
- **ExternalEvent** (webhook/ROS ingress, optional but recommended)

### High-Level Relationships
- Workflow `1 → N` WorkflowVersion
- WorkflowVersion `1 → 0..N` Run
- Run `1 → N` NodeRun
- Run `1 → N` RunEvent
- ExternalEvent `0..N → 0..1` Run (correlated) and `0..1` NodeRun (correlated)

---

## 2. Enumerations (Conceptual)

### WorkflowState
- `DRAFT`
- `PUBLISHED`

### VersionState
- `DRAFT`
- `PUBLISHED` (immutable)

### RunStatus
- `CREATED`
- `RUNNING`
- `WAITING`
- `SUCCESS`
- `FAILED`
- `CANCELED`

### NodeStatus
- `READY` *(optional in M1; can be omitted)*
- `RUNNING`
- `WAITING`
- `SUCCEEDED`
- `FAILED`
- `SKIPPED`
- `CANCELED`

### TriggerType (optional but useful)
- `MANUAL`
- `SCHEDULE`
- `EVENT`

---

## 3. Workflow

### Workflow
Represents a named container for versions.

**Fields (recommended)**
- `workflow_id` (PK, string/uuid)
- `name`
- `description` (optional)
- `state` (WorkflowState)
- `current_published_version_id` (nullable)
- `created_at`
- `updated_at`

**Notes**
- `state=DRAFT` means no published version exists yet, or workflow is not currently publishable.

---

## 4. Workflow Version

### WorkflowVersion
Immutable when published. Stores the DSL definition.

**Fields**
- `version_id` (PK)
- `workflow_id` (FK)
- `version_number` (integer or string)
- `state` (VersionState)
- `dsl_json` (TEXT / JSON)
- `created_at`
- `published_at` (nullable)

**Invariants**
- If `state=PUBLISHED` then `dsl_json` must never change.

---

## 5. Workflow View (Editor Layout)

### WorkflowView
Stores UI-only layout metadata for a workflow version.

**Fields**
- `version_id` (PK/FK to WorkflowVersion)
- `view_json` (node positions, zoom, pan, optional groupings)
- `created_at`
- `updated_at`

**Notes**
- Separating `dsl_json` and `view_json` avoids contaminating execution definition with UI layout.

---

## 6. Run (Execution Instance)

### Run
Represents a single execution attempt of a workflow version.

**Fields**
- `run_id` (PK)
- `workflow_id` (FK)
- `version_id` (FK to WorkflowVersion)
- `trigger_type` (TriggerType, optional)
- `trigger_meta_json` (optional: user, source, etc.)
- `run_input_json` (parameters at start)
- `status` (RunStatus)
- `failure_code` (nullable)
- `failure_message` (nullable)
- `started_at` (nullable until RUNNING)
- `finished_at` (nullable)
- `created_at`
- `updated_at`

**Derived**
- `duration_ms = finished_at - started_at` (if finished)

**Invariants**
- A Run references exactly one WorkflowVersion.
- Run status transitions are monotonic (cannot go backward).

---

## 7. NodeRun (Per Node Execution Record)

### NodeRun
Stores node-level execution and debug payloads. This is the backbone of monitoring + replay.

**Key**
- In M1, node identity is `state_name` from DSL.
- NodeRun is uniquely identified by `(run_id, state_name, attempt)`.

**Fields**
- `node_run_id` (PK) *(or composite PK)*
- `run_id` (FK)
- `state_name` (string; DSL state name)
- `node_type` (string: skill/condition/wait/parallel/...)
- `attempt` (int, default 1)
- `status` (NodeStatus)
- `started_at` (nullable)
- `finished_at` (nullable)
- `duration_ms` (nullable)

**Debug Payloads (stored as JSON blobs)**
- `input_json` (nullable)
- `output_json` (nullable)
- `state_snapshot_json` (nullable)  
  - internal state needed for debugging (middleware-provided)
- `feedback_json` (nullable)  
  - includes errors, decision info, wait specs, etc.
- `decision_json` (nullable)  
  - recommended for Condition/Parallel summary
  - can be embedded in `feedback_json` if you prefer one blob

**Special Cases**
- Condition Node:
  - `decision_json` stores expression + result + selected branch
- Event Wait Node:
  - `feedback_json` or `state_snapshot_json` stores wait spec (what it is waiting for)
- Parallel:
  - Branch node runs are just normal NodeRuns with state_name namespaced if needed
  - Join node stores join summary

**Invariants**
- NodeRun payloads are append-only in meaning:
  - once SUCCEEDED/FAILED/SKIPPED/CANCELED, it should not revert.

---

## 8. RunEvent (Timeline for Replay)

### RunEvent
Append-only ordered events used to render the bottom timeline and replay.

**Fields**
- `event_id` (PK)
- `run_id` (FK)
- `seq` (monotonic per run) *(recommended)*
- `timestamp`
- `event_type` (string enum)
- `state_name` (nullable)  *(node-related events populate this)*
- `payload_json` (optional; small payload)
- `created_at`

**Recommended Event Types**
- Run-level:
  - `RUN_CREATED`
  - `RUN_STARTED`
  - `RUN_STATUS_CHANGED`
  - `RUN_SUCCEEDED`
  - `RUN_FAILED`
  - `RUN_CANCELED`
- Node-level:
  - `NODE_STARTED`
  - `NODE_WAITING`
  - `NODE_SUCCEEDED`
  - `NODE_FAILED`
  - `NODE_SKIPPED`
  - `NODE_CANCELED`
- External / safety:
  - `EXTERNAL_EVENT_RECEIVED`
  - `SAFETY_INTERRUPT`

**Notes**
- Timeline UI is **event list**, not a time-graph in M1.

---

## 9. ExternalEvent (Ingress Storage, Optional but Recommended)

### ExternalEvent
Stores raw incoming events (webhook / ROS) for debugging and correlation.

**Fields**
- `external_event_id` (PK)
- `source_type` (`WEBHOOK | ROS | OTHER`)
- `source_id` (optional: topic name, webhook name)
- `correlation_token` (optional)
- `received_at`
- `event_envelope_json` (normalized payload)
- `matched_run_id` (nullable)
- `matched_state_name` (nullable)
- `match_status` (`MATCHED | UNMATCHED | ERROR`)
- `error_message` (nullable)

**Notes**
- If you want to keep M1 minimal, you can skip this table and only store a `RunEvent` entry.  
  But storing it helps a lot when “why didn’t the wait resume?” happens.

---

## 10. Indexing & Query Patterns (SQLite-oriented)

### Common Queries
- Dashboard:
  - latest run overall
  - latest failures (recent N failed runs)
  - workflow list with latest run summary
- Run Monitor (live):
  - run by id
  - node statuses by run id
  - node debug bundle by (run_id, state_name)
  - run events by run id + seq (incremental)
- Run History:
  - list runs ordered by started_at desc
  - filter by status / workflow_id / time range

### Suggested Indexes
- `runs(status, started_at)`
- `runs(workflow_id, started_at)`
- `node_runs(run_id, state_name)`
- `run_events(run_id, seq)` or `(run_id, timestamp)`
- `workflow_versions(workflow_id, version_number)`

---

## 11. M1 Model Invariants (Hard Rules)

- Backend is Source of Truth; all persisted state lives here.
- Every Run references exactly one WorkflowVersion.
- Monitor/History never create Runs.
- Replay reads only stored RunEvent + NodeRun (no middleware calls).
- Condition nodes have exactly two outgoing edges (True/False) at DSL/validation layer.
- Parallel is limited to 2 branches in M1.

---

## 12. Notes on Growth (M2+)

- Nested workflows:
  - add `parent_run_id`, `parent_node_run_id` to `runs`
- Loops:
  - multiple attempts/iterations become first-class
- Advanced observability:
  - artifacts table with blobs/paths
  - log references per node_run
- Multi-robot:
  - add `robot_id` to `runs` and/or `trigger_meta_json`