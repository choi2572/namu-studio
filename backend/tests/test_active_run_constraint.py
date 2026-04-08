"""Test one active run constraint."""

import time

import pytest

from app.adapters.execution_engine import DummyExecutionEngineAdapter
from app.domain.models import RunStatus
from app.services.run_service import RunService
from app.services.workflow_service import WorkflowService


def test_one_active_run_constraint(workflow_repo, version_repo, view_repo, run_repo, node_run_repo, run_event_repo):
    """Test that only one active run is allowed at a time."""
    # Setup
    workflow_service = WorkflowService(workflow_repo, version_repo, view_repo)
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

    # Create and publish workflow
    workflow = workflow_service.create_workflow("Test Workflow")
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {"Type": "Task", "Next": "State2"},
            "State2": {"Type": "Task"},
        },
    }
    workflow_service.save_draft(workflow.workflow_id, dsl, {})
    workflow_service.publish_workflow(workflow.workflow_id)

    # Start first run
    run1 = run_service.start_run(workflow.workflow_id)
    assert run1 is not None

    # Try to start second run (should fail)
    with pytest.raises(ValueError, match="already active"):
        run_service.start_run(workflow.workflow_id)

    # Wait a bit for first run to complete
    time.sleep(2)

    # Check first run status
    run1_updated = run_service.get_run(run1.run_id)
    # Run should be completed or still running
    assert run1_updated.status in (
        RunStatus.SUCCESS,
        RunStatus.FAILED,
        RunStatus.RUNNING,
    )

    # If first run is terminal, we should be able to start a new one
    if run1_updated.status in (RunStatus.SUCCESS, RunStatus.FAILED, RunStatus.CANCELED):
        run2 = run_service.start_run(workflow.workflow_id)
        assert run2 is not None
        assert run2.run_id != run1.run_id
