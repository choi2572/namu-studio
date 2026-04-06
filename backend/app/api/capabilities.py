"""Capabilities API endpoints."""
import os
from flask import Blueprint, current_app, jsonify

from app.adapters.middleware_client import MiddlewareClient


bp = Blueprint("capabilities", __name__)


@bp.route("/skill-set", methods=["GET"])
def get_skill_set():
    """GET skill-set from middleware (GET /api/v1/skill-sets). Frontend uses this."""
    base_url = current_app.config.get("MIDDLEWARE_BASE_URL") or os.environ.get("MIDDLEWARE_BASE_URL", "http://localhost:8000")
    client = MiddlewareClient(base_url)
    data = client.get_skill_set()
    return jsonify(data)


@bp.route("/skills", methods=["GET"])
def list_skills():
    """List available skills."""
    # Dummy implementation
    return jsonify([
        {
            "name": "PickObject",
            "version": "1.0.0",
            "parameterSchema": {
                "type": "object",
                "properties": {
                    "objectId": {"type": "string"},
                    "graspType": {"type": "string", "enum": ["top", "side"]},
                },
            },
        },
        {
            "name": "PlaceObject",
            "version": "1.0.0",
            "parameterSchema": {
                "type": "object",
                "properties": {
                    "targetLocation": {"type": "string"},
                },
            },
        },
    ])


@bp.route("/health", methods=["GET"])
def get_health():
    """Get runtime health."""
    return jsonify({
        "status": "healthy",
        "runtime": {
            "middleware": "dummy",
            "robot": "simulated",
        },
    })
