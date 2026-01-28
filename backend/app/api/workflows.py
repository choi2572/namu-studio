"""Workflow API endpoints."""
from flask import Blueprint, request, jsonify
from werkzeug.exceptions import BadRequest, NotFound, Conflict

from app.services.workflow_service import WorkflowService
from app.repos.registry import (
    workflow_repo as _workflow_repo,
    version_repo as _version_repo,
    view_repo as _view_repo,
    run_repo as _run_repo,
    node_run_repo as _node_run_repo,
    run_event_repo as _run_event_repo,
)


_workflow_service = WorkflowService(
    _workflow_repo,
    _version_repo,
    _view_repo,
    _run_repo,
    _node_run_repo,
    _run_event_repo,
)


bp = Blueprint("workflows", __name__)


@bp.route("", methods=["GET"])
def list_workflows():
    """List all workflows."""
    workflows = _workflow_service.list_workflows()
    
    result = []
    for wf in workflows:
        latest_run = None
        runs = _run_repo.list_all({"workflow_id": wf.workflow_id})
        if runs:
            run = max(
                runs,
                key=lambda r: r.started_at or r.created_at
            )
            duration_ms = None
            if run.finished_at and run.started_at:
                duration_ms = int((run.finished_at - run.started_at).total_seconds() * 1000)
            latest_run = {
                "runId": run.run_id,
                "workflowId": run.workflow_id,
                "workflowName": wf.name,
                "status": run.status.value,
                "startedAt": run.started_at.isoformat() if run.started_at else None,
                "durationMs": duration_ms,
                "failureCode": run.failure_code,
                "failureMessage": run.failure_message,
            }
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
            "latestRun": latest_run,
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
    """Validate draft workflow (DSL v1)."""
    errors = _workflow_service.validate_draft(workflow_id)
    
    return jsonify([
        {
            "node_name": e.nodeId if e.nodeId else None,
            "error_code": e.error_code if e.error_code else e.id.upper(),
            "message": e.message,
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


@bp.route("/<workflow_id>", methods=["DELETE"])
def delete_workflow(workflow_id: str):
    """Delete workflow and all related data."""
    deleted = _workflow_service.delete_workflow(workflow_id)
    if not deleted:
        raise NotFound(f"Workflow {workflow_id} not found")
    return ("", 204)
