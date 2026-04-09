"""Shared result types for compile + DSL validation."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CompileWarning(BaseModel):
    """Non-fatal compile note (inference, defaults imposed by compiler)."""

    code: str
    message: str
    path: str = ""


class DslValidationIssue(BaseModel):
    """Second-stage DSL rule violation (spec §6.2)."""

    path: str
    code: str
    message: str


class DslValidationReport(BaseModel):
    ok: bool
    errors: list[DslValidationIssue] = Field(default_factory=list)


class CompilePipelineResult(BaseModel):
    """Emitted DSL, compiler warnings, and DSL validator output."""

    dsl: dict[str, Any]
    warnings: list[CompileWarning] = Field(default_factory=list)
    dsl_validation: DslValidationReport
