"""Glue: compile then run second-stage DSL validation."""

from __future__ import annotations

from workflow_agent.dsl.compiler import compile_workflow_spec
from workflow_agent.dsl.dsl_validation import validate_workflow_dsl
from workflow_agent.dsl.types import CompilePipelineResult
from workflow_agent.spec.models import WorkflowSpec


def compile_validated_spec_pipeline(spec: WorkflowSpec) -> CompilePipelineResult:
    """Emit DSL from a *spec-layer-validated* ``WorkflowSpec``, then validate the DSL."""
    dsl, warnings = compile_workflow_spec(spec)
    report = validate_workflow_dsl(dsl)
    return CompilePipelineResult(dsl=dsl, warnings=warnings, dsl_validation=report)
