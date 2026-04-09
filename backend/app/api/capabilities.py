"""Capabilities API endpoints."""

import os

from flask import Blueprint, current_app, jsonify

from app.adapters.middleware_client import MiddlewareClient

bp = Blueprint("capabilities", __name__)


@bp.route("/skill-set", methods=["GET"])
def get_skill_set():
    """미들웨어 `GET /api/v1/skill-sets` 응답을 **변환 없이** 그대로 반환한다.

    스킬 `parameters`의 각 스펙에 `range`, `candidates` 등이 있어도 백엔드에서 제거·재작성하지 않으며,
    프론트는 이 페이로드를 그대로 소비한다.
    """
    base_url = current_app.config.get("MIDDLEWARE_BASE_URL") or os.environ.get(
        "MIDDLEWARE_BASE_URL", "http://localhost:8000"
    )
    client = MiddlewareClient(base_url)
    data = client.get_skill_set()
    return jsonify(data)


@bp.route("/skills", methods=["GET"])
def list_skills():
    """List available skills."""
    # Dummy implementation
    return jsonify(
        [
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
        ]
    )


@bp.route("/health", methods=["GET"])
def get_health():
    """Get runtime health."""
    return jsonify(
        {
            "status": "healthy",
            "runtime": {
                "middleware": "dummy",
                "robot": "simulated",
            },
        }
    )
