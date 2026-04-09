"""POST /workflow-agent/skills/sync."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from workflow_agent.api.deps import StateStoreDep
from workflow_agent.api.schemas.skills import (
    SkillSyncMetadata,
    SkillSyncRequest,
    SkillSyncResponse,
)
from workflow_agent.services import skill_registry, validators
from workflow_agent.services.validators import SkillPayloadValidationError

router = APIRouter(prefix="/workflow-agent", tags=["skills"])


@router.post("/skills/sync", response_model=SkillSyncResponse)
async def sync_skills(body: SkillSyncRequest, state: StateStoreDep) -> SkillSyncResponse:
    try:
        validators.validate_skill_payload(body)
    except SkillPayloadValidationError as exc:
        raise HTTPException(status_code=422, detail={"errors": exc.errors}) from exc

    outcome = skill_registry.sync_from_studio(state, body.skills)
    return SkillSyncResponse(
        success=True,
        skills_hash=outcome.skills_hash,
        metadata=SkillSyncMetadata(
            skill_count=outcome.skill_count,
            prompt_context_length=outcome.prompt_context_length,
        ),
    )
