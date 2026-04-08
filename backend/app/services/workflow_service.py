"""Workflow service (use cases)."""

import uuid
from datetime import datetime

from app.domain.models import (
    VersionState,
    Workflow,
    WorkflowState,
    WorkflowVersion,
    WorkflowView,
)
from app.repos.interfaces import (
    NodeRunRepository,
    RunEventRepository,
    RunRepository,
    WorkflowRepository,
    WorkflowVersionRepository,
    WorkflowViewRepository,
)
from app.services.validation import ValidationError, validate_workflow_dsl


class WorkflowService:
    """Workflow service."""

    def __init__(
        self,
        workflow_repo: WorkflowRepository,
        version_repo: WorkflowVersionRepository,
        view_repo: WorkflowViewRepository,
        run_repo: RunRepository,
        node_run_repo: NodeRunRepository,
        run_event_repo: RunEventRepository,
    ):
        self.workflow_repo = workflow_repo
        self.version_repo = version_repo
        self.view_repo = view_repo
        self.run_repo = run_repo
        self.node_run_repo = node_run_repo
        self.run_event_repo = run_event_repo

    def create_workflow(self, name: str, description: str | None = None) -> Workflow:
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

    def list_workflows(self) -> list[Workflow]:
        """List all workflows."""
        return self.workflow_repo.list_all()

    def get_workflow(self, workflow_id: str) -> Workflow | None:
        """Get workflow by ID."""
        return self.workflow_repo.get(workflow_id)

    def update_workflow_metadata(
        self,
        workflow_id: str,
        name: str | None = None,
        description: str | None = None,
    ) -> Workflow | None:
        """Update workflow metadata."""
        workflow = self.workflow_repo.get(workflow_id)
        if not workflow:
            return None

        if name is not None:
            workflow.name = name
        if description is not None:
            workflow.description = description

        return self.workflow_repo.update(workflow)

    def save_draft(self, workflow_id: str, dsl_json: dict, view_json: dict) -> WorkflowVersion | None:
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

    def validate_draft(self, workflow_id: str) -> list[ValidationError]:
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

    def publish_workflow(self, workflow_id: str) -> WorkflowVersion | None:
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

    def get_draft(self, workflow_id: str) -> dict | None:
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

    def delete_workflow(self, workflow_id: str) -> bool:
        """Delete workflow and all related versions, views, runs and events."""
        workflow = self.workflow_repo.get(workflow_id)
        if not workflow:
            return False

        # Delete runs and their node runs / events first to satisfy FK constraints
        runs = self.run_repo.list_all({"workflow_id": workflow_id})
        for run in runs:
            self.node_run_repo.delete_by_run(run.run_id)
            self.run_event_repo.delete_by_run(run.run_id)
            self.run_repo.delete(run.run_id)

        # Delete workflow versions and their views
        versions = self.version_repo.get_by_workflow(workflow_id)
        for version in versions:
            self.view_repo.delete(version.version_id)
            self.version_repo.delete(version.version_id)

        # Finally delete the workflow
        self.workflow_repo.delete(workflow_id)
        return True
