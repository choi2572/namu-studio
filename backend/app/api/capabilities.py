"""Capabilities API endpoints."""
from flask import Blueprint, jsonify


bp = Blueprint("capabilities", __name__)


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
