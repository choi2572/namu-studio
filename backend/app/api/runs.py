"""Run API endpoints."""
from flask import Blueprint, request, jsonify
from werkzeug.exceptions import BadRequest, NotFound, Conflict

from app.services.run_service import RunService
from app.services.workflow_service import WorkflowService
from app.repos.memory import (
    InMemoryRunRepository,
    InMemoryNodeRunRepository,
    InMemoryRunEventRepository,
    InMemoryWorkflowRepository,
    InMemoryWorkflowVersionRepository,
)
from app.adapters.execution_engine import DummyExecutionEngineAdapter


# Initialize repositories
_run_repo = InMemoryRunRepository()
_node_run_repo = InMemoryNodeRunRepository()
_run_event_repo = InMemoryRunEventRepository()
_workflow_repo = InMemoryWorkflowRepository()
_workflow_version_repo = InMemoryWorkflowVersionRepository()

# Initialize execution adapter
_execution_adapter = DummyExecutionEngineAdapter(
    _run_repo,
    _node_run_repo,
    _run_event_repo,
    _workflow_repo,
    _workflow_version_repo
)

# Initialize services
_run_service = RunService(
    _run_repo,
    _node_run_repo,
    _run_event_repo,
    _workflow_repo,
    _workflow_version_repo,
    _execution_adapter,
)


bp = Blueprint("runs", __name__)


@bp.route("", methods=["GET"])
def list_runs():
    """List runs with optional filters."""
    status = request.args.get("status")
    workflow_id = request.args.get("workflowId")
    time_range = request.args.get("timeRange")
    
    filters = {}
    if status:
        filters["status"] = status
    if workflow_id:
        filters["workflow_id"] = workflow_id
    
    runs = _run_service.list_runs(filters)
    
    result = []
    for run in runs:
        workflow = _workflow_repo.get(run.workflow_id)
        duration_ms = None
        if run.finished_at and run.started_at:
            duration_ms = int((run.finished_at - run.started_at).total_seconds() * 1000)
        
        result.append({
            "runId": run.run_id,
            "workflowId": run.workflow_id,
            "workflowName": workflow.name if workflow else "",
            "status": run.status.value,
            "startedAt": run.started_at.isoformat() if run.started_at else None,
            "durationMs": duration_ms,
            "failureCode": run.failure_code,
            "failureMessage": run.failure_message,
        })
    
    return jsonify(result)


@bp.route("", methods=["POST"])
def start_run():
    """Start a run."""
    data = request.get_json() or {}
    workflow_id = data.get("workflowId")
    run_input = data.get("runInput")
    
    if not workflow_id:
        raise BadRequest("workflowId is required")
    
    try:
        run = _run_service.start_run(workflow_id, run_input)
        if not run:
            raise NotFound(f"Workflow {workflow_id} not found")
        
        return jsonify({
            "runId": run.run_id,
            "workflowId": run.workflow_id,
            "status": run.status.value,
        }), 201
    except ValueError as e:
        raise Conflict(str(e))


@bp.route("/<run_id>", methods=["GET"])
def get_run(run_id: str):
    """Get run by ID."""
    run = _run_service.get_run(run_id)
    if not run:
        raise NotFound(f"Run {run_id} not found")
    
    workflow = _workflow_repo.get(run.workflow_id)
    duration_ms = None
    if run.finished_at and run.started_at:
        duration_ms = int((run.finished_at - run.started_at).total_seconds() * 1000)
    
    return jsonify({
        "runId": run.run_id,
        "workflowId": run.workflow_id,
        "workflowName": workflow.name if workflow else "",
        "status": run.status.value,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "durationMs": duration_ms,
        "failureCode": run.failure_code,
        "failureMessage": run.failure_message,
    })


@bp.route("/<run_id>/cancel", methods=["POST"])
def cancel_run(run_id: str):
    """Cancel a run."""
    run = _run_service.cancel_run(run_id)
    if not run:
        raise NotFound(f"Run {run_id} not found")
    
    return jsonify({
        "runId": run.run_id,
        "status": run.status.value,
    })


@bp.route("/<run_id>/snapshot", methods=["GET"])
def get_snapshot(run_id: str):
    """Get run snapshot for monitoring."""
    snapshot = _run_service.get_run_snapshot(run_id)
    if not snapshot:
        raise NotFound(f"Run {run_id} not found")
    
    return jsonify(snapshot)


@bp.route("/<run_id>/nodes/<state_name>/debug", methods=["GET"])
def get_node_debug(run_id: str, state_name: str):
    """Get node debug bundle."""
    debug = _run_service.get_node_debug(run_id, state_name)
    if not debug:
        raise NotFound(f"Node debug not found for run {run_id}, state {state_name}")
    
    return jsonify(debug)


@bp.route("/<run_id>/events", methods=["GET"])
def get_events(run_id: str):
    """Get run events."""
    after_seq = request.args.get("afterSeq")
    after_seq_int = int(after_seq) if after_seq else None
    
    events = _run_service.get_events(run_id, after_seq_int)
    
    return jsonify(events)


@bp.route("/<run_id>/resume", methods=["POST"])
def resume_wait(run_id: str):
    """Resume a waiting node."""
    data = request.get_json() or {}
    state_name = data.get("stateName")
    payload = data.get("payload", {})
    
    if not state_name:
        raise BadRequest("stateName is required")
    
    success = _run_service.resume_wait(run_id, state_name, payload)
    if not success:
        raise BadRequest(f"Cannot resume run {run_id} at state {state_name}")
    
    return jsonify({"success": True})
