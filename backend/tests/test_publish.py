"""Test publish workflow flow."""
import pytest

from app.domain.models import WorkflowState, VersionState
from app.services.workflow_service import WorkflowService
from app.repos.memory import (
    InMemoryWorkflowRepository,
    InMemoryWorkflowVersionRepository,
    InMemoryWorkflowViewRepository,
)


def test_publish_workflow_success():
    """Test successful publish flow."""
    workflow_repo = InMemoryWorkflowRepository()
    version_repo = InMemoryWorkflowVersionRepository()
    view_repo = InMemoryWorkflowViewRepository()
    service = WorkflowService(workflow_repo, version_repo, view_repo)
    
    # Create workflow
    workflow = service.create_workflow("Test Workflow")
    
    # Save draft
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {"Type": "Task", "Next": "State2"},
            "State2": {"Type": "Task"},
        }
    }
    view = {"nodes": []}
    
    service.save_draft(workflow.workflow_id, dsl, view)
    
    # Validate (should pass)
    errors = service.validate_draft(workflow.workflow_id)
    assert len(errors) == 0
    
    # Publish
    version = service.publish_workflow(workflow.workflow_id)
    assert version is not None
    assert version.state == VersionState.PUBLISHED
    assert version.published_at is not None
    
    # Check workflow state
    updated_workflow = workflow_repo.get(workflow.workflow_id)
    assert updated_workflow.state == WorkflowState.PUBLISHED
    assert updated_workflow.current_published_version_id == version.version_id


def test_publish_with_validation_error():
    """Test that publish fails when validation errors exist."""
    workflow_repo = InMemoryWorkflowRepository()
    version_repo = InMemoryWorkflowVersionRepository()
    view_repo = InMemoryWorkflowViewRepository()
    service = WorkflowService(workflow_repo, version_repo, view_repo)
    
    # Create workflow
    workflow = service.create_workflow("Test Workflow")
    
    # Save invalid draft (no StartAt)
    dsl = {
        "States": {
            "State1": {"Type": "Task"},
        }
    }
    view = {"nodes": []}
    
    service.save_draft(workflow.workflow_id, dsl, view)
    
    # Validate (should fail)
    errors = service.validate_draft(workflow.workflow_id)
    assert len(errors) > 0
    
    # Publish should fail
    with pytest.raises(ValueError):
        service.publish_workflow(workflow.workflow_id)
