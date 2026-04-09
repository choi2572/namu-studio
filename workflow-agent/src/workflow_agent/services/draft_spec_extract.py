"""Normalize LLM JSON into a dict suitable for ``WorkflowSpec.model_validate``."""

from __future__ import annotations

from typing import Any


def extract_workflow_spec_dict(parsed: dict[str, Any]) -> dict[str, Any] | None:
    """
    Accept either a bare ``{start, nodes}`` object or common wrapper keys from the model.
    """
    if _looks_like_spec_root(parsed):
        return parsed
    for key in ("spec", "workflow", "WorkflowSpec", "workflow_spec"):
        inner = parsed.get(key)
        if isinstance(inner, dict) and _looks_like_spec_root(inner):
            return inner
    return None


def _looks_like_spec_root(d: dict[str, Any]) -> bool:
    return isinstance(d.get("start"), str) and isinstance(d.get("nodes"), dict)
