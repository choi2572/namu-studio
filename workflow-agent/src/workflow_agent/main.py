"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

from workflow_agent.api.routes import draft, models, skills, status
from workflow_agent.logging_setup import build_uvicorn_log_config, configure_application_logging
from workflow_agent.services.application_state import (
    ApplicationStateStore,
    InMemoryApplicationStateStore,
)
from workflow_agent.services.llama_cpp_process_backend import LlamaCppProcessBackend
from workflow_agent.services.model_runtime_backend import ModelRuntimeBackend, NoopModelRuntimeBackend

load_dotenv()

_LOG = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    configure_application_logging()
    _LOG.info("Workflow Agent ready — routes under /workflow-agent; OpenAPI at /docs")
    yield


def build_model_runtime_backend() -> ModelRuntimeBackend:
    """Use ``WORKFLOW_AGENT_MODELS_CONFIG`` (YAML) when set; otherwise noop."""
    raw = os.environ.get("WORKFLOW_AGENT_MODELS_CONFIG")
    if not raw:
        _LOG.warning(
            "WORKFLOW_AGENT_MODELS_CONFIG is not set; using NoopModelRuntimeBackend (no llama-server process)",
        )
        return NoopModelRuntimeBackend()
    path = Path(raw).expanduser()
    if not path.is_file():
        msg = f"WORKFLOW_AGENT_MODELS_CONFIG must point to a YAML file: {path.resolve()}"
        raise FileNotFoundError(msg)
    return LlamaCppProcessBackend.from_yaml_path(path)


def create_app(
    *,
    state_store: ApplicationStateStore | None = None,
    model_runtime_backend: ModelRuntimeBackend | None = None,
) -> FastAPI:
    # TODO: Add middleware (request id, logging), CORS if needed for Namu Studio.
    configure_application_logging()
    store = state_store or InMemoryApplicationStateStore()
    backend = model_runtime_backend if model_runtime_backend is not None else build_model_runtime_backend()
    app = FastAPI(title="Workflow Agent", version="0.1.0", lifespan=_lifespan)
    app.state.state_store = store
    app.state.model_runtime_backend = backend
    app.include_router(status.router)
    app.include_router(skills.router)
    app.include_router(models.router)
    app.include_router(draft.router)
    return app


app = create_app()


def run() -> None:
    """CLI entrypoint for `workflow-agent` script."""
    import uvicorn

    # TODO: Configure host/port/reload via env.
    uvicorn.run(
        "workflow_agent.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_config=build_uvicorn_log_config(),
    )
