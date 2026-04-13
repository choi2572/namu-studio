"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from workflow_agent.api.middleware_private_network import PrivateNetworkAccessMiddleware
from workflow_agent.api.routes import draft, models, replan, skills, status
from workflow_agent.logging_setup import build_uvicorn_log_config, configure_application_logging
from workflow_agent.services.application_state import (
    ApplicationStateStore,
    InMemoryApplicationStateStore,
)
from workflow_agent.services.llama_cpp_process_backend import LlamaCppProcessBackend
from workflow_agent.services.model_activation import orchestrate_model_activation
from workflow_agent.services.model_runtime_backend import (
    ModelRuntimeBackend,
    ModelRuntimeError,
    NoopModelRuntimeBackend,
)

load_dotenv()

_LOG = logging.getLogger(__name__)


def _resolve_startup_model_id(backend: ModelRuntimeBackend) -> str | None:
    """
    Pick the model to activate when the local llama-server backend starts (spec §3.1).

    Order: ``WORKFLOW_AGENT_DEFAULT_MODEL`` if valid, else YAML ``default_model``,
    else ``qwen`` when supported, else lexicographically first configured id.
    """
    if not backend.updates_runtime_loaded_flag_after_switch():
        return None
    supported = backend.supported_models()
    if not supported:
        return None
    env_raw = os.environ.get("WORKFLOW_AGENT_DEFAULT_MODEL", "").strip().lower()
    if env_raw:
        if env_raw in supported:
            return env_raw
        _LOG.warning(
            "WORKFLOW_AGENT_DEFAULT_MODEL=%r is not a configured model id; ignoring",
            env_raw,
        )
    if isinstance(backend, LlamaCppProcessBackend):
        cfg_dm = backend.models_config.default_model
        if cfg_dm is not None and cfg_dm in supported:
            return cfg_dm
    if "qwen" in supported:
        return "qwen"
    return min(supported)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_application_logging()
    _LOG.info("Workflow Agent ready — routes under /workflow-agent; OpenAPI at /docs")

    backend: ModelRuntimeBackend = app.state.model_runtime_backend
    store: ApplicationStateStore = app.state.state_store
    try:
        if not store.get_snapshot().model_loaded:
            mid = _resolve_startup_model_id(backend)
            if mid is not None:
                try:
                    orchestrate_model_activation(store, backend, mid, force_switch=True)
                    _LOG.info("Startup default model activated: %s", mid)
                except ModelRuntimeError as exc:
                    _LOG.error(
                        "Startup default model activation failed for %s: %s",
                        mid,
                        exc,
                    )

        yield
    finally:
        if isinstance(backend, LlamaCppProcessBackend):
            _LOG.info("Stopping local llama-server subprocess (workflow agent shutdown)")
            backend.shutdown()


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
    configure_application_logging()
    store = state_store or InMemoryApplicationStateStore()
    backend = model_runtime_backend if model_runtime_backend is not None else build_model_runtime_backend()
    app = FastAPI(title="Workflow Agent", version="0.1.0", lifespan=_lifespan)
    # 개발 편의: 브라우저에서 임의 오리진(Studio 등) 허용. 운영 배포 시 출처 제한으로 교체.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # localhost:3000 → 클러스터 사설 IP(10.x) 호출 시 Chrome PNA 프리플라이트 통과
    app.add_middleware(PrivateNetworkAccessMiddleware)
    app.state.state_store = store
    app.state.model_runtime_backend = backend
    app.include_router(status.router)
    app.include_router(skills.router)
    app.include_router(models.router)
    app.include_router(draft.router)
    app.include_router(replan.router)
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
