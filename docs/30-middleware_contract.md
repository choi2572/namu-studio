# ⚙️ Middleware Contract (v2)  
## Backend ↔ Execution Engine (Hybrid: REST + WebSocket)

> This document defines the **hybrid contract** between  
> Backend (Source of Truth) and Middleware (Execution Engine).  
>  
> - **Control Plane**: REST (commands & snapshots)  
> - **Data Plane**: WebSocket (execution events)  
>  
> This contract must comply with:
> - `00_system_rules.md`
> - `10_backend_api.md`
> - `20_data_model.md`

---

## 0. Purpose

This document specifies:

- How Backend **controls execution** via REST
- How Backend **observes execution** via WebSocket
- How **event loss, reconnection, and resume** are handled
- What **must never happen** across this boundary

This is a **semantic contract**, not an implementation guide.

---

## 1. Responsibility Boundary (Non-Negotiable)

### Backend
- Source of Truth for:
  - run lifecycle
  - node lifecycle
  - execution history
- Initiates **all interactions**
- Persists and deduplicates events
- Never infers missing execution state

### Middleware
- Executes workflow DSL
- Evaluates:
  - condition nodes
  - parallel semantics
- Maintains in-memory execution state
- Exposes:
  - REST APIs for control
  - WebSocket for event streaming
- Never owns authoritative history

### Absolute Rule
> **Middleware never initiates communication.  
> Backend always pulls or subscribes.**

---

## 2. Transport Overview

### Control Plane (REST)
Used for **commands and queries**.

- Start execution
- Cancel execution
- Resume WAIT node
- Get execution snapshot (optional safety net)

### Data Plane (WebSocket)
Used for **execution event streaming only**.

- Node/run state changes
- Timeline events
- Resume-aware, seq-based

---

## 3. Control Plane – REST APIs (Conceptual)

> Endpoint names and payloads are conceptual.  
> Exact schemas are defined elsewhere.

---

### 3.1 StartExecution

**Purpose**
- Start real robot execution

**Semantics**
- Idempotent per `run_id`
- Must not start if another run is already active (M1 constraint)

**Input**
- `run_id`
- `workflow_dsl_json`
- `run_input_json`

**Guarantees**
- Execution is uniquely identified by `run_id`
- Duplicate starts are rejected or ignored

---

### 3.2 CancelExecution

**Purpose**
- Stop an active execution

**Input**
- `run_id`
- cancel reason

**Guarantees**
- Execution halts as soon as safely possible
- Cancellation is reflected in subsequent events/snapshots

---

### 3.3 ResumeWait

**Purpose**
- Resume a workflow paused at a WAIT node

**Input**
- `run_id`
- `state_name`
- `event_payload`

**Guarantees**
- Resumes only if node is currently WAITING
- Rejects invalid resumes

---

### 3.4 GetExecutionSnapshot (Optional but Recommended)

**Purpose**
- Safety net for reconciliation
- Used sparingly (low frequency)

**Returns**
- run status
- node status summary
- current active node(s)

**Rule**
> Snapshot never replaces event log.  
> It is corrective only.

---

## 4. Data Plane – WebSocket Event Stream

### 4.1 Scope

- One WebSocket connection per middleware instance
- One active run at a time (M1 assumption)
- WebSocket is **read-only from middleware’s perspective**
  - No execution commands over WS

---

## 5. Event Model (Core)

### 5.1 Event Sequence (`seq`)

- Every execution event includes:
  - `seq` (monotonically increasing integer)
- `seq` is scoped per run
- Defines canonical ordering

**Guarantees**
- No gaps are assumed
- Events are immutable once emitted

---

### 5.2 Delivery Semantics

- **At-least-once delivery**
- Backend must:
  - Deduplicate by `seq`
  - Persist events before exposing to UI
- Middleware must:
  - Support resending events after reconnect

---

## 6. WebSocket Lifecycle

### 6.1 Connect
Backend opens WebSocket connection.

No implicit execution occurs.

---

### 6.2 Subscribe (Resume-aware)

Backend sends:

```json
{
  "type": "SUBSCRIBE",
  "run_id": "run-123",
  "after_seq": 42
}
```

**Meaning**
- Backend already has events up to `seq=42`
- Middleware must stream events with `seq > 42`

---

### 6.3 Subscription Acknowledgement

Middleware responds once:

```json
{
  "type": "SUBSCRIBED",
  "run_id": "run-123",
  "starting_seq": 43
}
```

---

### 6.4 Event Message

```json
{
  "type": "RUN_EVENT",
  "run_id": "run-123",
  "seq": 43,
  "timestamp": "...",
  "event_type": "NODE_STARTED",
  "state_name": "PickObject",
  "payload": { ... }
}
```

**Rules**
- Events sent in ascending `seq`
- Batching allowed
- Backend persists immediately

---

### 6.5 Reconnection & Resume

If WebSocket disconnects:

1. Backend reads `last_seq` from DB
2. Backend reconnects
3. Backend re-sends `SUBSCRIBE(after_seq=last_seq)`
4. Middleware resumes streaming

**Guarantee**
> No execution event may be permanently lost if backend reconnects with a valid `after_seq`.

---

## 7. Canonical Event Types

### Run-level
- `RUN_CREATED`
- `RUN_STARTED`
- `RUN_WAITING`
- `RUN_SUCCEEDED`
- `RUN_FAILED`
- `RUN_CANCELED`

### Node-level
- `NODE_STARTED`
- `NODE_WAITING`
- `NODE_SUCCEEDED`
- `NODE_FAILED`
- `NODE_SKIPPED`
- `NODE_CANCELED`

### External / Safety
- `EXTERNAL_EVENT_RECEIVED`
- `SAFETY_INTERRUPT`

---

## 8. Replay Boundary (Critical)

> **Replay never interacts with middleware.**

- No REST calls
- No WebSocket connections
- Replay uses:
  - persisted `run_events`
  - `node_runs`
  - workflow DSL

Any middleware interaction during replay is a contract violation.

---

## 9. Failure & Robustness Rules

### Middleware Restart
- Must allow:
  - REST commands after restart
  - WebSocket resubscription
- Must retain recent events long enough for resume

### Backend Restart
- Must recover `last_seq` from DB
- Must resubscribe before resuming live monitor

---

## 10. Forbidden Behaviors

- ❌ Execution commands over WebSocket
- ❌ Middleware pushing events without subscription
- ❌ Events without `seq`
- ❌ Reordering events
- ❌ Triggering execution during replay

---

## 11. Mental Model (One Sentence)

> **REST controls execution.  
> WebSocket streams execution facts.  
> Backend records everything.**