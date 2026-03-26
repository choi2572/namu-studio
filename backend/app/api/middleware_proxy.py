"""Proxy API for middleware (runner status, workflow run).
Frontend calls Backend at /api/v1/*; Backend forwards to Middleware.
See docs/middleware-api-spec.md.
"""
import os
from flask import Blueprint, current_app, request, jsonify

from app.adapters.middleware_client import MiddlewareClient


bp = Blueprint("middleware_proxy", __name__)


def _middleware_client() -> MiddlewareClient:
    base_url = (
        current_app.config.get("MIDDLEWARE_BASE_URL")
        or os.environ.get("MIDDLEWARE_BASE_URL", "http://localhost:8000")
    )
    return MiddlewareClient(base_url)


@bp.route("/runner/status", methods=["GET"])
def get_runner_status():
    """GET /api/v1/runner/status — proxy to middleware."""
    client = _middleware_client()
    data = client.get_runner_status()
    return jsonify(data)


@bp.route("/workflows/run", methods=["POST"])
def workflows_run():
    """POST /api/v1/workflows/run — proxy to middleware (start/cancel)."""
    client = _middleware_client()
    body = request.get_json(force=True, silent=True) or {}
    data = client.workflows_run(body)
    return jsonify(data)


@bp.route("/workflows/<workflow_id>/json", methods=["GET"])
def get_workflow_json(workflow_id: str):
    """GET /api/v1/workflows/<workflow_id>/json — DSL JSON for live monitor rendering."""
    client = _middleware_client()
    data = client.get_workflow_json(workflow_id)
    return jsonify(data)


@bp.route("/workflows/action-status", methods=["POST"])
def post_workflow_action_status():
    """POST /api/v1/workflows/action-status — proxy external action status update."""
    client = _middleware_client()
    body = request.get_json(force=True, silent=True) or {}
    data = client.workflows_action_status(body)
    return jsonify(data)
