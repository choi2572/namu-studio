"""Pydantic models for the intermediate workflow spec JSON (pre-DSL, spec §6.1)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

# --- Retry / failure (spec §7 — kept minimal; pipeline may extend later) ----------


class SkillRetryPolicy(BaseModel):
    """Per-skill retry bounds (spec §7: up to 3 attempts in full pipeline)."""

    max_attempts: int = Field(default=1, ge=1, le=3)
    on_failure: Literal["fail", "goto"] = "fail"
    goto_node: str | None = None

    @model_validator(mode="after")
    def _goto_node_when_needed(self) -> SkillRetryPolicy:
        if self.on_failure == "goto" and not (self.goto_node and self.goto_node.strip()):
            msg = "goto_node is required when on_failure is 'goto'"
            raise ValueError(msg)
        return self


# --- Nodes -----------------------------------------------------------------------


class SkillNode(BaseModel):
    type: Literal["skill"] = "skill"
    skill: str = Field(..., min_length=1)
    inputs: dict[str, Any] = Field(default_factory=dict)
    next: str = Field(..., min_length=1)
    retry: SkillRetryPolicy | None = None


class BranchArm(BaseModel):
    """One conditional arm; optional label for debugging / repair only."""

    next: str = Field(..., min_length=1)
    label: str | None = None


class BranchNode(BaseModel):
    type: Literal["branch"] = "branch"
    branches: list[BranchArm] = Field(..., min_length=1)
    default_next: str = Field(..., min_length=1)


class EndNode(BaseModel):
    type: Literal["end"] = "end"


NodeModel = Annotated[SkillNode | BranchNode | EndNode, Field(discriminator="type")]


class WorkflowSpec(BaseModel):
    """
    Graph: ``nodes`` keyed by id; ``start`` is the entry node id.

    Intended as the object LLM JSON maps into before compile (spec §5–6).
    """

    start: str = Field(..., min_length=1)
    nodes: dict[str, NodeModel]
    version: str | None = Field(default=None, description="Optional format hint for clients.")

    @model_validator(mode="after")
    def _nonblank_node_ids(self) -> WorkflowSpec:
        for nid in self.nodes:
            if not nid.strip():
                msg = "node ids must be non-empty"
                raise ValueError(msg)
        return self
