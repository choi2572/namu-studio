"""POST /workflow-agent/replan."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ReplanRequest(BaseModel):
    request: str = Field(..., description="Natural language edit instruction for the current workflow.")
    current_dsl: dict[str, Any] = Field(
        ...,
        description="Full editor-export DSL JSON (StartAt, States, optional Inputs and OnFailure).",
    )
    focus_state_names: list[str] = Field(
        default_factory=list,
        description=(
            "Optional DSL state keys (States / OnFailure.States) the user focused; "
            "included in the prompt for emphasis only."
        ),
    )
    model: str | None = Field(
        None,
        description=(
            "When set, must equal the current active_model from GET /workflow-agent/status; "
            "omit to replan with the active model."
        ),
    )
    system_prompt_suffix: str | None = Field(
        None,
        description="Optional text appended at the end of the LLM system prompt (after the skill catalog).",
    )
