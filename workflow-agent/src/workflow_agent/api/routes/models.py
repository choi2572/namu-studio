"""POST /workflow-agent/models/activate."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from workflow_agent.api.deps import ModelManagerDep
from workflow_agent.api.schemas.models import ModelActivateRequest, ModelActivateResponse
from workflow_agent.services.model_activation import InvalidModelIdError
from workflow_agent.services.model_runtime_backend import ModelRuntimeError

router = APIRouter(prefix="/workflow-agent", tags=["models"])


@router.post("/models/activate", response_model=ModelActivateResponse)
async def activate_model(body: ModelActivateRequest, manager: ModelManagerDep) -> ModelActivateResponse:
    try:
        outcome = manager.request_activation(body.model)
    except InvalidModelIdError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error_code": "INVALID_MODEL", "errors": exc.errors},
        ) from exc
    except ModelRuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error_code": "MODEL_UNAVAILABLE", "errors": exc.errors},
        ) from exc

    return ModelActivateResponse(
        success=outcome.success,
        active_model=outcome.active_model,
        already_active=outcome.already_active,
        message=outcome.message,
    )
