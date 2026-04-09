"""FastAPI dependencies (request-scoped accessors)."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from workflow_agent.services.application_state import ApplicationStateStore
from workflow_agent.services.model_manager import ModelManager
from workflow_agent.services.model_runtime_backend import ModelRuntimeBackend


def get_state_store(request: Request) -> ApplicationStateStore:
    """Resolve the app-wide state store from ``app.state`` (set in ``create_app``)."""
    store: ApplicationStateStore | None = getattr(request.app.state, "state_store", None)
    if store is None:
        msg = "Application state store is not configured on the FastAPI app."
        raise RuntimeError(msg)
    return store


def get_model_runtime_backend(request: Request) -> ModelRuntimeBackend:
    """Runtime backend for model switching (noop or real process control)."""
    backend: ModelRuntimeBackend | None = getattr(request.app.state, "model_runtime_backend", None)
    if backend is None:
        msg = "Model runtime backend is not configured on the FastAPI app."
        raise RuntimeError(msg)
    return backend


StateStoreDep = Annotated[ApplicationStateStore, Depends(get_state_store)]
ModelRuntimeBackendDep = Annotated[ModelRuntimeBackend, Depends(get_model_runtime_backend)]


def get_model_manager(
    store: StateStoreDep,
    backend: ModelRuntimeBackendDep,
) -> ModelManager:
    return ModelManager(store, backend)


ModelManagerDep = Annotated[ModelManager, Depends(get_model_manager)]
