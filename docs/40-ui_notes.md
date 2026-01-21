# 🖥️ UI Notes  
## Workflow Authoring & Monitoring Tool (v0)

> This document defines **non-negotiable UI structure, behavior, and interaction rules**.  
>  
> All UI implementation must comply with:
> - `00_system_rules.md`
> - `10_backend_api.md`
> - `20_data_model.md`

---

## 0. UI Design Principles

- UI is **state-driven**, not action-driven
- UI must never:
  - infer execution state
  - trigger execution from monitor/history
- UI differentiates clearly between:
  - **Authoring (Editor)**
  - **Observation (Monitor / History)**

> **Authoring edits definitions.  
> Monitoring observes executions.  
> These modes must never be mixed.**

---

## 1. Global Layout

### 1.1 Top Bar
- Left:
  - Product logo
- Right:
  - Robot name / environment indicator
  - Entry point for future settings

### 1.2 Left Navigation Drawer
- Collapsible
- Menu items (M1):
  - Dashboard
  - Workflow Editor
  - Run History

---

## 2. Dashboard / Workflow List Screen

### 2.1 Purpose
- Primary landing screen
- Overview of:
  - workflows
  - recent activity
  - failures

---

### 2.2 Layout

#### Top Section (Cards)
- **Overview Card**
  - Current or most recent run
  - Workflow name
  - Run state
  - Elapsed time
- **Event / Failure Card**
  - Recently failed runs
  - Clickable → Run Monitor

---

### 2.3 Workflow List Table

**Columns**
- Workflow Name
- Latest Run State
- Latest Run Duration
- Actions (Edit)

**Row Click Behavior**
- `DRAFT` workflow → Editor
- `PUBLISHED` workflow → latest Run Monitor

**Actions**
- Edit button:
  - Always opens Editor
- Floating Action Button (bottom-right):
  - Create new workflow

---

## 3. Workflow Editor Screen

### 3.1 Purpose
- Define and configure workflows
- No execution occurs here unless explicitly triggered via Run

---

### 3.2 Canvas & Node Model

- Canvas-based DAG editor
- Objects:
  - Node
  - Directed Edge (transition only)

#### Node Types
- Skill
- Flow Control (Condition, Parallel)
- Event (Wait)

---

### 3.3 Node Creation

- Floating `+` button (top-left)
- Clicking opens palette:
  - Skill
  - Flow Control
  - Event
- Supports:
  - Click-to-create
  - Drag & Drop to canvas

---

### 3.4 Node UI

- Node shows:
  - Type icon
  - Editable name
- Fold / Unfold:
  - Folded: compact summary
  - Unfolded: parameter editor
- Parameters:
  - Editable only in Editor

---

### 3.5 Start Node

- Start node is **not a separate node**
- Displayed as a small badge/icon on the node
- Exactly one Start node allowed
- No incoming edges allowed

---

### 3.6 Edge Semantics

- Edge represents **control flow only**
- No data mapping on edges (M1)
- Condition edges labeled:
  - `True`
  - `False`

---

### 3.7 Validation UX

- Validation errors block Publish
- Validation indicator:
  - Bottom-right floating icon
  - Shown only when errors exist
- Clicking opens validation summary:
  - Error list
  - Clicking an error focuses the related node

---

### 3.8 Top Actions

- Save:
  - Saves draft
- Cancel:
  - Discards unsaved changes
- Publish:
  - Creates new immutable version
  - Disabled if validation fails

---

## 4. Run Monitor Screen

### 4.1 Purpose
- Observe live execution
- Debug finished executions
- Replay historical runs

> Run Monitor never triggers execution.

---

### 4.2 Layout

#### Top Bar
- Left:
  - Workflow name
  - Run state (`RUNNING | SUCCESS | FAILED | CANCELED`)
- Right:
  - Cancel button (only when RUNNING)
  - Replay controls (only when finished)

---

#### Center
- DAG view
- Node coloring:
  - RUNNING → highlighted
  - SUCCEEDED → normal
  - FAILED → red
  - SKIPPED → muted

---

#### Right Panel (Debug Panel)
- Appears when node is selected
- Shows:
  - Node name / type
  - Status
  - Duration
  - Input
  - Output
  - Feedback
  - Decision info (if applicable)
- Read-only

---

#### Bottom (Timeline)
- Event list ordered by time
- Auto-scroll when run is active
- Pauses auto-scroll on user interaction
- Clicking an event:
  - Highlights node
  - Opens debug panel

---

### 4.3 Live vs Replay Mode

#### Live Mode
- Auto-updating via backend polling
- Cancel button available
- No Replay controls

#### Replay Mode
- Uses stored history only
- Controls:
  - Play
  - Pause
  - Scrub
- No Cancel
- No Run / Execute

---

## 5. Run History Screen

### 5.1 Purpose
- Global overview of all runs
- Identify failures quickly

---

### 5.2 Table Layout

**Columns**
- Run ID
- Workflow Name
- Start Time
- Duration
- Result

---

### 5.3 Interactions

- Row click:
  - Opens Run Monitor (Replay mode)
- Result cell (FAIL):
  - Click opens failure code / message popover

---

### 5.4 Filters (Top)
- Status filter
- Workflow filter
- Time range filter

---

## 6. Forbidden UI Behaviors (Hard Rules)

- ❌ Trigger execution from Run Monitor
- ❌ Trigger execution from Run History
- ❌ Editable parameters outside Editor
- ❌ Calling middleware directly from UI
- ❌ Mixing Replay and Live execution actions

---

## 7. Visual Consistency Rules

- Node selection highlight style must be consistent across Editor and Monitor
- State color mapping must be consistent
- Icons must reflect node type, not state

---

## 8. Mental Model (One Sentence)

> **Editor builds workflows.  
> Monitor observes executions.  
> History reviews outcomes.**