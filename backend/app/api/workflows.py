"""Workflow API endpoints."""
from flask import Blueprint, request, jsonify
from werkzeug.exceptions import BadRequest, NotFound, Conflict

from app.services.workflow_service import WorkflowService
from app.repos.memory import (
    InMemoryWorkflowRepository,
    InMemoryWorkflowVersionRepository,
    InMemoryWorkflowViewRepository,
)


# Initialize repositories (singleton pattern for in-memory)
_workflow_repo = InMemoryWorkflowRepository()
_version_repo = InMemoryWorkflowVersionRepository()
_view_repo = InMemoryWorkflowViewRepository()
_workflow_service = WorkflowService(_workflow_repo, _version_repo, _view_repo)


bp = Blueprint("workflows", __name__)


@bp.route("", methods=["GET"])
def list_workflows():
    """List all workflows."""
    workflows = _workflow_service.list_workflows()
    
    result = []
    for wf in workflows:
        latest_version = None
        if wf.current_published_version_id:
            version = _version_repo.get(wf.current_published_version_id)
            if version:
                latest_version = {
                    "versionId": version.version_id,
                    "versionNumber": version.version_number,
                    "publishedAt": version.published_at.isoformat() if version.published_at else None,
                }
        
        result.append({
            "workflowId": wf.workflow_id,
            "name": wf.name,
            "state": wf.state.value,
            "latestVersion": latest_version,
            "latestRun": None,  # TODO: integrate with run service
        })
    
    return jsonify(result)


@bp.route("", methods=["POST"])
def create_workflow():
    """Create a new workflow."""
    data = request.get_json() or {}
    name = data.get("name", "Untitled Workflow")
    description = data.get("description")
    
    workflow = _workflow_service.create_workflow(name, description)
    
    return jsonify({
        "workflowId": workflow.workflow_id,
        "name": workflow.name,
        "description": workflow.description,
        "state": workflow.state.value,
    }), 201


@bp.route("/<workflow_id>", methods=["GET"])
def get_workflow(workflow_id: str):
    """Get workflow by ID."""
    workflow = _workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise NotFound(f"Workflow {workflow_id} not found")
    
    return jsonify({
        "workflowId": workflow.workflow_id,
        "name": workflow.name,
        "description": workflow.description,
        "state": workflow.state.value,
        "currentPublishedVersionId": workflow.current_published_version_id,
    })


@bp.route("/<workflow_id>", methods=["PATCH"])
def update_workflow(workflow_id: str):
    """Update workflow metadata."""
    data = request.get_json() or {}
    name = data.get("name")
    description = data.get("description")
    
    workflow = _workflow_service.update_workflow_metadata(workflow_id, name, description)
    if not workflow:
        raise NotFound(f"Workflow {workflow_id} not found")
    
    return jsonify({
        "workflowId": workflow.workflow_id,
        "name": workflow.name,
        "description": workflow.description,
    })


@bp.route("/<workflow_id>/draft", methods=["GET"])
def get_draft(workflow_id: str):
    """Get draft version."""
    draft = _workflow_service.get_draft(workflow_id)
    if not draft:
        raise NotFound(f"Draft not found for workflow {workflow_id}")
    
    return jsonify(draft)


@bp.route("/<workflow_id>/draft", methods=["PUT"])
def save_draft(workflow_id: str):
    """Save draft version."""
    data = request.get_json() or {}
    dsl_json = data.get("dsl_json", {})
    view_json = data.get("view_json", {})
    
    version = _workflow_service.save_draft(workflow_id, dsl_json, view_json)
    if not version:
        raise NotFound(f"Workflow {workflow_id} not found")
    
    return jsonify({
        "workflowId": workflow_id,
        "dsl_json": version.dsl_json,
        "view_json": view_json,
        "updatedAt": version.created_at.isoformat(),
    })


@bp.route("/<workflow_id>/validate", methods=["POST"])
def validate_draft(workflow_id: str):
    """Validate draft workflow."""
    errors = _workflow_service.validate_draft(workflow_id)
    
    return jsonify([
        {
            "id": e.id,
            "message": e.message,
            "nodeId": e.nodeId if e.nodeId else None,
        }
        for e in errors
    ])


@bp.route("/<workflow_id>/publish", methods=["POST"])
def publish_workflow(workflow_id: str):
    """Publish workflow version."""
    try:
        version = _workflow_service.publish_workflow(workflow_id)
        if not version:
            raise NotFound(f"Workflow {workflow_id} not found")
        
        return jsonify({
            "versionId": version.version_id,
            "versionNumber": version.version_number,
            "publishedAt": version.published_at.isoformat() if version.published_at else None,
        }), 201
    except ValueError as e:
        raise BadRequest(str(e))
