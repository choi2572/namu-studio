"""Spec and DSL validation (deterministic, server-side)."""

from __future__ import annotations

from typing import Any

from workflow_agent.api.schemas.skills import SkillSyncRequest
from workflow_agent.dsl.dsl_validation import DslValidationReport, validate_workflow_dsl
from workflow_agent.spec.validation import SpecValidationReport, parse_and_validate_workflow_spec


class SkillPayloadValidationError(ValueError):
    """Raised when skill sync payload breaks deterministic business rules."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__(errors[0] if errors else "validation failed")


def validate_skill_payload(body: SkillSyncRequest) -> None:
    """
    Deterministic rules for POST /workflow-agent/skills/sync:
    non-empty name, non-empty description, no duplicate names (after strip).
    """
    errors: list[str] = []
    seen: set[str] = set()

    for idx, skill in enumerate(body.skills):
        name = skill.name.strip()
        desc = skill.description.strip()
        prefix = f"skills[{idx}]"

        if not name:
            errors.append(f"{prefix}.name must be non-empty")
        elif name in seen:
            errors.append(f"duplicate skill name: {name!r}")
        else:
            seen.add(name)

        if not desc:
            errors.append(f"{prefix}.description must be non-empty (skill {name!r})")

    if errors:
        raise SkillPayloadValidationError(errors)


def validate_workflow_spec(
    spec: dict[str, Any],
    *,
    known_skill_names: set[str],
) -> SpecValidationReport:
    """Parse + business validation (spec §6.1); see ``workflow_agent.spec``."""
    return parse_and_validate_workflow_spec(spec, known_skill_names=known_skill_names)


def validate_dsl(dsl: dict[str, Any]) -> DslValidationReport:
    """Second-stage DSL checks (spec §6.2); see ``workflow_agent.dsl.dsl_validation``."""
    return validate_workflow_dsl(dsl)
