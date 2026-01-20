# 🧭 Workflow Authoring & Monitoring System

## Non-Negotiable System Rules (v0)

> This document defines non-negotiable design, UX, and execution rules.
> All implementation prompts must comply with this document.

---

## 0. Project Identity & Non-Goals

## 0.1 What this system IS
	•	A robot workflow authoring, execution monitoring, and debugging tool
	•	Workflow execution is handled by middleware
	•	Backend is the Source of Truth for:
	    •	workflow definitions
	    •	run state
	    •	node state
	    •	execution history
	•	UI is designed for:
	    •	developers (debugging)
	    •	operators (monitoring)

## 0.2 What this system IS NOT
	•	❌ A real-time robot teleoperation UI
	•	❌ A motion / hardware control interface
	•	❌ A system where Monitor or History can trigger robot execution

> **Run Monitor is a read-only observation tool.**
> **Real robot execution is triggered only via explicit Run actions.**

---

## 1. Core Concepts & Terminology (Strict)

These terms must be used consistently.
	•	Workflow: A DAG definition of execution logic
	•	Workflow Version: Immutable published snapshot of a workflow
	•	Run: A single execution instance of a workflow version
	•	Node: A state within a workflow (skill / condition / flow control / event)
	•	Edge: Directed transition between nodes
	    •	Edge represents control flow only
	    •	Edge does not handle data mapping
	•	Start Node:
	    •	Exactly one per workflow
	    •	No incoming edges
	•	Condition Node:
	    •	Exactly two outgoing edges
	    •	Edges labeled True / False
	•	Parallel (M1):
	    •	Split + Join model
	    •	Exactly two branches
	•	Replay:
	    •	Visualization of historical execution
	    •	Never triggers real execution
	•	Run / Execute:
	    •	Triggers actual robot execution
	    •	Must be explicit and intentional

> **Replay ≠ Run**
> Confusing these is a critical design error.

---

## 2. Execution & State Ownership Model

## 2.1 Ownership
	•	Middleware
	    •	Executes workflows
	    •	Evaluates condition nodes
	    •	Manages parallel execution
	•	Backend
	    •	Polls middleware for state
	    •	Persists run / node state
	    •	Persists execution history
	    •	Never infers or fabricates state

## 2.2 State Flow
	•	Backend periodically polls middleware for:
	    •	run status
	    •	node status
	    •	node debug payloads
	•	All UI views are derived from backend-stored data

## 2.3 Safety Rules
	•	Monitor UI cannot trigger execution
	•	History UI cannot trigger execution
	•	Replay cannot be canceled
	•	Cancel stops only real execution

---

## 3. UI Screen Roles & Behavioral Rules

## 3.1 Screen Roles

**Dashboard / Workflow List**
	•	Primary entry point
	•	Shows:
	    •	workflow list
	    •	recent / running runs
	    •	recent failures
	•	Row click behavior
	    •	DRAFT workflow → Editor
	    •  	PUBLISHED workflow → latest run Monitor

**Workflow Editor**
	•	Canvas-based DAG editor
	•	Purpose: definition & configuration
	•	Save ≠ Publish
	•	Publish creates a new immutable version
	•	Validation errors block Publish

**Run Monitor**
	•	Purpose: observation & debugging
	•	Supports:
	    •	live execution view
	    •	replay of historical runs
	•	Contains:
	    •	DAG view (center)
	    •	Debug panel (right)
	    •	Timeline (bottom)

**Run History**
	•	Global, time-ordered list of runs
	•	Read-only
	•	Row click → Run Monitor (replay mode)

---

## 4. Node Interaction Rules

## 4.1 Editor
	•	Node click → select
	•	Node unfold → edit parameters
	•	Node fold → compact view
	•	Parameters editable only in Editor

## 4.2 Monitor
	•	Node click → inspect
	•	Inspection shown in right-side debug panel
	•	Parameters are read-only
	•	Node selection always visually highlighted

---

## 5. Validation Rules (Editor Contract)

Validation errors must be surfaced before Publish.

**Required Rules**
	•	Exactly one Start node
	•	Start node has no incoming edges
	•	No dangling nodes
	•	Condition node:
	    •	exactly two outgoing edges
	    •	labeled True / False
	•	Parallel (M1):
	    •	Split + Join pair
	    •	both branches connected
	•	Workflow must be a DAG (no cycles)

**UI Requirement**
	•	Validation errors shown via:
	    •  	bottom-right floating indicator
	    •	expandable list
	•	Clicking an error focuses the related node

---

## 6. Backend API Surface (Conceptual Only)

This section defines roles, not schemas.
	•	Workflow CRUD
	•	Workflow versioning
	•	Run execution trigger
	•	Run cancellation
	•	Run status polling
	•	Node debug retrieval
	•	Event ingestion
	•	Replay data access

> API naming, payloads, and schemas are defined elsewhere.

---

## 7. Backend ↔ Middleware Contract (Concept Level)
	•	Communication model: Backend polls middleware
	•	Middleware never pushes state
	•	Required capabilities:
	    •	StartExecution
	    •	CancelExecution
	    •	GetExecutionStatus
	    •	GetNodeDebugBundle
	    •	ResumeWait
	•	Middleware evaluates:
	    •	condition logic
	    •	parallel execution

---

## 8. Workflow DSL Philosophy
	•	ASL-like JSON
	•	DAG only
	•	States only
	•	StartAt required
	•	OutputPath optional
	•	Parallel allowed (M1: 2 branches only)
	•	Condition logic expressed via edge labels

> **Edges represent control flow only.**
> **Data binding is expressed inside node parameters.**

---

## 9. Replay Model (Critical)
	•	Replay is timeline-driven visualization
	•	Replay uses stored history only
	•	Replay never calls middleware
	•	Replay supports:
	    •	play / pause
	    •	scrub
	    •	node inspection
	•	Replay does not support cancel

---

## 10. M1 Scope Constraints (Hard Limits)

**Explicitly NOT in M1**
	•	Undo / Redo
	•	Nested workflows
	•	Dynamic skill loading
	•	Cycles / loops
	•	Advanced condition builders
	•	Graph auto-layout engines

**Explicitly IN M1**
	•	Manual drag & drop
	•	Fixed layouts
	•	Simple node naming
	•	2-branch parallel only

---

## 11. Implementation Guardrails for AI Tools
	•	Prefer clarity over abstraction
	•	Do not invent features
	•	Do not add states or enums without explicit instruction
	•	Do not merge execution and replay concepts
	•	Always respect state ownership boundaries

---

## 12. Final Statement

> This document defines the **system’s invariants.**
> Any implementation that violates these rules is considered incorrect.