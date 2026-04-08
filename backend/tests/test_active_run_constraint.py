"""Test global active-run policy in RunService."""

import time

import pytest

from app.adapters.execution_engine import DummyExecutionEngineAdapter
from app.domain.models import RunStatus
from app.services.run_service import RunService
from app.services.workflow_service import WorkflowService


_MIN_DSL = {
    "StartAt": "State1",
    "States": {
        "State1": {"Type": "Task", "Next": "State2"},
        "State2": {"Type": "Task", "End": True},
    },
}


def test_one_active_run_constraint(
    workflow_repo, version_repo, view_repo, run_repo, node_run_repo, run_event_repo
):
    """Match RunService: same workflow returns existing active run; other workflow raises."""
    workflow_service = WorkflowService(
        workflow_repo,
        version_repo,
        view_repo,
        run_repo,
        node_run_repo,
        run_event_repo,
    )
    execution_adapter = DummyExecutionEngineAdapter(
        run_repo, node_run_repo, run_event_repo, workflow_repo, version_repo
    )
    run_service = RunService(
        run_repo,
        node_run_repo,
        run_event_repo,
        workflow_repo,
        version_repo,
        execution_adapter,
    )

    workflow_a = workflow_service.create_workflow("Workflow A")
    workflow_service.save_draft(workflow_a.workflow_id, _MIN_DSL, {})
    workflow_service.publish_workflow(workflow_a.workflow_id)

    run_a = run_service.start_run(workflow_a.workflow_id)
    assert run_a is not None

    # Second start for the same workflow returns the same run (monitor redirect semantics)
    run_a_dup = run_service.start_run(workflow_a.workflow_id)
    assert run_a_dup is not None
    assert run_a_dup.run_id == run_a.run_id

    workflow_b = workflow_service.create_workflow("Workflow B")
    workflow_service.save_draft(workflow_b.workflow_id, _MIN_DSL, {})
    workflow_service.publish_workflow(workflow_b.workflow_id)

    with pytest.raises(ValueError, match="Another run is already active"):
        run_service.start_run(workflow_b.workflow_id)

    time.sleep(2)

    run_a_updated = run_service.get_run(run_a.run_id)
    assert run_a_updated.status in (
        RunStatus.SUCCESS,
        RunStatus.FAILED,
        RunStatus.RUNNING,
        RunStatus.WAITING,
    )

    if run_a_updated.status in (RunStatus.SUCCESS, RunStatus.FAILED, RunStatus.CANCELED):
        run_b = run_service.start_run(workflow_b.workflow_id)
        assert run_b is not None
        assert run_b.run_id != run_a.run_id
