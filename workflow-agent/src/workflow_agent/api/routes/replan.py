"""POST /workflow-agent/replan."""

from __future__ import annotations

from fastapi import APIRouter

from workflow_agent.api.deps import ModelRuntimeBackendDep, StateStoreDep
from workflow_agent.api.schemas.draft import DraftFailureResponse, DraftSuccessResponse
from workflow_agent.api.schemas.replan import ReplanRequest
from workflow_agent.services import replan_service

router = APIRouter(prefix="/workflow-agent", tags=["replan"])


@router.post(
    "/replan",
    response_model=DraftSuccessResponse | DraftFailureResponse,
    responses={
        200: {
            "description": "Success or structured failure (same envelope as /draft).",
        }
    },
)
async def replan_workflow(
    body: ReplanRequest,
    store: StateStoreDep,
    model_backend: ModelRuntimeBackendDep,
) -> DraftSuccessResponse | DraftFailureResponse:
    return await replan_service.generate_replan(
        body,
        store=store,
        model_backend=model_backend,
    )
