"""Repository interfaces."""
from abc import ABC, abstractmethod
from typing import List, Optional

from app.domain.models import (
    Workflow,
    WorkflowVersion,
    WorkflowView,
    Run,
    NodeRun,
    RunEvent,
    RunStatus,
)


class WorkflowRepository(ABC):
    """Workflow repository interface."""
    
    @abstractmethod
    def create(self, workflow: Workflow) -> Workflow:
        """Create a new workflow."""
        pass
    
    @abstractmethod
    def get(self, workflow_id: str) -> Optional[Workflow]:
        """Get workflow by ID."""
        pass
    
    @abstractmethod
    def list_all(self) -> List[Workflow]:
        """List all workflows."""
        pass
    
    @abstractmethod
    def update(self, workflow: Workflow) -> Workflow:
        """Update workflow."""
        pass

    @abstractmethod
    def delete(self, workflow_id: str) -> None:
        """Delete workflow by ID."""
        pass


class WorkflowVersionRepository(ABC):
    """Workflow version repository interface."""
    
    @abstractmethod
    def create(self, version: WorkflowVersion) -> WorkflowVersion:
        """Create a new version."""
        pass
    
    @abstractmethod
    def get(self, version_id: str) -> Optional[WorkflowVersion]:
        """Get version by ID."""
        pass
    
    @abstractmethod
    def get_by_workflow(self, workflow_id: str) -> List[WorkflowVersion]:
        """Get all versions for a workflow."""
        pass
    
    @abstractmethod
    def get_latest_draft(self, workflow_id: str) -> Optional[WorkflowVersion]:
        """Get latest draft version."""
        pass
    
    @abstractmethod
    def update(self, version: WorkflowVersion) -> WorkflowVersion:
        """Update version."""
        pass

    @abstractmethod
    def delete(self, version_id: str) -> None:
        """Delete version by ID."""
        pass


class WorkflowViewRepository(ABC):
    """Workflow view repository interface."""
    
    @abstractmethod
    def get(self, version_id: str) -> Optional[WorkflowView]:
        """Get view by version ID."""
        pass
    
    @abstractmethod
    def save(self, view: WorkflowView) -> WorkflowView:
        """Save or update view."""
        pass

    @abstractmethod
    def delete(self, version_id: str) -> None:
        """Delete view by version ID."""
        pass


class RunRepository(ABC):
    """Run repository interface."""
    
    @abstractmethod
    def create(self, run: Run) -> Run:
        """Create a new run."""
        pass
    
    @abstractmethod
    def get(self, run_id: str) -> Optional[Run]:
        """Get run by ID."""
        pass
    
    @abstractmethod
    def list_all(self, filters: Optional[dict] = None) -> List[Run]:
        """List all runs with optional filters."""
        pass
    
    @abstractmethod
    def get_active_run(self) -> Optional[Run]:
        """Get the currently active run (RUNNING or WAITING)."""
        pass
    
    @abstractmethod
    def update(self, run: Run) -> Run:
        """Update run."""
        pass

    @abstractmethod
    def delete(self, run_id: str) -> None:
        """Delete run by ID."""
        pass


class NodeRunRepository(ABC):
    """Node run repository interface."""
    
    @abstractmethod
    def create(self, node_run: NodeRun) -> NodeRun:
        """Create a new node run."""
        pass
    
    @abstractmethod
    def get(self, node_run_id: str) -> Optional[NodeRun]:
        """Get node run by ID."""
        pass
    
    @abstractmethod
    def get_by_run(self, run_id: str) -> List[NodeRun]:
        """Get all node runs for a run."""
        pass
    
    @abstractmethod
    def get_by_run_and_state(self, run_id: str, state_name: str) -> Optional[NodeRun]:
        """Get node run by run ID and state name."""
        pass
    
    @abstractmethod
    def update(self, node_run: NodeRun) -> NodeRun:
        """Update node run."""
        pass

    @abstractmethod
    def delete_by_run(self, run_id: str) -> None:
        """Delete all node runs for a run."""
        pass


class RunEventRepository(ABC):
    """Run event repository interface."""
    
    @abstractmethod
    def create(self, event: RunEvent) -> RunEvent:
        """Create a new event."""
        pass
    
    @abstractmethod
    def get_by_run(self, run_id: str, after_seq: Optional[int] = None) -> List[RunEvent]:
        """Get events for a run, optionally after a sequence number."""
        pass
    
    @abstractmethod
    def get_max_seq(self, run_id: str) -> int:
        """Get maximum sequence number for a run."""
        pass

    @abstractmethod
    def delete_by_run(self, run_id: str) -> None:
        """Delete all events for a run."""
        pass
