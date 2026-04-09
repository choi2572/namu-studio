"""GET /workflow-agent/status response."""

from __future__ import annotations

from pydantic import BaseModel, Field


class StatusResponse(BaseModel):
    alive: bool = True
    active_model: str = Field(
        ...,
        description='Active model id, e.g. "qwen" / "gemma" per spec naming.',
    )
    model_loaded: bool = Field(
        ...,
        description="Whether the llama.cpp-backed model is ready for inference.",
    )
    skills_ready: bool = Field(..., description="Whether skill sync completed successfully.")
    skills_hash: str = Field(..., description="Hash of the current skill registry payload.")
    supported_models: list[str] = Field(
        ...,
        description="Model ids from the configured runtime backend (sorted, unique).",
    )
