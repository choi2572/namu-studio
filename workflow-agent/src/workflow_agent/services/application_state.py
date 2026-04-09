"""Central application runtime state (in-memory default; swappable for persistence)."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class ApplicationStateSnapshot:
    """Immutable view of status fields (spec §4.1)."""

    alive: bool
    active_model: str
    model_loaded: bool
    skills_ready: bool
    skills_hash: str


@runtime_checkable
class ApplicationStateStore(Protocol):
    """Boundary for future Redis/DB-backed implementations without changing routes."""

    def get_snapshot(self) -> ApplicationStateSnapshot:
        """Return the current status fields."""

    def set_alive(self, value: bool) -> None:
        """Process-level liveness (e.g. False during graceful shutdown)."""

    def set_active_model(self, model_id: str) -> None:
        """Selected model id (e.g. qwen, gemma); does not imply loaded."""

    def set_model_loaded(self, loaded: bool) -> None:
        """True when llama.cpp (or successor) reports ready; not implemented yet."""

    def set_skills(self, *, ready: bool, skills_hash: str) -> None:
        """Skill registry readiness and content fingerprint."""

    def record_model_switch_request(self, model_id: str) -> None:
        """Atomically apply ``active_model`` and clear ``model_loaded`` (spec §10)."""


class InMemoryApplicationStateStore:
    """Thread-safe RAM-backed store (single process)."""

    DEFAULT_ACTIVE_MODEL = "qwen"

    def __init__(
        self,
        *,
        alive: bool = True,
        active_model: str | None = None,
        model_loaded: bool = False,
        skills_ready: bool = False,
        skills_hash: str = "",
    ) -> None:
        self._lock = threading.Lock()
        self._alive = alive
        self._active_model = active_model or self.DEFAULT_ACTIVE_MODEL
        self._model_loaded = model_loaded
        self._skills_ready = skills_ready
        self._skills_hash = skills_hash

    def get_snapshot(self) -> ApplicationStateSnapshot:
        with self._lock:
            return ApplicationStateSnapshot(
                alive=self._alive,
                active_model=self._active_model,
                model_loaded=self._model_loaded,
                skills_ready=self._skills_ready,
                skills_hash=self._skills_hash,
            )

    def set_alive(self, value: bool) -> None:
        with self._lock:
            self._alive = value

    def set_active_model(self, model_id: str) -> None:
        with self._lock:
            self._active_model = model_id

    def set_model_loaded(self, loaded: bool) -> None:
        with self._lock:
            self._model_loaded = loaded

    def set_skills(self, *, ready: bool, skills_hash: str) -> None:
        with self._lock:
            self._skills_ready = ready
            self._skills_hash = skills_hash

    def record_model_switch_request(self, model_id: str) -> None:
        with self._lock:
            self._active_model = model_id
            self._model_loaded = False
