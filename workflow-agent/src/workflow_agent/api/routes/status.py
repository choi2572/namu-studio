"""GET /workflow-agent/status."""

from __future__ import annotations

from fastapi import APIRouter

from workflow_agent.api.deps import StateStoreDep
from workflow_agent.api.schemas.status import StatusResponse

router = APIRouter(prefix="/workflow-agent", tags=["status"])


@router.get("/status", response_model=StatusResponse)
async def workflow_agent_status(state: StateStoreDep) -> StatusResponse:
    snap = state.get_snapshot()
    return StatusResponse(
        alive=snap.alive,
        active_model=snap.active_model,
        model_loaded=snap.model_loaded,
        skills_ready=snap.skills_ready,
        skills_hash=snap.skills_hash,
    )
