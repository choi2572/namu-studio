# ⚙️ Middleware Contract  
## Backend ↔ Execution Engine (v0)

> This document defines the **contractual interaction** between  
> the Backend (Source of Truth) and the Middleware (Execution Engine).  
>  
> This document must comply with:
> - `00_system_rules.md`
> - `10_backend_api.md`
> - `20_data_model.md`

---

## 0. Purpose of This Document

This document defines:

- What **Backend may ask Middleware to do**
- What **Middleware must guarantee in response**
- What **must never happen** across this boundary

This is a **behavioral contract**, not an implementation guide.

---

## 1. Responsibility Boundary (Non-Negotiable)

### Backend Responsibilities
- Owns **all persisted state**
- Owns:
  - run lifecycle
  - node lifecycle
  - execution history
- Polls middleware for execution state
- Never infers or fabricates execution state

### Middleware Responsibilities
- Executes workflow definitions
- Evaluates:
  - condition nodes
  - parallel execution
- Maintains **in-memory execution state**
- Responds truthfully to backend polling

### Absolute Rule
> **Middleware never pushes state.  
> Backend always pulls state.**

---

## 2. Execution Lifecycle Overview

```
Backend                     Middleware
   |                             |
   | StartExecution               |
   |---------------------------->|
   |                             |
   |   (execution starts)        |
   |                             |
   | GetExecutionStatus (poll)   |
   |---------------------------->|
   |                             |
   | <----- current state -------|
   |                             |
   |   (repeat until finished)   |
```

---

## 3. Required Middleware Capabilities

### 3.1 StartExecution

**Purpose**
- Start real execution of a workflow

**Called By**
- Backend only

**Input (conceptual)**
- `run_id`
- `workflow_dsl_json`
- `run_input_json`
- (optional) execution options

**Middleware Guarantees**
- Execution is uniquely identified by `run_id`
- Execution does not start twice for the same `run_id`
- Any future state query for this run must be resolvable

**Forbidden**
- Middleware generating its own run identifiers
- Middleware mutating workflow DSL

---

### 3.2 GetExecutionStatus (Polling)

**Purpose**
- Retrieve the **current execution snapshot**

**Called By**
- Backend periodically

**Returns (conceptual)**
- run status
- per-node status summary
- current active node(s)
- indication of WAITING states

**Middleware Guarantees**
- Returned state reflects actual execution state
- State transitions are monotonic
- No fabricated or inferred state

**Notes**
- Backend may call this repeatedly
- Middleware must be idempotent and cheap

---

### 3.3 GetNodeDebugBundle

**Purpose**
- Retrieve detailed debug context for a node

**Called By**
- Backend (on-demand)

**Returns**
- input data
- output data
- internal state snapshot
- feedback / error / decision info

**Middleware Guarantees**
- Debug data corresponds to the **current or final state** of the node
- Data is immutable once node is finished

---

### 3.4 CancelExecution

**Purpose**
- Stop an active execution

**Called By**
- Backend only

**Input**
- `run_id`
- cancel reason

**Middleware Guarantees**
- Execution halts as soon as safely possible
- Subsequent status polls reflect cancellation
- No further node execution after cancel

---

### 3.5 ResumeWait

**Purpose**
- Resume a workflow paused at a WAIT node

**Called By**
- Backend only (after receiving an external event)

**Input**
- `run_id`
- `state_name`
- `event_payload`

**Middleware Guarantees**
- Resumes only if the node is in WAITING state
- Rejects resume if state is invalid
- Event payload is provided to the node logic

---

## 4. Condition & Parallel Semantics

### 4.1 Condition Nodes

- Evaluated entirely by middleware
- Exactly one outgoing branch is selected
- Selection is final and deterministic

**Returned to Backend via**
- Node status
- decision info in debug payload

---

### 4.2 Parallel Execution (M1)

- Exactly two branches
- Both branches start concurrently
- Join semantics:
  - `ALL_SUCCESS`
  - Fail-fast if any branch fails

**Middleware Guarantees**
- Branch executions are independent
- Join completes only when both branches finish
- Non-selected or canceled nodes are explicitly reported

---

## 5. WAIT / Event Semantics

### WAIT Node
- Middleware pauses execution
- Execution state becomes `WAITING`
- Middleware must clearly indicate:
  - which node is waiting
  - what kind of event is expected (via debug payload)

### Resume
- Backend decides **when** to resume
- Middleware decides **how** to continue execution

---

## 6. Error & Failure Semantics

### Execution Failure
- Node-level failure propagates to run failure (unless otherwise specified)
- Middleware must report:
  - failure code
  - failure message

### Safety Interrupts
- Treated as execution failure
- Clearly distinguishable via failure code

---

## 7. Replay Boundary (Critical)

> **Middleware is never involved in Replay.**

- Replay does not:
  - call StartExecution
  - call GetExecutionStatus
  - call GetNodeDebugBundle
- Replay is rendered exclusively from backend-stored data

Any middleware call during replay is a **contract violation**.

---

## 8. Idempotency & Robustness

Middleware must support:

- Repeated polling with same `run_id`
- Backend restarts mid-execution
- Temporary polling gaps

Middleware must **not** assume:
- continuous connectivity
- exactly-once polling

---

## 9. Forbidden Behaviors (Explicit)

- ❌ Middleware pushing state to backend
- ❌ Middleware creating run IDs
- ❌ Middleware mutating published workflow definitions
- ❌ Middleware triggering execution on replay
- ❌ Middleware inferring backend state

---

## 10. Mental Model (One Sentence)

> **Backend observes and records.  
> Middleware executes and reports.  
> Neither crosses the boundary.**

---

## 11. Relationship to Other Documents

- Execution semantics: `00_system_rules.md`
- API surface: `10_backend_api.md`
- Persistence: `20_data_model.md`
- Monitor & Replay behavior:
  - `Run Monitor & Replay – Data Flow & Behavior`