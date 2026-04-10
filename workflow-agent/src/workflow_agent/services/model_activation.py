"""Orchestration for model activation (spec §4.3, §10) — validation, noop detection, state + backend."""

from __future__ import annotations

from dataclasses import dataclass

from workflow_agent.services.application_state import ApplicationStateStore
from workflow_agent.services.model_runtime_backend import ModelRuntimeBackend, ModelRuntimeError


class InvalidModelIdError(ValueError):
    """Raised when the client requests an unknown model identifier."""

    def __init__(self, *, normalized_id: str, errors: list[str]) -> None:
        self.normalized_id = normalized_id
        self.errors = errors
        super().__init__(errors[0] if errors else "invalid model")


@dataclass(frozen=True, slots=True)
class ModelActivationOutcome:
    success: bool
    active_model: str
    already_active: bool
    message: str | None = None


def normalize_model_id(raw: str) -> str:
    """Stable lowercase identifier for comparison and storage."""
    return raw.strip().lower()


def orchestrate_model_activation(
    store: ApplicationStateStore,
    backend: ModelRuntimeBackend,
    raw_model_id: str,
    *,
    force_switch: bool = False,
) -> ModelActivationOutcome:
    """
    Validate id against the backend's configured models, noop if unchanged, else switch runtime.

    ``model_loaded`` is cleared before switching; it is set True only after ``switch_to_model`` succeeds
    when the backend opts in via ``updates_runtime_loaded_flag_after_switch``.
    """
    normalized = normalize_model_id(raw_model_id)
    supported = backend.supported_models()
    if normalized not in supported:
        allowed = ", ".join(sorted(supported))
        raise InvalidModelIdError(
            normalized_id=normalized,
            errors=[f"Unknown model id {raw_model_id!r}; allowed: {allowed}"],
        )

    snap = store.get_snapshot()
    # Same model id alone is not enough: after a failed switch or agent restart,
    # active_model may match while model_loaded is still False. In that case we
    # must run switch_to_model again (POST /models/activate does not use force_switch).
    if snap.active_model == normalized and not force_switch and snap.model_loaded:
        return ModelActivationOutcome(
            success=True,
            active_model=normalized,
            already_active=True,
            message="already_active",
        )

    store.record_model_switch_request(normalized)
    try:
        backend.switch_to_model(normalized)
    except ModelRuntimeError:
        store.set_model_loaded(False)
        raise

    if backend.updates_runtime_loaded_flag_after_switch():
        store.set_model_loaded(True)

    return ModelActivationOutcome(
        success=True,
        active_model=normalized,
        already_active=False,
        message=None,
    )
