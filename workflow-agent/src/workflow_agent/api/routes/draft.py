"""POST /workflow-agent/draft."""

from __future__ import annotations

from fastapi import APIRouter

from workflow_agent.api.deps import ModelRuntimeBackendDep, StateStoreDep
from workflow_agent.api.schemas.draft import DraftFailureResponse, DraftRequest, DraftSuccessResponse
from workflow_agent.services import draft_service

router = APIRouter(prefix="/workflow-agent", tags=["draft"])


@router.post(
    "/draft",
    response_model=DraftSuccessResponse | DraftFailureResponse,
    responses={
        200: {
            "description": "Success or structured failure per spec §8.",
        }
    },
)
async def create_draft(
    body: DraftRequest,
    store: StateStoreDep,
    model_backend: ModelRuntimeBackendDep,
) -> DraftSuccessResponse | DraftFailureResponse:
    return await draft_service.generate_draft(
        body,
        store=store,
        model_backend=model_backend,
    )
