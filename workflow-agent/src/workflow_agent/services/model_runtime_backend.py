"""Pluggable backend for llama.cpp (or successor) process lifecycle — no shell in HTTP routes."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from workflow_agent.settings.fallback_supported_models import FALLBACK_SUPPORTED_MODEL_IDS


class ModelRuntimeError(RuntimeError):
    """Raised when local llama-server cannot be started, stopped, or verified."""

    def __init__(self, message: str, *, errors: list[str] | None = None) -> None:
        self.errors = errors or [message]
        super().__init__(message)


@runtime_checkable
class ModelRuntimeBackend(Protocol):
    """
    Low-level process/runtime hook for model switching.

    Exactly one logical server is active at a time (spec §3.1).
    """

    def supported_models(self) -> frozenset[str]:
        """Model identifiers that may be passed to ``switch_to_model``."""

    def updates_runtime_loaded_flag_after_switch(self) -> bool:
        """
        If True, orchestration sets ``model_loaded`` to True after ``switch_to_model`` returns.

        Noop backends keep this False so status is not misleading without a real server.
        """

    def switch_to_model(self, model_id: str) -> None:
        """Apply the requested model in the runtime (subprocess / external server)."""


class NoopModelRuntimeBackend:
    """Stub backend when ``WORKFLOW_AGENT_MODELS_CONFIG`` is not set."""

    def supported_models(self) -> frozenset[str]:
        return FALLBACK_SUPPORTED_MODEL_IDS

    def updates_runtime_loaded_flag_after_switch(self) -> bool:
        return False

    def switch_to_model(self, model_id: str) -> None:
        _ = model_id
