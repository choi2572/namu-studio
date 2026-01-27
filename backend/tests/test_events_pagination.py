"""Test events pagination."""
import pytest
import time

from app.services.run_service import RunService
from app.services.workflow_service import WorkflowService
from app.adapters.execution_engine import DummyExecutionEngineAdapter


def test_events_pagination(workflow_repo, version_repo, view_repo, run_repo, node_run_repo, run_event_repo):
    """Test events pagination with after_seq."""
    # Setup
    workflow_service = WorkflowService(workflow_repo, version_repo, view_repo)
    execution_adapter = DummyExecutionEngineAdapter(
        run_repo, node_run_repo, run_event_repo, workflow_repo, version_repo
    )
    run_service = RunService(
        run_repo, node_run_repo, run_event_repo,
        workflow_repo, version_repo, execution_adapter
    )
    
    # Create and publish workflow
    workflow = workflow_service.create_workflow("Test Workflow")
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {"Type": "Task", "Next": "State2"},
            "State2": {"Type": "Task"},
        }
    }
    workflow_service.save_draft(workflow.workflow_id, dsl, {})
    workflow_service.publish_workflow(workflow.workflow_id)
    
    # Start run
    run = run_service.start_run(workflow.workflow_id)
    assert run is not None
    
    # Wait a bit for events to be generated
    time.sleep(2)
    
    # Get all events
    all_events = run_service.get_events(run.run_id)
    assert len(all_events) > 0
    
    # Get events after first event
    if len(all_events) > 1:
        first_seq = all_events[0]["seq"]
        later_events = run_service.get_events(run.run_id, after_seq=first_seq)
        
        assert len(later_events) < len(all_events)
        assert all(e["seq"] > first_seq for e in later_events)
        assert len(later_events) == len(all_events) - 1
    
    # Get events after last event (should be empty)
    if all_events:
        last_seq = max(e["seq"] for e in all_events)
        no_events = run_service.get_events(run.run_id, after_seq=last_seq)
        assert len(no_events) == 0
