"""Run service (use cases)."""
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid

from app.utils.datetime_helpers import run_duration_ms
from app.domain.models import (
    Run,
    NodeRun,
    RunStatus,
    NodeStatus,
)
from app.repos.interfaces import (
    RunRepository,
    NodeRunRepository,
    RunEventRepository,
    WorkflowRepository,
    WorkflowVersionRepository,
)
from app.adapters.execution_engine import ExecutionEngineAdapter


class RunService:
    """Run service."""
    
    def __init__(
        self,
        run_repo: RunRepository,
        node_run_repo: NodeRunRepository,
        run_event_repo: RunEventRepository,
        workflow_repo: WorkflowRepository,
        workflow_version_repo: WorkflowVersionRepository,
        execution_adapter: ExecutionEngineAdapter,
    ):
        self.run_repo = run_repo
        self.node_run_repo = node_run_repo
        self.run_event_repo = run_event_repo
        self.workflow_repo = workflow_repo
        self.workflow_version_repo = workflow_version_repo
        self.execution_adapter = execution_adapter
    
    def start_run(
        self,
        workflow_id: str,
        run_input: Optional[Dict[str, Any]] = None
    ) -> Optional[Run]:
        """Start a run."""
        # Get workflow and published version first (for same-workflow redirect below)
        workflow = self.workflow_repo.get(workflow_id)
        if not workflow:
            return None

        # Check for active run; allow adapter to reconcile (e.g. middleware idle but DB still RUNNING)
        active_run = self.run_repo.get_active_run()
        if active_run:
            if self.execution_adapter.reconcile_stale_run(active_run):
                active_run = self.run_repo.get_active_run()
            if active_run:
                # Same workflow already running → return it so UI can redirect to its monitor
                if active_run.workflow_id == workflow_id:
                    return active_run
                raise ValueError("Another run is already active. Only one active run allowed at a time.")
        
        version_id = workflow.current_published_version_id
        if not version_id:
            raise ValueError("Workflow has no published version")
        
        version = self.workflow_version_repo.get(version_id)
        if not version:
            return None
        
        # Create run
        run = Run(
            run_id=str(uuid.uuid4()),
            workflow_id=workflow_id,
            version_id=version_id,
            trigger_type="MANUAL",
            run_input_json=run_input,
            status=RunStatus.CREATED,
        )
        run = self.run_repo.create(run)
        
        # Start execution
        self.execution_adapter.start_execution(
            run.run_id,
            version.dsl_json,
            run_input
        )
        
        return run
    
    def cancel_run(self, run_id: str) -> Optional[Run]:
        """Cancel a run."""
        run = self.run_repo.get(run_id)
        if not run:
            return None
        
        if run.status in (RunStatus.SUCCESS, RunStatus.FAILED, RunStatus.CANCELED):
            return run
        
        self.execution_adapter.cancel_execution(run_id)
        return self.run_repo.get(run_id)
    
    def resume_wait(
        self,
        run_id: str,
        state_name: str,
        payload: Dict[str, Any]
    ) -> bool:
        """Resume a waiting node."""
        run = self.run_repo.get(run_id)
        if not run:
            return False
        
        if run.status != RunStatus.WAITING:
            return False
        
        self.execution_adapter.resume_wait(run_id, state_name, payload)
        return True
    
    def list_runs(self, filters: Optional[Dict[str, Any]] = None) -> List[Run]:
        """List runs with optional filters."""
        return self.run_repo.list_all(filters)
    
    def get_run(self, run_id: str) -> Optional[Run]:
        """Get run by ID."""
        return self.run_repo.get(run_id)
    
    def get_run_snapshot(self, run_id: str) -> Optional[Dict[str, Any]]:
        """Get run snapshot for monitoring."""
        run = self.run_repo.get(run_id)
        if not run:
            return None
        
        workflow = self.workflow_repo.get(run.workflow_id)
        node_runs = self.node_run_repo.get_by_run(run_id)
        
        node_states = [
            {
                "stateName": nr.state_name,
                "nodeName": nr.state_name,
                "status": nr.status.value,
                "durationMs": nr.duration_ms,
            }
            for nr in node_runs
        ]
        
        return {
            "run": {
                "runId": run.run_id,
                "workflowId": run.workflow_id,
                "workflowName": workflow.name if workflow else "",
                "status": run.status.value,
                "startedAt": run.started_at.isoformat() if run.started_at else None,
                "durationMs": run_duration_ms(run.started_at, run.finished_at),
                "failureCode": run.failure_code,
                "failureMessage": run.failure_message,
            },
            "workflowName": workflow.name if workflow else "",
            "nodeStates": node_states,
        }
    
    def get_node_debug(self, run_id: str, state_name: str) -> Optional[Dict[str, Any]]:
        """Get node debug bundle."""
        node_run = self.node_run_repo.get_by_run_and_state(run_id, state_name)
        if not node_run:
            return None
        
        return {
            "runId": run_id,
            "stateName": node_run.state_name,
            "nodeName": node_run.state_name,
            "status": node_run.status.value,
            "durationMs": node_run.duration_ms,
            "input": node_run.input_json,
            "output": node_run.output_json,
            "feedback": node_run.feedback_json,
            "decision": node_run.decision_json,
        }
    
    def get_events(self, run_id: str, after_seq: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get run events."""
        events = self.run_event_repo.get_by_run(run_id, after_seq)
        return [
            {
                "eventId": e.event_id,
                "runId": e.run_id,
                "seq": e.seq,
                "timestamp": e.timestamp.isoformat(),
                "eventType": e.event_type,
                "stateName": e.state_name,
                "payload": e.payload_json,
            }
            for e in events
        ]
