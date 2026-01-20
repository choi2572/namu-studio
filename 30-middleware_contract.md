# ⚙️ Middleware Contract (v1)  
## Backend ↔ Execution Engine (WebSocket-based)

> This document defines the **WebSocket-based contract** between  
> Backend (Source of Truth) and Middleware (Execution Engine).  
>  
> This contract must comply with:
> - `00_system_rules.md`
> - `10_backend_api.md`
> - `20_data_model.md`

---

## 0. Purpose

This document specifies:

- How Backend **subscribes** to execution events
- How Middleware **streams execution state changes**
- How **event loss, reconnection, and resume** are handled
- What **must never happen** across this boundary

This is a **behavioral and semantic contract**, not an implementation guide.

---

## 1. Responsibility Boundary (Non-Negotiable)

### Backend
- Owns **all persisted state**
- Owns:
  - run lifecycle
  - node lifecycle
  - execution history
- Initiates **all connections**
- Stores and deduplicates events
- Never infers missing execution state

### Middleware
- Executes workflow DSL
- Evaluates:
  - condition nodes
  - parallel semantics
- Maintains **in-memory execution state**
- Streams execution events on request
- Never persists authoritative history

### Absolute Rule
> **Middleware never initiates communication.  
> Backend always connects and subscribes.**

---

## 2. Transport Overview

- Transport: **WebSocket**
- Direction:
  - Backend → Middleware: command & subscription
  - Middleware → Backend: execution events
- Encoding: **JSON**
- Connection scope:
  - One active WebSocket per middleware instance
  - One active run at a time (M1 assumption)

---

## 3. Event Model (Core)

### 3.1 Event Sequence (`seq`)

- Every execution event has:
  - `seq` (monotonically increasing integer)
- `seq` is scoped per run
- `seq` ordering defines **canonical event order**

**Guarantees**
- No two events share the same `seq`
- Events are immutable once emitted

---

### 3.2 Delivery Semantics

- **At-least-once delivery**
- Backend must:
  - Deduplicate events by `seq`
  - Persist events in order
- Middleware must:
  - Be able to resend events after reconnection

---

## 4. WebSocket Connection Lifecycle

### 4.1 Connect
Backend opens WebSocket connection to middleware.

No execution starts implicitly on connect.

---

### 4.2 Subscribe (Resume-aware)

Backend sends a subscription message.

**Message**
```json
{
  "type": "SUBSCRIBE",
  "run_id": "run-123",
  "after_seq": 42
}
```

**Semantics**
- `after_seq` = last event `seq` already persisted by backend
- Middleware must stream events with `seq > after_seq`

---

### 4.3 Subscribed Acknowledgement

Middleware responds once:

```json
{
  "type": "SUBSCRIBED",
  "run_id": "run-123",
  "starting_seq": 43
}
```

---

### 4.4 Event Streaming

Middleware streams execution events:

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
- Events must be sent in ascending `seq` order
- Middleware may batch or flush immediately
- Backend must persist before UI exposure

---

### 4.5 Connection Loss & Resume

If WebSocket disconnects:

1. Backend retains `last_seq` from DB
2. Backend reconnects
3. Backend re-sends `SUBSCRIBE` with `after_seq=last_seq`
4. Middleware resumes streaming

**Guarantee**
> No execution event may be permanently lost if backend reconnects with a valid `after_seq`.

---

## 5. Required Message Types

### Backend → Middleware

| Type | Purpose |
|---|---|
| `SUBSCRIBE` | Subscribe or resume event stream |
| `START_EXECUTION` | Start real execution |
| `CANCEL_EXECUTION` | Cancel active run |
| `RESUME_WAIT` | Resume WAIT node with event payload |
| `PING` | (Optional) keepalive |

---

### Middleware → Backend

| Type | Purpose |
|---|---|
| `SUBSCRIBED` | Subscription acknowledgement |
| `RUN_EVENT` | Execution state change |
| `ERROR` | Execution or protocol error |
| `PONG` | (Optional) keepalive |

---

## 6. Execution Control Messages

### 6.1 START_EXECUTION

Sent only once per run.

```json
{
  "type": "START_EXECUTION",
  "run_id": "run-123",
  "workflow_dsl": { ... },
  "run_input": { ... }
}
```

**Rules**
- Must be idempotent
- Middleware must reject duplicate starts

---

### 6.2 CANCEL_EXECUTION

```json
{
  "type": "CANCEL_EXECUTION",
  "run_id": "run-123",
  "reason": "user_cancel"
}
```

---

### 6.3 RESUME_WAIT

```json
{
  "type": "RESUME_WAIT",
  "run_id": "run-123",
  "state_name": "WaitForSignal",
  "event_payload": { ... }
}
```

---

## 7. Event Types (Canonical)

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

## 8. Snapshot Reconciliation (Safety Net)

Even with streaming, backend may periodically call:

- `GetExecutionSnapshot(run_id)` (HTTP or WS request/response)

**Purpose**
- Detect bugs or missed events
- Reconcile long-lived WAIT states

**Rule**
- Snapshot **never replaces event log**
- Snapshot is only corrective

---

## 9. Replay Boundary (Critical)

> **Middleware is never involved in Replay.**

- No WebSocket calls during replay
- Replay uses:
  - persisted `run_events`
  - `node_runs`
  - workflow DSL

Violation of this rule is a contract breach.

---

## 10. Forbidden Behaviors

- ❌ Middleware initiating WebSocket connections
- ❌ Emitting events without `seq`
- ❌ Reordering events
- ❌ Triggering execution during replay
- ❌ Backend mutating middleware state without explicit message

---

## 11. Failure & Robustness Rules

- Middleware restart:
  - Must allow backend to resubscribe
  - Must retain recent events (buffer) long enough to resume
- Backend restart:
  - Must recover `last_seq` from DB
  - Must resubscribe before UI resumes live view

---

## 12. Mental Model (One Sentence)

> **Backend subscribes and records.  
> Middleware executes and streams.  
> Events are the single source of truth for execution history.**