"""Deterministic seed data for in-memory repositories."""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from app.domain.models import (
    Workflow,
    WorkflowVersion,
    WorkflowView,
    WorkflowState,
    VersionState,
    Run,
    NodeRun,
    RunEvent,
    RunStatus,
    NodeStatus,
)
from app.repos.interfaces import (
    WorkflowRepository,
    WorkflowVersionRepository,
    WorkflowViewRepository,
    RunRepository,
    NodeRunRepository,
    RunEventRepository,
)


@dataclass(frozen=True)
class SeedIds:
    """Stable IDs used across seeded data."""
    workflow_draft_id: str = "wf-seed-draft"
    workflow_published_id: str = "wf-seed-published"
    draft_version_id: str = "wfv-seed-draft-v1"
    published_version_id: str = "wfv-seed-published-v1"
    run_success_id: str = "run-seed-success"
    run_failed_id: str = "run-seed-failed"
    node_fetch_state: str = "FetchData"
    node_transform_state: str = "TransformData"
    node_process_state: str = "ProcessData"


SEED_IDS = SeedIds()
SEED_FAILURE_CODE = "NODE_FAILED"
SEED_FAILURE_MESSAGE = "TransformData failed validation"

SEED_BASE_TIME = datetime(2024, 1, 15, 9, 0, 0)

PUBLISHED_DSL = {
    "StartAt": SEED_IDS.node_fetch_state,
    "States": {
        SEED_IDS.node_fetch_state: {
            "Type": "Task",
            "Next": SEED_IDS.node_transform_state,
            "Label": "Fetch Data",
        },
        SEED_IDS.node_transform_state: {
            "Type": "Task",
            "Next": SEED_IDS.node_process_state,
            "Label": "Transform Data",
        },
        SEED_IDS.node_process_state: {
            "Type": "Task",
            "End": True,
            "Label": "Process Data",
        },
    },
}

DRAFT_DSL = {
    "StartAt": "DraftStart",
    "States": {
        "DraftStart": {"Type": "Task", "End": True, "Label": "Draft Start"},
    },
}

PUBLISHED_VIEW = {
    "version": "v1",
    "nodes": [
        {
            "id": "node-1",
            "name": SEED_IDS.node_fetch_state,
            "kind": "skill.pick",
            "position": {"x": 140, "y": 120},
            "isExpanded": False,
            "params": {"target": "bin-A", "quantity": "1"},
        },
        {
            "id": "node-2",
            "name": SEED_IDS.node_transform_state,
            "kind": "skill.place",
            "position": {"x": 380, "y": 120},
            "isExpanded": False,
            "params": {"destination": "slot-3", "orientation": "north"},
        },
        {
            "id": "node-3",
            "name": SEED_IDS.node_process_state,
            "kind": "event.webhook",
            "position": {"x": 620, "y": 120},
            "isExpanded": False,
            "params": {"url": "https://hooks.example/process", "method": "POST"},
        },
    ],
    "edges": [
        {"id": "edge-1", "from": "node-1", "fromPort": "next", "to": "node-2"},
        {"id": "edge-2", "from": "node-2", "fromPort": "next", "to": "node-3"},
    ],
    "canvas": {"width": 1000, "height": 600, "zoom": 1},
}

DRAFT_VIEW = {
    "version": "v1",
    "nodes": [
        {
            "id": "node-1",
            "name": "DraftStart",
            "kind": "skill.pick",
            "position": {"x": 180, "y": 160},
            "isExpanded": False,
            "params": {"target": "bin-A", "quantity": "1"},
        },
    ],
    "edges": [],
    "canvas": {"width": 1000, "height": 600, "zoom": 1},
}


def seed_data(
    workflow_repo: WorkflowRepository,
    version_repo: WorkflowVersionRepository,
    view_repo: Optional[WorkflowViewRepository] = None,
    run_repo: Optional[RunRepository] = None,
    node_run_repo: Optional[NodeRunRepository] = None,
    run_event_repo: Optional[RunEventRepository] = None,
    reset: bool = False,
) -> SeedIds:
    """Seed deterministic data into repositories."""
    if reset:
        _reset_repositories(
            workflow_repo,
            version_repo,
            view_repo,
            run_repo,
            node_run_repo,
            run_event_repo,
        )

    _seed_workflows(workflow_repo, version_repo, view_repo)

    if run_repo and node_run_repo and run_event_repo:
        _seed_runs(
            workflow_repo,
            version_repo,
            run_repo,
            node_run_repo,
            run_event_repo,
        )

    return SEED_IDS


def _reset_repositories(
    workflow_repo: WorkflowRepository,
    version_repo: WorkflowVersionRepository,
    view_repo: Optional[WorkflowViewRepository],
    run_repo: Optional[RunRepository],
    node_run_repo: Optional[NodeRunRepository],
    run_event_repo: Optional[RunEventRepository],
) -> None:
    for repo in (
        workflow_repo,
        version_repo,
        view_repo,
        run_repo,
        node_run_repo,
        run_event_repo,
    ):
        if repo is None:
            continue
        clear_fn = getattr(repo, "clear", None)
        if callable(clear_fn):
            clear_fn()


def _seed_workflows(
    workflow_repo: WorkflowRepository,
    version_repo: WorkflowVersionRepository,
    view_repo: Optional[WorkflowViewRepository],
) -> None:
    draft_created = SEED_BASE_TIME + timedelta(minutes=5)
    draft_updated = SEED_BASE_TIME + timedelta(minutes=8)
    published_created = SEED_BASE_TIME + timedelta(minutes=15)
    published_updated = SEED_BASE_TIME + timedelta(minutes=18)

    if not workflow_repo.get(SEED_IDS.workflow_draft_id):
        workflow_repo.create(Workflow(
            workflow_id=SEED_IDS.workflow_draft_id,
            name="Seeded Draft Workflow",
            description="Draft workflow for local development.",
            state=WorkflowState.DRAFT,
            current_published_version_id=None,
            created_at=draft_created,
            updated_at=draft_updated,
        ))

    if not version_repo.get(SEED_IDS.draft_version_id):
        version_repo.create(WorkflowVersion(
            version_id=SEED_IDS.draft_version_id,
            workflow_id=SEED_IDS.workflow_draft_id,
            version_number="v1",
            state=VersionState.DRAFT,
            dsl_json=DRAFT_DSL,
            created_at=draft_created + timedelta(minutes=2),
            published_at=None,
        ))

    if view_repo and not view_repo.get(SEED_IDS.draft_version_id):
        view_repo.save(WorkflowView(
            version_id=SEED_IDS.draft_version_id,
            view_json=DRAFT_VIEW,
            created_at=draft_created + timedelta(minutes=3),
            updated_at=draft_updated,
        ))

    if not version_repo.get(SEED_IDS.published_version_id):
        version_repo.create(WorkflowVersion(
            version_id=SEED_IDS.published_version_id,
            workflow_id=SEED_IDS.workflow_published_id,
            version_number="v1",
            state=VersionState.PUBLISHED,
            dsl_json=PUBLISHED_DSL,
            created_at=published_created + timedelta(minutes=2),
            published_at=published_created + timedelta(minutes=4),
        ))

    if not workflow_repo.get(SEED_IDS.workflow_published_id):
        workflow_repo.create(Workflow(
            workflow_id=SEED_IDS.workflow_published_id,
            name="Seeded Published Workflow",
            description="Published workflow with sample runs.",
            state=WorkflowState.PUBLISHED,
            current_published_version_id=SEED_IDS.published_version_id,
            created_at=published_created,
            updated_at=published_updated,
        ))

    if view_repo and not view_repo.get(SEED_IDS.published_version_id):
        view_repo.save(WorkflowView(
            version_id=SEED_IDS.published_version_id,
            view_json=PUBLISHED_VIEW,
            created_at=published_created + timedelta(minutes=3),
            updated_at=published_updated,
        ))


def _seed_runs(
    workflow_repo: WorkflowRepository,
    version_repo: WorkflowVersionRepository,
    run_repo: RunRepository,
    node_run_repo: NodeRunRepository,
    run_event_repo: RunEventRepository,
) -> None:
    success_created = SEED_BASE_TIME + timedelta(hours=3, minutes=10)
    success_started = success_created + timedelta(minutes=2)
    success_finished = success_started + timedelta(minutes=3)

    failed_created = SEED_BASE_TIME + timedelta(hours=4, minutes=5)
    failed_started = failed_created + timedelta(minutes=1)
    failed_finished = failed_started + timedelta(minutes=1)

    if not run_repo.get(SEED_IDS.run_success_id):
        run_repo.create(Run(
            run_id=SEED_IDS.run_success_id,
            workflow_id=SEED_IDS.workflow_published_id,
            version_id=SEED_IDS.published_version_id,
            trigger_type="MANUAL",
            run_input_json={"source": "seed", "requestedBy": "local"},
            status=RunStatus.SUCCESS,
            started_at=success_started,
            finished_at=success_finished,
            created_at=success_created,
            updated_at=success_finished,
        ))

    if not run_repo.get(SEED_IDS.run_failed_id):
        run_repo.create(Run(
            run_id=SEED_IDS.run_failed_id,
            workflow_id=SEED_IDS.workflow_published_id,
            version_id=SEED_IDS.published_version_id,
            trigger_type="MANUAL",
            run_input_json={"source": "seed", "requestedBy": "local"},
            status=RunStatus.FAILED,
            failure_code=SEED_FAILURE_CODE,
            failure_message=SEED_FAILURE_MESSAGE,
            started_at=failed_started,
            finished_at=failed_finished,
            created_at=failed_created,
            updated_at=failed_finished,
        ))

    _seed_node_runs(node_run_repo, success_started, success_finished, failed_started, failed_finished)
    _seed_events(run_event_repo, success_started, success_finished, failed_started, failed_finished)


def _seed_node_runs(
    node_run_repo: NodeRunRepository,
    success_started: datetime,
    success_finished: datetime,
    failed_started: datetime,
    failed_finished: datetime,
) -> None:
    fetch_id = f"{SEED_IDS.run_success_id}-{SEED_IDS.node_fetch_state}"
    transform_id = f"{SEED_IDS.run_success_id}-{SEED_IDS.node_transform_state}"
    process_id = f"{SEED_IDS.run_success_id}-{SEED_IDS.node_process_state}"
    failed_node_id = f"{SEED_IDS.run_failed_id}-{SEED_IDS.node_transform_state}"

    if not node_run_repo.get(fetch_id):
        node_run_repo.create(NodeRun(
            node_run_id=fetch_id,
            run_id=SEED_IDS.run_success_id,
            state_name=SEED_IDS.node_fetch_state,
            node_type="Task",
            status=NodeStatus.SUCCEEDED,
            started_at=success_started,
            finished_at=success_started + timedelta(seconds=30),
            duration_ms=30000,
            input_json={"source": "seed", "path": "/tmp/input.csv"},
            output_json={"rows": 128, "checksum": "abc123"},
            feedback_json={"warnings": []},
            decision_json={"cached": False},
        ))

    if not node_run_repo.get(transform_id):
        node_run_repo.create(NodeRun(
            node_run_id=transform_id,
            run_id=SEED_IDS.run_success_id,
            state_name=SEED_IDS.node_transform_state,
            node_type="Task",
            status=NodeStatus.SUCCEEDED,
            started_at=success_started + timedelta(seconds=35),
            finished_at=success_started + timedelta(seconds=75),
            duration_ms=40000,
            input_json={"rows": 128},
            output_json={"rows": 120, "quality": "ok"},
            feedback_json={"notes": ["normalized values"]},
            decision_json={"retry": False},
        ))

    if not node_run_repo.get(process_id):
        node_run_repo.create(NodeRun(
            node_run_id=process_id,
            run_id=SEED_IDS.run_success_id,
            state_name=SEED_IDS.node_process_state,
            node_type="Task",
            status=NodeStatus.SUCCEEDED,
            started_at=success_started + timedelta(seconds=80),
            finished_at=success_finished,
            duration_ms=int((success_finished - (success_started + timedelta(seconds=80))).total_seconds() * 1000),
            input_json={"rows": 120},
            output_json={"processed": 120, "status": "complete"},
            feedback_json={"summary": "seeded run complete"},
        ))

    if not node_run_repo.get(failed_node_id):
        node_run_repo.create(NodeRun(
            node_run_id=failed_node_id,
            run_id=SEED_IDS.run_failed_id,
            state_name=SEED_IDS.node_transform_state,
            node_type="Task",
            status=NodeStatus.FAILED,
            started_at=failed_started,
            finished_at=failed_finished,
            duration_ms=int((failed_finished - failed_started).total_seconds() * 1000),
            input_json={"rows": 64},
            output_json=None,
            feedback_json={"error": "ValidationError", "field": "quality"},
        ))


def _seed_events(
    run_event_repo: RunEventRepository,
    success_started: datetime,
    success_finished: datetime,
    failed_started: datetime,
    failed_finished: datetime,
) -> None:
    if not run_event_repo.get_by_run(SEED_IDS.run_success_id):
        success_events = [
            ("RUN_CREATED", None, {"runId": SEED_IDS.run_success_id}, success_started - timedelta(seconds=5)),
            ("RUN_STARTED", None, {"runId": SEED_IDS.run_success_id}, success_started),
            ("NODE_STARTED", SEED_IDS.node_fetch_state, {"node": SEED_IDS.node_fetch_state}, success_started + timedelta(seconds=5)),
            ("NODE_SUCCEEDED", SEED_IDS.node_fetch_state, {"node": SEED_IDS.node_fetch_state}, success_started + timedelta(seconds=30)),
            ("NODE_STARTED", SEED_IDS.node_transform_state, {"node": SEED_IDS.node_transform_state}, success_started + timedelta(seconds=35)),
            ("NODE_SUCCEEDED", SEED_IDS.node_transform_state, {"node": SEED_IDS.node_transform_state}, success_started + timedelta(seconds=75)),
            ("NODE_STARTED", SEED_IDS.node_process_state, {"node": SEED_IDS.node_process_state}, success_started + timedelta(seconds=80)),
            ("NODE_SUCCEEDED", SEED_IDS.node_process_state, {"node": SEED_IDS.node_process_state}, success_started + timedelta(seconds=170)),
            ("RUN_SUCCEEDED", None, {"runId": SEED_IDS.run_success_id}, success_finished),
        ]
        _create_events(SEED_IDS.run_success_id, success_events, run_event_repo)

    if not run_event_repo.get_by_run(SEED_IDS.run_failed_id):
        failed_events = [
            ("RUN_CREATED", None, {"runId": SEED_IDS.run_failed_id}, failed_started - timedelta(seconds=5)),
            ("RUN_STARTED", None, {"runId": SEED_IDS.run_failed_id}, failed_started),
            ("NODE_STARTED", SEED_IDS.node_transform_state, {"node": SEED_IDS.node_transform_state}, failed_started + timedelta(seconds=3)),
            ("NODE_FAILED", SEED_IDS.node_transform_state, {"node": SEED_IDS.node_transform_state}, failed_started + timedelta(seconds=30)),
            ("RUN_FAILED", None, {"reason": SEED_FAILURE_MESSAGE}, failed_finished),
        ]
        _create_events(SEED_IDS.run_failed_id, failed_events, run_event_repo)


def _create_events(
    run_id: str,
    events: list,
    run_event_repo: RunEventRepository,
) -> None:
    for seq, (event_type, state_name, payload, timestamp) in enumerate(events, start=1):
        run_event_repo.create(RunEvent(
            event_id=f"{run_id}-event-{seq}",
            run_id=run_id,
            seq=seq,
            timestamp=timestamp,
            event_type=event_type,
            state_name=state_name,
            payload_json=payload,
            created_at=timestamp,
        ))
