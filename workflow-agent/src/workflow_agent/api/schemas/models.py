"""POST /workflow-agent/models/activate request/response."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ModelActivateRequest(BaseModel):
    model: str = Field(..., description='Target model id, e.g. "qwen" or "gemma".')


class ModelActivateResponse(BaseModel):
    # TODO: Add fields for restart timing / pid if operators need observability.
    success: bool
    active_model: str
    already_active: bool = False
    message: str | None = None
