> ⚠️ 규칙  
> - 이 문서는 `00_system_rules.md`를 **전제로 한다**  
> - Monitor/History에서 실행 트리거 금지  
> - API는 **의미 단위** 중심 (엔드포인트 이름은 바뀔 수 있음)

---

# 📡 Backend API Specification (v0)

> This document defines the **backend API surface and responsibilities**  
> for the Workflow Authoring & Monitoring System.  
>  
> **Detailed schemas may evolve, but responsibilities must not.**

---

## 0. API Design Principles

- Backend is the **Source of Truth**
- Backend **never infers execution state**
- Middleware interaction is **poll-based**
- APIs are **role-oriented**, not UI-oriented
- Execution and Replay are **strictly separated**

---

## 1. Workflow APIs

### 1.1 Create Workflow
**Purpose**
- Create a new workflow container
- Initial state: `DRAFT`

**Responsibilities**
- Assign workflow ID
- Initialize metadata (name, description, timestamps)

---

### 1.2 List Workflows
**Purpose**
- Retrieve all workflows for dashboard / list view

**Returns (conceptual)**
- workflow id
- name
- state (`DRAFT | PUBLISHED`)
- latest published version (if any)
- latest run summary (if any)

---

### 1.3 Get Workflow
**Purpose**
- Retrieve workflow metadata

---

### 1.4 Update Workflow Metadata
**Purpose**
- Update workflow name / description
- Does **not** modify workflow definition

---

## 2. Workflow Version APIs

### 2.1 Create Workflow Version (Save Draft)
**Purpose**
- Save current editor state as a draft version

**Responsibilities**
- Persist DSL JSON
- Persist editor view metadata (layout, positions)

---

### 2.2 Validate Workflow Version
**Purpose**
- Validate workflow definition before publish

**Validation Includes**
- Start node rules
- Condition rules
- Parallel rules
- DAG integrity

---

### 2.3 Publish Workflow Version
**Purpose**
- Publish a validated workflow version

**Responsibilities**
- Mark version immutable
- Update workflow’s `current_version`
- Block publish if validation fails

---

### 2.4 Get Workflow Version
**Purpose**
- Retrieve DSL JSON for:
  - execution
  - editor loading
  - replay reference

---

## 3. Run Execution APIs

### 3.1 Start Run (Execute Workflow)
**Purpose**
- Trigger **real robot execution**
- Only allowed from:
  - Workflow List
  - Workflow Editor

**Responsibilities**
- Create Run record
- Assign `run_id`
- Call middleware `StartExecution`
- Persist run input / trigger source

---

### 3.2 Cancel Run
**Purpose**
- Stop an active execution

**Responsibilities**
- Call middleware `CancelExecution`
- Persist cancel reason
- Update run state

---

## 4. Run Monitoring APIs

### 4.1 Get Run Status
**Purpose**
- Poll current execution state

**Returns (conceptual)**
- run status (`RUNNING | WAITING | FAILED | SUCCESS | CANCELED`)
- current node
- node status summary

---

### 4.2 Get Run Snapshot
**Purpose**
- Provide consolidated monitoring data for UI

**Includes**
- run metadata
- node states
- timing info

---

### 4.3 Get Node Debug Data
**Purpose**
- Retrieve debug context for a specific node

**Returns (conceptual)**
- node name
- execution state
- duration
- input
- output
- feedback
- decision info (for condition / parallel)

---

## 5. Replay APIs (Read-only)

### 5.1 Get Run Timeline
**Purpose**
- Retrieve ordered execution events for replay

**Characteristics**
- Read-only
- No middleware calls
- Derived from stored history

---

### 5.2 Get Replay Snapshot (Optional)
**Purpose**
- Provide replay state at a given timestamp/index

---

## 6. Run History APIs

### 6.1 List Runs
**Purpose**
- Global run history view

**Supports Filters**
- workflow
- status
- time range

**Returns (conceptual)**
- run id
- workflow name
- start time
- duration
- result

---

### 6.2 Get Run Summary
**Purpose**
- Lightweight summary for list views

---

## 7. Event Ingestion APIs

### 7.1 Ingest External Event
**Purpose**
- Receive external events (webhook / ROS bridge)

**Responsibilities**
- Correlate event to waiting run/node
- Store event payload
- Resume execution via middleware

---

## 8. Capability APIs

### 8.1 List Skills
**Purpose**
- Retrieve available skills for Editor palette

**Returns**
- skill name
- version
- parameter schema (optional)

---

### 8.2 Get Runtime Health
**Purpose**
- Check middleware / robot availability

**Returns**
- health status
- runtime info

---

## 9. Explicit API Constraints

### Forbidden Actions
- ❌ Starting execution from Run Monitor
- ❌ Starting execution from Run History
- ❌ Re-triggering execution via Replay APIs

### Required Guarantees
- Every Run references **exactly one workflow version**
- Replay APIs never call middleware
- Run state transitions are persisted before UI exposure

---

## 10. Error Handling (Conceptual)

- Validation errors:
  - Returned before publish
- Execution errors:
  - Persisted as failure codes/messages
- API never hides execution failures

---

## 11. Relationship to Other Documents

- Must comply with:
  - `00_system_rules.md`
- Middleware details defined in:
  - `30_middleware_contract.md`
- Data persistence defined in:
  - `20_data_model.md`

---

## 12. Final Statement

> This API specification defines **what the backend is responsible for**,  
> not how each endpoint is implemented.  
>  
> Any API design that violates system rules is invalid.

---