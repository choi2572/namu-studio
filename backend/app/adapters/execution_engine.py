"""Dummy ExecutionEngineAdapter for simulation."""
import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from abc import ABC, abstractmethod

from app.domain.models import Run, NodeRun, RunEvent, RunStatus, NodeStatus


class ExecutionEngineAdapter(ABC):
    """Interface for execution engine adapter."""
    
    @abstractmethod
    def start_execution(
        self,
        run_id: str,
        workflow_dsl: Dict[str, Any],
        run_input: Optional[Dict[str, Any]] = None
    ) -> None:
        """Start execution (non-blocking)."""
        pass
    
    @abstractmethod
    def cancel_execution(self, run_id: str) -> None:
        """Cancel execution."""
        pass
    
    @abstractmethod
    def resume_wait(
        self,
        run_id: str,
        state_name: str,
        payload: Dict[str, Any]
    ) -> None:
        """Resume a waiting node."""
        pass


class DummyExecutionEngineAdapter(ExecutionEngineAdapter):
    """Dummy adapter that simulates execution."""
    
    def __init__(
        self,
        run_repo,
        node_run_repo,
        run_event_repo,
        workflow_repo,
        workflow_version_repo
    ):
        self.run_repo = run_repo
        self.node_run_repo = node_run_repo
        self.run_event_repo = run_event_repo
        self.workflow_repo = workflow_repo
        self.workflow_version_repo = workflow_version_repo
        self._running_tasks: Dict[str, asyncio.Task] = {}
    
    def start_execution(
        self,
        run_id: str,
        workflow_dsl: Dict[str, Any],
        run_input: Optional[Dict[str, Any]] = None
    ) -> None:
        """Start execution simulation."""
        # This will run in background
        import threading
        thread = threading.Thread(
            target=self._simulate_execution,
            args=(run_id, workflow_dsl, run_input),
            daemon=True
        )
        thread.start()
    
    def _simulate_execution(
        self,
        run_id: str,
        workflow_dsl: Dict[str, Any],
        run_input: Optional[Dict[str, Any]]
    ):
        """Simulate execution in a separate thread."""
        import time
        
        run = self.run_repo.get(run_id)
        if not run:
            return
        
        # Update run status
        run.status = RunStatus.RUNNING
        run.started_at = datetime.utcnow()
        self.run_repo.update(run)
        
        # Create initial events
        self._emit_event(run_id, "RUN_CREATED", None, {"run_id": run_id})
        self._emit_event(run_id, "RUN_STARTED", None, {"run_id": run_id})
        
        # Get start node
        start_at = workflow_dsl.get("StartAt")
        if not start_at:
            run.status = RunStatus.FAILED
            run.failure_code = "NO_START_NODE"
            run.failure_message = "Workflow has no StartAt"
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)
            self._emit_event(run_id, "RUN_FAILED", None, {"reason": "No StartAt"})
            return
        
        states = workflow_dsl.get("States", {})
        if start_at not in states:
            run.status = RunStatus.FAILED
            run.failure_code = "INVALID_START_NODE"
            run.failure_message = f"StartAt node '{start_at}' not found"
            run.finished_at = datetime.utcnow()
            self.run_repo.update(run)
            self._emit_event(run_id, "RUN_FAILED", None, {"reason": "Invalid StartAt"})
            return
        
        # Simulate node execution
        current_node = start_at
        visited = set()
        seq = self.run_event_repo.get_max_seq(run_id)
        
        while current_node and current_node not in visited:
            visited.add(current_node)
            node_def = states.get(current_node, {})
            node_type = node_def.get("Type", "Task")
            
            # Create node run
            node_run_id = f"{run_id}-{current_node}"
            node_run = NodeRun(
                node_run_id=node_run_id,
                run_id=run_id,
                state_name=current_node,
                node_type=node_type,
                status=NodeStatus.RUNNING,
                started_at=datetime.utcnow(),
                input_json=run_input if current_node == start_at else None
            )
            self.node_run_repo.create(node_run)
            
            seq += 1
            self._emit_event(run_id, "NODE_STARTED", current_node, {"node": current_node}, seq)
            
            # Simulate execution time
            time.sleep(0.5)
            
            # Determine outcome (simulate some failures)
            should_fail = current_node.endswith("_fail") or "fail" in current_node.lower()
            
            if should_fail:
                node_run.status = NodeStatus.FAILED
                node_run.finished_at = datetime.utcnow()
                node_run.duration_ms = 500
                node_run.feedback_json = {"error": "Simulated failure"}
                self.node_run_repo.update(node_run)
                
                seq += 1
                self._emit_event(run_id, "NODE_FAILED", current_node, {"node": current_node}, seq)
                
                run.status = RunStatus.FAILED
                run.failure_code = "NODE_FAILED"
                run.failure_message = f"Node {current_node} failed"
                run.finished_at = datetime.utcnow()
                self.run_repo.update(run)
                
                seq += 1
                self._emit_event(run_id, "RUN_FAILED", None, {"reason": f"Node {current_node} failed"}, seq)
                return
            
            # Success
            node_run.status = NodeStatus.SUCCEEDED
            node_run.finished_at = datetime.utcnow()
            node_run.duration_ms = 500
            node_run.output_json = {"result": "success"}
            self.node_run_repo.update(node_run)
            
            seq += 1
            self._emit_event(run_id, "NODE_SUCCEEDED", current_node, {"node": current_node}, seq)
            
            # Determine next node
            next_node = node_def.get("Next")
            if node_type == "Choice" or node_type == "Condition":
                # For condition, pick a branch (simulate True)
                choices = node_def.get("Choices", [])
                if choices:
                    # Take first choice (True branch)
                    next_node = choices[0].get("Next")
            
            current_node = next_node
        
        # Success
        run.status = RunStatus.SUCCESS
        run.finished_at = datetime.utcnow()
        self.run_repo.update(run)
        
        seq += 1
        self._emit_event(run_id, "RUN_SUCCEEDED", None, {"run_id": run_id}, seq)
    
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
        
        seq = self.run_event_repo.get_max_seq(run_id) + 1
        self._emit_event(run_id, "RUN_CANCELED", None, {"run_id": run_id}, seq)
    
    def resume_wait(
        self,
        run_id: str,
        state_name: str,
        payload: Dict[str, Any]
    ) -> None:
        """Resume a waiting node."""
        node_run = self.node_run_repo.get_by_run_and_state(run_id, state_name)
        if not node_run or node_run.status != NodeStatus.WAITING:
            return
        
        # Transition to running
        node_run.status = NodeStatus.RUNNING
        node_run.started_at = datetime.utcnow()
        self.node_run_repo.update(node_run)
        
        seq = self.run_event_repo.get_max_seq(run_id) + 1
        self._emit_event(run_id, "NODE_STARTED", state_name, {"node": state_name, "resumed": True}, seq)
        
        # Continue execution (simplified)
        # In real implementation, this would continue the workflow
        node_run.status = NodeStatus.SUCCEEDED
        node_run.finished_at = datetime.utcnow()
        self.node_run_repo.update(node_run)
        
        seq += 1
        self._emit_event(run_id, "NODE_SUCCEEDED", state_name, {"node": state_name}, seq)
    
    def _emit_event(
        self,
        run_id: str,
        event_type: str,
        state_name: Optional[str],
        payload: Dict[str, Any],
        seq: Optional[int] = None
    ):
        """Emit a run event."""
        if seq is None:
            seq = self.run_event_repo.get_max_seq(run_id) + 1
        
        event = RunEvent(
            event_id=str(uuid.uuid4()),
            run_id=run_id,
            seq=seq,
            timestamp=datetime.utcnow(),
            event_type=event_type,
            state_name=state_name,
            payload_json=payload
        )
        self.run_event_repo.create(event)
