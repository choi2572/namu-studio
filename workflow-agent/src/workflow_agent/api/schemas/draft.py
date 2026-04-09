"""POST /workflow-agent/draft request and success/failure responses."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class DraftRequest(BaseModel):
    request: str = Field(..., description="Natural language workflow intent.")
    model: str | None = Field(
        None,
        description=(
            "When set, must equal the current active_model from GET /workflow-agent/status; "
            "omit to draft with the active model."
        ),
    )
    system_prompt_suffix: str | None = Field(
        None,
        description=(
            "Optional text appended at the end of the LLM system prompt (after the skill catalog). "
            "Use for product-specific instructions without changing server code."
        ),
    )


class DraftGuidance(BaseModel):
    basic: str | None = None
    suggestion: str | None = None


class DraftMetadata(BaseModel):
    request_id: str
    skills_hash: str


class DraftSuccessResponse(BaseModel):
    success: Literal[True] = True
    model: str
    spec: dict[str, Any]
    dsl: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)
    metadata: DraftMetadata


class DraftFailureResponse(BaseModel):
    success: Literal[False] = False
    error_code: str
    errors: list[str]
    guidance: DraftGuidance = Field(
        default_factory=DraftGuidance,
        description="Always present for failures (spec §8); may use null basic/suggestion when unused.",
    )
    last_spec: dict[str, Any] | None = None
