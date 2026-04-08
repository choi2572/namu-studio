"""Dummy ExecutionEngineAdapter for simulation (DSL v1)."""

import threading
import time
import uuid
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from app.domain.models import NodeRun, NodeStatus, Run, RunEvent, RunStatus


class ExecutionEngineAdapter(ABC):
    """Interface for execution engine adapter."""

    @abstractmethod
    def start_execution(
        self,
        run_id: str,
        workflow_dsl: dict[str, Any],
        run_input: dict[str, Any] | None = None,
    ) -> None:
        """Start execution (non-blocking)."""
        pass

    @abstractmethod
    def cancel_execution(self, run_id: str) -> None:
        """Cancel execution."""
        pass

    @abstractmethod
    def resume_wait(self, run_id: str, state_name: str, payload: dict[str, Any]) -> None:
        """Resume a waiting node."""
        pass

    def reconcile_stale_run(self, run: Run) -> bool:
        """If the engine is idle but this run is still active, mark it terminal.

        Returns True if the run was reconciled.
        """
        return False


class DummyExecutionEngineAdapter(ExecutionEngineAdapter):
    """Dummy adapter that simulates execution (DSL v1)."""

    def __init__(
        self,
        run_repo,
        node_run_repo,
        run_event_repo,
        workflow_repo,
        workflow_version_repo,
    ):
        self.run_repo = run_repo
        self.node_run_repo = node_run_repo
        self.run_event_repo = run_event_repo
        self.workflow_repo = workflow_repo
        self.workflow_version_repo = workflow_version_repo
        self._waiting_nodes: dict[str, dict[str, Any]] = {}  # run_id -> {state_name: workflow_context}
        self._lock = threading.Lock()

    def start_execution(
        self,
        run_id: str,
        workflow_dsl: dict[str, Any],
        run_input: dict[str, Any] | None = None,
    ) -> None:
        """Start execution simulation."""
        thread = threading.Thread(
            target=self._simulate_execution,
            args=(run_id, workflow_dsl, run_input),
            daemon=True,
        )
        thread.start()

    def _simulate_execution(
        self,
        run_id: str,
        workflow_dsl: dict[str, Any],
        run_input: dict[str, Any] | None,
    ):
        """Simulate execution in a separate thread (DSL v1)."""
        run = self.run_repo.get(run_id)
        if not run:
            return

        # Update run status
        run.status = RunStatus.RUNNING
        run.started_at = datetime.utcnow()
        self.run_repo.update(run)

        # Create initial events
        seq = self.run_event_repo.get_max_seq(run_id) or 0
        seq += 1
        self._emit_event(run_id, "RUN_CREATED", None, {"run_id": run_id}, seq)
        seq += 1
        self._emit_event(run_id, "RUN_STARTED", None, {"run_id": run_id}, seq)

        # Get start node
        start_at = workflow_dsl.get("StartAt")
        if not start_at:
            run.status = RunStatus.FAILED
            run.failure_code = "NO_START_NODE"
            run.failure_message = "Workflow has no StartAt"
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)
            seq += 1
            self._emit_event(run_id, "RUN_FAILED", None, {"reason": "No StartAt"}, seq)
            return

        states = workflow_dsl.get("States", {})
        if start_at not in states:
            run.status = RunStatus.FAILED
            run.failure_code = "INVALID_START_NODE"
            run.failure_message = f"StartAt node '{start_at}' not found"
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)
            seq += 1
            self._emit_event(run_id, "RUN_FAILED", None, {"reason": "Invalid StartAt"}, seq)
            return

        # Execute workflow
        try:
            self._execute_node(run_id, start_at, states, run_input, seq + 1)
        except Exception as e:
            run.status = RunStatus.FAILED
            run.failure_code = "EXECUTION_ERROR"
            run.failure_message = str(e)
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)
            seq = self.run_event_repo.get_max_seq(run_id) or 0
            seq += 1
            self._emit_event(run_id, "RUN_FAILED", None, {"reason": str(e)}, seq)

    def _execute_node(
        self,
        run_id: str,
        state_name: str,
        states: dict[str, Any],
        context: dict[str, Any] | None,
        initial_seq: int,
    ) -> int:
        """Execute a single node and return next sequence number."""
        if state_name not in states:
            raise ValueError(f"State '{state_name}' not found")

        node_def = states[state_name]
        node_type = (node_def.get("Type") or "").strip()
        seq = initial_seq

        # Expected: parallel_node_name NODE_STARTED → 브랜치 동시 실행 → 둘 다 끝나면 NODE_SUCCEEDED(duration) → Next
        has_branches = isinstance(node_def.get("Branches"), list) and len(node_def.get("Branches", [])) > 0
        if (node_type or "").lower() == "parallel" or has_branches:
            seq = self._execute_parallel(run_id, state_name, node_def, states, context, seq)
            next_node = node_def.get("Next")
            if next_node:
                return self._execute_node(run_id, next_node, states, context, seq + 1)
            if node_def.get("End"):
                run = self.run_repo.get(run_id)
                run.status = RunStatus.SUCCESS
                run.finished_at = datetime.utcnow()
                self.run_repo.update(run)
                seq += 1
                self._emit_event(run_id, "RUN_SUCCEEDED", None, {"run_id": run_id}, seq)
                return seq
            raise ValueError(f"Parallel state '{state_name}' has neither Next nor End")

        # Create node run
        node_run_id = f"{run_id}-{state_name}"
        node_run = NodeRun(
            node_run_id=node_run_id,
            run_id=run_id,
            state_name=state_name,
            node_type=node_type,
            status=NodeStatus.RUNNING,
            started_at=datetime.utcnow(),
            input_json=context,
        )
        self.node_run_repo.create(node_run)

        seq += 1
        self._emit_event(run_id, "NODE_STARTED", state_name, {"node": state_name}, seq)

        # Simulate execution time
        time.sleep(0.5)

        # Determine outcome (simulate some failures)
        should_fail = state_name.endswith("_fail") or "fail" in state_name.lower()

        if should_fail:
            node_run.status = NodeStatus.FAILED
            node_run.finished_at = datetime.utcnow()
            node_run.duration_ms = 500
            node_run.feedback_json = {"error": "Simulated failure"}
            self.node_run_repo.update(node_run)

            seq += 1
            self._emit_event(run_id, "NODE_FAILED", state_name, {"node": state_name}, seq)

            run = self.run_repo.get(run_id)
            run.status = RunStatus.FAILED
            run.failure_code = "NODE_FAILED"
            run.failure_message = f"Node {state_name} failed"
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)

            seq += 1
            self._emit_event(run_id, "RUN_FAILED", None, {"reason": f"Node {state_name} failed"}, seq)
            return seq

        # Handle different state types
        if node_type == "Skill":
            seq = self._execute_skill(run_id, state_name, node_def, node_run, seq)
        elif node_type == "Condition":
            seq = self._execute_condition(run_id, state_name, node_def, states, node_run, context, seq)
            return seq  # Condition handles its own next node
        elif node_type == "Wait":
            seq = self._execute_wait(run_id, state_name, node_def, node_run, states, context, seq)
            return seq  # Wait pauses execution
        elif node_type == "Pass":
            seq = self._execute_pass(run_id, state_name, node_def, node_run, seq)
        else:
            # Unknown type, treat as success
            node_run.status = NodeStatus.SUCCEEDED
            node_run.finished_at = datetime.utcnow()
            node_run.duration_ms = 500
            node_run.output_json = {"result": "success"}
            self.node_run_repo.update(node_run)

            seq += 1
            self._emit_event(run_id, "NODE_SUCCEEDED", state_name, {"node": state_name}, seq)

        # Determine next node
        next_node = node_def.get("Next")
        if next_node:
            return self._execute_node(run_id, next_node, states, context, seq + 1)
        elif node_def.get("End"):
            # Terminal node
            run = self.run_repo.get(run_id)
            run.status = RunStatus.SUCCESS
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)

            seq += 1
            self._emit_event(run_id, "RUN_SUCCEEDED", None, {"run_id": run_id}, seq)
            return seq
        else:
            # No Next and no End - error
            raise ValueError(f"State '{state_name}' has neither Next nor End")

    def _execute_skill(
        self,
        run_id: str,
        state_name: str,
        node_def: dict[str, Any],
        node_run: NodeRun,
        seq: int,
    ) -> int:
        """Execute Skill state."""
        node_run.status = NodeStatus.SUCCEEDED
        node_run.finished_at = datetime.utcnow()
        node_run.duration_ms = 500
        node_run.output_json = {
            "result": "success",
            "skill": node_def.get("Skill"),
            "parameters": node_def.get("Parameters", {}),
        }
        self.node_run_repo.update(node_run)

        seq += 1
        self._emit_event(run_id, "NODE_SUCCEEDED", state_name, {"node": state_name}, seq)
        return seq

    def _execute_condition(
        self,
        run_id: str,
        state_name: str,
        node_def: dict[str, Any],
        states: dict[str, Any],
        node_run: NodeRun,
        context: dict[str, Any] | None,
        seq: int,
    ) -> int:
        """Execute Condition state."""
        # Evaluate condition (simplified: always True for now)
        if_data = node_def.get("If", {})
        condition_data = if_data.get("Condition", {})
        variable = condition_data.get("Variable", "")
        operator = condition_data.get("Operator", "==")
        value = condition_data.get("Value")

        # Simple evaluation (in real implementation, evaluate from context)
        condition_result = True  # Simulate True

        node_run.decision_json = {
            "condition": {
                "variable": variable,
                "operator": operator,
                "value": value,
            },
            "result": condition_result,
        }
        node_run.status = NodeStatus.SUCCEEDED
        node_run.finished_at = datetime.utcnow()
        node_run.duration_ms = 100
        self.node_run_repo.update(node_run)

        seq += 1
        self._emit_event(
            run_id,
            "NODE_SUCCEEDED",
            state_name,
            {"node": state_name, "decision": condition_result},
            seq,
        )

        # Choose branch
        if condition_result:
            next_node = if_data.get("Then")
        else:
            next_node = node_def.get("Else")

        if next_node:
            return self._execute_node(run_id, next_node, states, context, seq + 1)
        else:
            raise ValueError(f"Condition state '{state_name}' has no valid next node")

    def _run_branch(
        self,
        run_id: str,
        branch: dict[str, Any],
        seq_ref: list[int],
        seq_lock: threading.Lock,
    ) -> None:
        """Run one Parallel branch in a thread; seq_ref[0] and seq_lock for serialized event seq."""
        branch_states = branch.get("States") or {}
        current = branch.get("StartAt")
        if not current or current not in branch_states:
            return
        while current:
            state_def = branch_states.get(current)
            if not state_def:
                break
            stype = (state_def.get("Type") or "").strip()
            node_run_id = f"{run_id}-{current}"
            node_run = NodeRun(
                node_run_id=node_run_id,
                run_id=run_id,
                state_name=current,
                node_type=stype or "Task",
                status=NodeStatus.RUNNING,
                started_at=datetime.utcnow(),
                input_json=state_def.get("Parameters") or {},
            )
            with seq_lock:
                self.node_run_repo.create(node_run)
                seq_ref[0] += 1
                seq = seq_ref[0]
            self._emit_event(run_id, "NODE_STARTED", current, {"node": current}, seq)
            time.sleep(0.5)
            node_run.status = NodeStatus.SUCCEEDED
            node_run.finished_at = datetime.utcnow()
            node_run.duration_ms = 500
            node_run.output_json = {"result": "ok", "state": current}
            self.node_run_repo.update(node_run)
            with seq_lock:
                seq_ref[0] += 1
                seq = seq_ref[0]
            self._emit_event(run_id, "NODE_SUCCEEDED", current, {"node": current}, seq)
            if state_def.get("End"):
                break
            current = state_def.get("Next")

    def _execute_parallel(
        self,
        run_id: str,
        state_name: str,
        node_def: dict[str, Any],
        states: dict[str, Any],
        context: dict[str, Any] | None,
        seq: int,
    ) -> int:
        """Parallel: NODE_STARTED → 브랜치 동시 실행 → NODE_SUCCEEDED(duration) → return seq for Next."""
        branches = node_def.get("Branches", [])
        node_run_id = f"{run_id}-{state_name}"
        parallel_node_run = NodeRun(
            node_run_id=node_run_id,
            run_id=run_id,
            state_name=state_name,
            node_type="Parallel",
            status=NodeStatus.RUNNING,
            started_at=datetime.utcnow(),
            input_json={},
        )
        self.node_run_repo.create(parallel_node_run)
        seq += 1
        self._emit_event(run_id, "NODE_STARTED", state_name, {"node": state_name}, seq)
        parallel_start = datetime.utcnow()

        seq_ref = [seq]
        seq_lock = threading.Lock()
        threads = [threading.Thread(target=self._run_branch, args=(run_id, b, seq_ref, seq_lock)) for b in branches]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        parallel_end = datetime.utcnow()
        duration_ms = int((parallel_end - parallel_start).total_seconds() * 1000)
        parallel_node_run.status = NodeStatus.SUCCEEDED
        parallel_node_run.finished_at = parallel_end
        parallel_node_run.duration_ms = duration_ms
        parallel_node_run.output_json = {
            "branches": len(branches),
            "result": "all_succeeded",
        }
        self.node_run_repo.update(parallel_node_run)
        with seq_lock:
            seq_ref[0] += 1
            seq = seq_ref[0]
        self._emit_event(
            run_id,
            "NODE_SUCCEEDED",
            state_name,
            {"node": state_name, "branches": len(branches)},
            seq,
        )
        return seq

    def _execute_wait(
        self,
        run_id: str,
        state_name: str,
        node_def: dict[str, Any],
        node_run: NodeRun,
        states: dict[str, Any],
        context: dict[str, Any] | None,
        seq: int,
    ) -> int:
        """Execute Wait state - pauses execution until resume_wait is called."""
        event_data = node_def.get("Event", {})
        timeout = node_def.get("Timeout", 300)

        node_run.status = NodeStatus.WAITING
        node_run.finished_at = None  # Not finished yet
        node_run.input_json = {"event": event_data, "timeout": timeout}
        self.node_run_repo.update(node_run)

        seq += 1
        self._emit_event(
            run_id,
            "NODE_WAITING",
            state_name,
            {"node": state_name, "event": event_data, "timeout": timeout},
            seq,
        )

        # Store waiting state for resume
        with self._lock:
            if run_id not in self._waiting_nodes:
                self._waiting_nodes[run_id] = {}
            self._waiting_nodes[run_id][state_name] = {
                "states": states,
                "context": context,
                "next_seq": seq + 1,
            }

        # Update run status
        run = self.run_repo.get(run_id)
        run.status = RunStatus.WAITING
        self.run_repo.update(run)

        return seq

    def _execute_pass(
        self,
        run_id: str,
        state_name: str,
        node_def: dict[str, Any],
        node_run: NodeRun,
        seq: int,
    ) -> int:
        """Execute Pass state."""
        node_run.status = NodeStatus.SUCCEEDED
        node_run.finished_at = datetime.utcnow()
        node_run.duration_ms = 0
        node_run.output_json = {"result": "passed"}
        self.node_run_repo.update(node_run)

        seq += 1
        self._emit_event(run_id, "NODE_SUCCEEDED", state_name, {"node": state_name}, seq)
        return seq

    def cancel_execution(self, run_id: str) -> None:
        """Cancel execution."""
        run = self.run_repo.get(run_id)
        if not run:
            return

        if run.status in (RunStatus.SUCCESS, RunStatus.FAILED, RunStatus.CANCELED):
            return

        run.status = RunStatus.CANCELED
        run.finished_at = datetime.utcnow()
        self.run_repo.update(run)

        seq = self.run_event_repo.get_max_seq(run_id) or 0
        seq += 1
        self._emit_event(run_id, "RUN_CANCELED", None, {"run_id": run_id}, seq)

        # Clear waiting nodes
        with self._lock:
            if run_id in self._waiting_nodes:
                del self._waiting_nodes[run_id]

    def resume_wait(self, run_id: str, state_name: str, payload: dict[str, Any]) -> None:
        """Resume a waiting node."""
        with self._lock:
            if run_id not in self._waiting_nodes or state_name not in self._waiting_nodes[run_id]:
                return

            wait_info = self._waiting_nodes[run_id][state_name]
            states = wait_info["states"]
            context = wait_info["context"]
            next_seq = wait_info["next_seq"]

            # Remove from waiting
            del self._waiting_nodes[run_id][state_name]
            if not self._waiting_nodes[run_id]:
                del self._waiting_nodes[run_id]

        # Get node run
        node_run = self.node_run_repo.get_by_run_and_state(run_id, state_name)
        if not node_run or node_run.status != NodeStatus.WAITING:
            return

        # Transition to running
        node_run.status = NodeStatus.RUNNING
        node_run.started_at = datetime.utcnow()
        self.node_run_repo.update(node_run)

        seq = next_seq
        self._emit_event(
            run_id,
            "NODE_STARTED",
            state_name,
            {"node": state_name, "resumed": True, "payload": payload},
            seq,
        )

        # Simulate completion
        time.sleep(0.2)

        node_run.status = NodeStatus.SUCCEEDED
        node_run.finished_at = datetime.utcnow()
        node_run.duration_ms = 200
        node_run.output_json = {"result": "resumed", "payload": payload}
        self.node_run_repo.update(node_run)

        seq += 1
        self._emit_event(run_id, "NODE_SUCCEEDED", state_name, {"node": state_name}, seq)

        # Continue execution
        node_def = states.get(state_name, {})
        next_node = node_def.get("Next")

        if next_node:
            self._execute_node(run_id, next_node, states, context, seq + 1)
        elif node_def.get("End"):
            run = self.run_repo.get(run_id)
            run.status = RunStatus.SUCCESS
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)

            seq += 1
            self._emit_event(run_id, "RUN_SUCCEEDED", None, {"run_id": run_id}, seq)
        else:
            raise ValueError(f"Wait state '{state_name}' has neither Next nor End after resume")

    def _emit_event(
        self,
        run_id: str,
        event_type: str,
        state_name: str | None,
        payload: dict[str, Any],
        seq: int | None = None,
    ):
        """Emit a run event."""
        if seq is None:
            seq = (self.run_event_repo.get_max_seq(run_id) or 0) + 1

        event = RunEvent(
            event_id=str(uuid.uuid4()),
            run_id=run_id,
            seq=seq,
            timestamp=datetime.utcnow(),
            event_type=event_type,
            state_name=state_name,
            payload_json=payload,
        )
        self.run_event_repo.create(event)
