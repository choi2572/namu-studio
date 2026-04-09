"""Model manager facade: active model, loaded flag, activation requests (spec §3.1, §10)."""

from __future__ import annotations

from workflow_agent.services.application_state import ApplicationStateStore
from workflow_agent.services.model_activation import (
    ModelActivationOutcome,
    orchestrate_model_activation,
)
from workflow_agent.services.model_runtime_backend import ModelRuntimeBackend


class ModelManager:
    """
    Mediates activation orchestration and read-only access to model-related runtime fields.

    Route handlers should use this (or orchestration + deps) rather than mutating ``ApplicationStateStore`` directly.
    """

    __slots__ = ("_backend", "_store")

    def __init__(self, store: ApplicationStateStore, backend: ModelRuntimeBackend) -> None:
        self._store = store
        self._backend = backend

    @property
    def active_model_id(self) -> str:
        return self._store.get_snapshot().active_model

    @property
    def is_model_loaded(self) -> bool:
        return self._store.get_snapshot().model_loaded

    def request_activation(self, raw_model_id: str) -> ModelActivationOutcome:
        return orchestrate_model_activation(self._store, self._backend, raw_model_id)
