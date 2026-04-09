"""Capabilities skill-set proxy: middleware payload must pass through unchanged."""

from __future__ import annotations

import pytest

from app.adapters.middleware_client import MiddlewareClient


@pytest.fixture
def sample_middleware_skill_sets() -> dict:
    return {
        "skill_sets": [
            {
                "namespace": "qa",
                "name": "ValidateFrame",
                "version": "0.0.1",
                "description": "Validate frame quality",
                "allow_status_external_change": True,
                "parameters": {
                    "threshold": {
                        "type": "double",
                        "description": "Quality threshold",
                        "range": {"min": 0.0, "max": 1.0},
                    },
                    "mode": {
                        "type": "string",
                        "description": "Mode",
                        "candidates": ["fast", "accurate"],
                    },
                    "legacy_only": {"type": "bool", "description": "No range or candidates"},
                },
                "outputs": {},
                "feedback": [],
                "pre_conditions": [],
                "post_effects": [],
            }
        ]
    }


def test_skill_set_passes_through_range_and_candidates(client, monkeypatch, sample_middleware_skill_sets):
    def _fake_get_skill_set(self: MiddlewareClient) -> dict:
        return sample_middleware_skill_sets

    monkeypatch.setattr(MiddlewareClient, "get_skill_set", _fake_get_skill_set)

    response = client.get("/api/capabilities/skill-set")
    assert response.status_code == 200
    body = response.get_json()
    assert body == sample_middleware_skill_sets

    params = body["skill_sets"][0]["parameters"]
    assert params["threshold"]["range"] == {"min": 0.0, "max": 1.0}
    assert params["mode"]["candidates"] == ["fast", "accurate"]
    assert "range" not in params["legacy_only"] and "candidates" not in params["legacy_only"]
