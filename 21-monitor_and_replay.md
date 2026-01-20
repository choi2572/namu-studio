# ▶ Run Monitor & Replay  
## Data Flow & Behavior (v0)

> This document explains **how Run Monitor and Replay work**,  
> based solely on backend data and polling-based middleware interaction.  
>  
> This document depends on `20_data_model.md`.

---

## 1. Concepts Recap (Important)

- **Run Monitor**
  - Observes **current or finished runs**
  - Uses backend-stored data
  - Middleware is contacted **only via backend polling**
- **Replay**
  - Visualization of historical execution
  - Uses **stored history only**
  - Never calls middleware

---

## 2. Live Run Monitoring – High-Level Flow

### 2.1 Trigger
- User opens Run Monitor for a run with `status=RUNNING` or `WAITING`

---

### 2.2 Backend Polling Loop

Backend periodically performs:

1. `GetExecutionStatus(run_id)` → middleware  
2. Compare returned state with stored snapshot  
3. If changes detected:
   - Update `runs.status`
   - Update / insert `node_runs`
   - Append `run_events`

> Backend **never infers missing state**.  
> All state changes must come from middleware responses.

---

### 2.3 Data Written to DB

#### Run
- status
- started_at / finished_at
- failure_code / message (if any)

#### NodeRun
- status transitions
- timing
- debug payloads:
  - input_json
  - output_json
  - feedback_json
  - decision_json (if applicable)

#### RunEvent
- NODE_STARTED
- NODE_WAITING
- NODE_SUCCEEDED / FAILED / SKIPPED
- RUN_STATUS_CHANGED

---

## 3. Live Run Monitor UI – Data Sources

### 3.1 DAG View (Center)
Derived from:
- WorkflowVersion.dsl_json
- Current `node_runs.status`

Rules:
- RUNNING node → highlighted
- SUCCEEDED → normal
- SKIPPED → muted
- FAILED → red

---

### 3.2 Debug Panel (Right)

When user selects a node:

Backend fetches:
- NodeRun by `(run_id, state_name)`
- Displays:
  - node name / type
  - status
  - duration
  - input_json
  - output_json
  - feedback_json
  - decision_json (if present)

> Debug panel **never calls middleware directly**.

---

### 3.3 Timeline (Bottom)

Derived from:
- `run_events`
- Ordered by `seq` or `timestamp`

Rules:
- Auto-scroll while run is active
- Pause auto-scroll when user scrolls up
- Clicking an event:
  - highlights node in DAG
  - opens debug panel for that node

---

## 4. Run Completion

When middleware reports completion:

- Backend sets:
  - `runs.status = SUCCESS | FAILED | CANCELED`
  - `runs.finished_at`
- Final `RUN_SUCCEEDED` / `RUN_FAILED` event appended
- Polling stops

UI transitions:
- From “Live” to “Finished”
- Replay becomes available

---

## 5. Replay Mode – Core Principles

### 5.1 Replay Definition
Replay is **timeline-driven visualization** of a finished run.

- No middleware calls
- No state mutation
- No cancel
- No execution

---

### 5.2 Replay Data Sources

Replay uses:
- `workflow_versions.dsl_json`
- `node_runs` (final snapshots)
- `run_events` (ordered)

---

### 5.3 Replay Playback Logic

Given a playback cursor (time or event index):

1. Determine active events up to cursor
2. Derive:
   - which nodes are:
     - not started
     - running
     - finished
3. Render DAG state accordingly
4. Debug panel shows:
   - node state **at that point in time**

> Replay state is **derived**, not stored.

---

## 6. Replay UI Behavior

- Default state: **paused**
- Controls:
  - Play
  - Pause
  - Scrub (timeline click)
- No Cancel button
- No Run / Execute button

---

## 7. Key Safety Guarantees

- Replay never calls middleware
- Monitor UI never triggers execution
- History UI never triggers execution
- Execution can only be triggered via:
  - Workflow List
  - Workflow Editor

---

## 8. Common Pitfalls (Explicitly Forbidden)

- ❌ Calling middleware during replay
- ❌ Inferring node state from missing events
- ❌ Treating replay as re-execution
- ❌ Mixing replay and live execution logic

---

## 9. Mental Model (One Sentence)

> **Live Monitor shows “what is happening now”,  
> Replay shows “what happened before”,  
> and both are rendered from backend-owned state.**