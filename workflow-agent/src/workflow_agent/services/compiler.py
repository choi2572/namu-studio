"""Compile validated intermediate spec into workflow DSL (spec §5–6)."""

from __future__ import annotations

from typing import Any

from workflow_agent.dsl.pipeline import compile_validated_spec_pipeline
from workflow_agent.dsl.types import CompilePipelineResult
from workflow_agent.spec.models import WorkflowSpec


def compile_spec_to_dsl(spec: dict[str, Any]) -> dict[str, Any]:
    """
    Legacy helper: parse dict to ``WorkflowSpec`` and return DSL only if pipeline validates.

    Prefer ``run_compile_pipeline`` for warnings + DSL validation report.
    """
    flow = WorkflowSpec.model_validate(spec)
    result = compile_validated_spec_pipeline(flow)
    if not result.dsl_validation.ok:
        msgs = [e.message for e in result.dsl_validation.errors]
        raise ValueError("DSL validation failed: " + "; ".join(msgs))
    return result.dsl


def run_compile_pipeline(spec: WorkflowSpec) -> CompilePipelineResult:
    """Deterministic compile + DSL validation result (no route handlers)."""
    return compile_validated_spec_pipeline(spec)
