"""In-memory repository implementations."""
from typing import Dict, List, Optional
from datetime import datetime

from app.domain.models import (
    Workflow,
    WorkflowVersion,
    WorkflowView,
    Run,
    NodeRun,
    RunEvent,
    RunStatus,
)
from app.repos.interfaces import (
    WorkflowRepository,
    WorkflowVersionRepository,
    WorkflowViewRepository,
    RunRepository,
    NodeRunRepository,
    RunEventRepository,
)


class InMemoryWorkflowRepository(WorkflowRepository):
    """In-memory workflow repository."""
    
    def __init__(self):
        self._workflows: Dict[str, Workflow] = {}

    def clear(self) -> None:
        """Clear all workflows."""
        self._workflows.clear()
    
    def create(self, workflow: Workflow) -> Workflow:
        self._workflows[workflow.workflow_id] = workflow
        return workflow
    
    def get(self, workflow_id: str) -> Optional[Workflow]:
        return self._workflows.get(workflow_id)
    
    def list_all(self) -> List[Workflow]:
        return list(self._workflows.values())
    
    def update(self, workflow: Workflow) -> Workflow:
        workflow.updated_at = datetime.utcnow()
        self._workflows[workflow.workflow_id] = workflow
        return workflow

    def delete(self, workflow_id: str) -> None:
        self._workflows.pop(workflow_id, None)


class InMemoryWorkflowVersionRepository(WorkflowVersionRepository):
    """In-memory workflow version repository."""
    
    def __init__(self):
        self._versions: Dict[str, WorkflowVersion] = {}

    def clear(self) -> None:
        """Clear all versions."""
        self._versions.clear()
    
    def create(self, version: WorkflowVersion) -> WorkflowVersion:
        self._versions[version.version_id] = version
        return version
    
    def get(self, version_id: str) -> Optional[WorkflowVersion]:
        return self._versions.get(version_id)
    
    def get_by_workflow(self, workflow_id: str) -> List[WorkflowVersion]:
        return [v for v in self._versions.values() if v.workflow_id == workflow_id]
    
    def get_latest_draft(self, workflow_id: str) -> Optional[WorkflowVersion]:
        drafts = [
            v for v in self._versions.values()
            if v.workflow_id == workflow_id and v.state.value == "DRAFT"
        ]
        if not drafts:
            return None
        return max(drafts, key=lambda v: v.created_at)
    
    def update(self, version: WorkflowVersion) -> WorkflowVersion:
        self._versions[version.version_id] = version
        return version

    def delete(self, version_id: str) -> None:
        self._versions.pop(version_id, None)


class InMemoryWorkflowViewRepository(WorkflowViewRepository):
    """In-memory workflow view repository."""
    
    def __init__(self):
        self._views: Dict[str, WorkflowView] = {}

    def clear(self) -> None:
        """Clear all views."""
        self._views.clear()
    
    def get(self, version_id: str) -> Optional[WorkflowView]:
        return self._views.get(version_id)
    
    def save(self, view: WorkflowView) -> WorkflowView:
        view.updated_at = datetime.utcnow()
        self._views[view.version_id] = view
        return view

    def delete(self, version_id: str) -> None:
        self._views.pop(version_id, None)


class InMemoryRunRepository(RunRepository):
    """In-memory run repository."""
    
    def __init__(self):
        self._runs: Dict[str, Run] = {}

    def clear(self) -> None:
        """Clear all runs."""
        self._runs.clear()
    
    def create(self, run: Run) -> Run:
        self._runs[run.run_id] = run
        return run
    
    def get(self, run_id: str) -> Optional[Run]:
        return self._runs.get(run_id)
    
    def list_all(self, filters: Optional[dict] = None) -> List[Run]:
        runs = list(self._runs.values())
        if filters:
            if "status" in filters:
                runs = [r for r in runs if r.status == filters["status"]]
            if "workflow_id" in filters:
                runs = [r for r in runs if r.workflow_id == filters["workflow_id"]]
        return sorted(runs, key=lambda r: r.created_at, reverse=True)
    
    def get_active_run(self) -> Optional[Run]:
        for run in self._runs.values():
            if run.status in (RunStatus.RUNNING, RunStatus.WAITING):
                return run
        return None
    
    def update(self, run: Run) -> Run:
        run.updated_at = datetime.utcnow()
        self._runs[run.run_id] = run
        return run

    def delete(self, run_id: str) -> None:
        self._runs.pop(run_id, None)


class InMemoryNodeRunRepository(NodeRunRepository):
    """In-memory node run repository."""
    
    def __init__(self):
        self._node_runs: Dict[str, NodeRun] = {}

    def clear(self) -> None:
        """Clear all node runs."""
        self._node_runs.clear()
    
    def create(self, node_run: NodeRun) -> NodeRun:
        self._node_runs[node_run.node_run_id] = node_run
        return node_run
    
    def get(self, node_run_id: str) -> Optional[NodeRun]:
        return self._node_runs.get(node_run_id)
    
    def get_by_run(self, run_id: str) -> List[NodeRun]:
        return [nr for nr in self._node_runs.values() if nr.run_id == run_id]
    
    def get_by_run_and_state(self, run_id: str, state_name: str) -> Optional[NodeRun]:
        for nr in self._node_runs.values():
            if nr.run_id == run_id and nr.state_name == state_name:
                return nr
        return None
    
    def update(self, node_run: NodeRun) -> NodeRun:
        self._node_runs[node_run.node_run_id] = node_run
        return node_run

    def delete_by_run(self, run_id: str) -> None:
        to_delete = [nr_id for nr_id, nr in self._node_runs.items() if nr.run_id == run_id]
        for nr_id in to_delete:
          self._node_runs.pop(nr_id, None)


class InMemoryRunEventRepository(RunEventRepository):
    """In-memory run event repository."""
    
    def __init__(self):
        self._events: Dict[str, RunEvent] = {}
        self._run_events: Dict[str, List[RunEvent]] = {}  # run_id -> events

    def clear(self) -> None:
        """Clear all events."""
        self._events.clear()
        self._run_events.clear()
    
    def create(self, event: RunEvent) -> RunEvent:
        self._events[event.event_id] = event
        if event.run_id not in self._run_events:
            self._run_events[event.run_id] = []
        self._run_events[event.run_id].append(event)
        # Keep events sorted by seq
        self._run_events[event.run_id].sort(key=lambda e: e.seq)
        return event
    
    def get_by_run(self, run_id: str, after_seq: Optional[int] = None) -> List[RunEvent]:
        events = self._run_events.get(run_id, [])
        if after_seq is not None:
            events = [e for e in events if e.seq > after_seq]
        return sorted(events, key=lambda e: e.seq)
    
    def get_max_seq(self, run_id: str) -> int:
        events = self._run_events.get(run_id, [])
        if not events:
            return 0
        return max(e.seq for e in events)

    def delete_by_run(self, run_id: str) -> None:
        # Remove all events for the run
        self._run_events.pop(run_id, None)
        # Also clean up flat event map
        to_delete = [event_id for event_id, event in self._events.items() if event.run_id == run_id]
        for event_id in to_delete:
            self._events.pop(event_id, None)
