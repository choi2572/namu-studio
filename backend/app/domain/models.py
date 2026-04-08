"""Domain models (dataclasses)."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class WorkflowState(str, Enum):
    """Workflow state."""

    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"


class VersionState(str, Enum):
    """Version state."""

    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"


class RunStatus(str, Enum):
    """Run status."""

    CREATED = "CREATED"
    RUNNING = "RUNNING"
    WAITING = "WAITING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class NodeStatus(str, Enum):
    """Node status."""

    READY = "READY"
    RUNNING = "RUNNING"
    WAITING = "WAITING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCELED = "CANCELED"


@dataclass
class Workflow:
    """Workflow entity."""

    workflow_id: str
    name: str
    description: str | None = None
    state: WorkflowState = WorkflowState.DRAFT
    current_published_version_id: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class WorkflowVersion:
    """Workflow version entity."""

    version_id: str
    workflow_id: str
    version_number: str
    state: VersionState = VersionState.DRAFT
    dsl_json: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)
    published_at: datetime | None = None


@dataclass
class WorkflowView:
    """Workflow view (editor layout)."""

    version_id: str
    view_json: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class Run:
    """Run (execution instance)."""

    run_id: str
    workflow_id: str
    version_id: str
    trigger_type: str = "MANUAL"
    trigger_meta_json: dict[str, Any] | None = None
    run_input_json: dict[str, Any] | None = None
    status: RunStatus = RunStatus.CREATED
    failure_code: str | None = None
    failure_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    # Middleware execution: workflow_id from middleware (e.g. wf_1753xxxxxx)
    middleware_workflow_id: str | None = None


@dataclass
class NodeRun:
    """Node run (per node execution record)."""

    node_run_id: str
    run_id: str
    state_name: str
    node_type: str
    attempt: int = 1
    status: NodeStatus = NodeStatus.READY
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    input_json: dict[str, Any] | None = None
    output_json: dict[str, Any] | None = None
    state_snapshot_json: dict[str, Any] | None = None
    feedback_json: dict[str, Any] | None = None
    decision_json: dict[str, Any] | None = None


@dataclass
class RunEvent:
    """Run event (timeline entry)."""

    event_id: str
    run_id: str
    seq: int
    timestamp: datetime
    event_type: str
    state_name: str | None = None
    payload_json: dict[str, Any] | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
