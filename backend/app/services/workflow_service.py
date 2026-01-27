"""Workflow service (use cases)."""
from typing import List, Optional
from datetime import datetime
import uuid

from app.domain.models import (
    Workflow,
    WorkflowVersion,
    WorkflowView,
    WorkflowState,
    VersionState,
)
from app.repos.interfaces import (
    WorkflowRepository,
    WorkflowVersionRepository,
    WorkflowViewRepository,
)
from app.services.validation import validate_workflow_dsl, ValidationError


class WorkflowService:
    """Workflow service."""
    
    def __init__(
        self,
        workflow_repo: WorkflowRepository,
        version_repo: WorkflowVersionRepository,
        view_repo: WorkflowViewRepository,
    ):
        self.workflow_repo = workflow_repo
        self.version_repo = version_repo
        self.view_repo = view_repo
    
    def create_workflow(self, name: str, description: Optional[str] = None) -> Workflow:
        """Create a new workflow."""
        workflow = Workflow(
            workflow_id=str(uuid.uuid4()),
            name=name,
            description=description,
            state=WorkflowState.DRAFT,
        )
        workflow = self.workflow_repo.create(workflow)

        version_number = f"v{len(self.version_repo.get_by_workflow(workflow.workflow_id)) + 1}"
        draft = WorkflowVersion(
            version_id=str(uuid.uuid4()),
            workflow_id=workflow.workflow_id,
            version_number=version_number,
            state=VersionState.DRAFT,
            dsl_json={},
        )
        self.version_repo.create(draft)
        self.view_repo.save(WorkflowView(version_id=draft.version_id, view_json={}))

        return workflow
    
    def list_workflows(self) -> List[Workflow]:
        """List all workflows."""
        return self.workflow_repo.list_all()
    
    def get_workflow(self, workflow_id: str) -> Optional[Workflow]:
        """Get workflow by ID."""
        return self.workflow_repo.get(workflow_id)
    
    def update_workflow_metadata(
        self,
        workflow_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None
    ) -> Optional[Workflow]:
        """Update workflow metadata."""
        workflow = self.workflow_repo.get(workflow_id)
        if not workflow:
            return None
        
        if name is not None:
            workflow.name = name
        if description is not None:
            workflow.description = description
        
        return self.workflow_repo.update(workflow)
    
    def save_draft(
        self,
        workflow_id: str,
        dsl_json: dict,
        view_json: dict
    ) -> Optional[WorkflowVersion]:
        """Save draft version."""
        workflow = self.workflow_repo.get(workflow_id)
        if not workflow:
            return None
        
        # Get or create draft version
        draft = self.version_repo.get_latest_draft(workflow_id)
        if draft:
            draft.dsl_json = dsl_json
            draft = self.version_repo.update(draft)
        else:
            version_number = f"v{len(self.version_repo.get_by_workflow(workflow_id)) + 1}"
            draft = WorkflowVersion(
                version_id=str(uuid.uuid4()),
                workflow_id=workflow_id,
                version_number=version_number,
                state=VersionState.DRAFT,
                dsl_json=dsl_json,
            )
            draft = self.version_repo.create(draft)
        
        # Save view
        view = WorkflowView(
            version_id=draft.version_id,
            view_json=view_json,
        )
        self.view_repo.save(view)
        
        return draft
    
    def validate_draft(self, workflow_id: str) -> List[ValidationError]:
        """Validate draft workflow."""
        draft = self.version_repo.get_latest_draft(workflow_id)
        if draft:
            return validate_workflow_dsl(draft.dsl_json)

        workflow = self.workflow_repo.get(workflow_id)
        if not workflow or not workflow.current_published_version_id:
            return [ValidationError(id="no_draft", message="No draft version found")]

        published = self.version_repo.get(workflow.current_published_version_id)
        if not published:
            return [ValidationError(id="no_published", message="Published version not found")]

        return validate_workflow_dsl(published.dsl_json)
    
    def publish_workflow(self, workflow_id: str) -> Optional[WorkflowVersion]:
        """Publish workflow version."""
        workflow = self.workflow_repo.get(workflow_id)
        if not workflow:
            return None
        
        # Validate
        errors = self.validate_draft(workflow_id)
        if errors:
            raise ValueError(f"Validation failed: {[e.message for e in errors]}")
        
        # Get draft
        draft = self.version_repo.get_latest_draft(workflow_id)
        if not draft:
            return None
        
        # Publish
        draft.state = VersionState.PUBLISHED
        draft.published_at = datetime.utcnow()
        draft = self.version_repo.update(draft)
        
        # Update workflow
        workflow.current_published_version_id = draft.version_id
        workflow.state = WorkflowState.PUBLISHED
        workflow = self.workflow_repo.update(workflow)
        
        return draft
    
    def get_draft(self, workflow_id: str) -> Optional[dict]:
        """Get draft with view."""
        draft = self.version_repo.get_latest_draft(workflow_id)
        if draft:
            view = self.view_repo.get(draft.version_id)
            return {
                "workflowId": workflow_id,
                "dsl_json": draft.dsl_json,
                "view_json": view.view_json if view else {},
                "updatedAt": draft.created_at.isoformat(),
            }

        workflow = self.workflow_repo.get(workflow_id)
        if not workflow or not workflow.current_published_version_id:
            return None

        published = self.version_repo.get(workflow.current_published_version_id)
        if not published:
            return None

        view = self.view_repo.get(published.version_id)
        updated_at = published.published_at or published.created_at
        return {
            "workflowId": workflow_id,
            "dsl_json": published.dsl_json,
            "view_json": view.view_json if view else {},
            "updatedAt": updated_at.isoformat(),
        }
