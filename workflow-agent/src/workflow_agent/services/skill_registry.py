"""Raw skill registry storage, prompt context cache, and sync orchestration (spec §3.2, §4.2)."""

from __future__ import annotations

import copy
import hashlib
import json
import threading
from dataclasses import dataclass
from typing import Any

from workflow_agent.api.schemas.skills import SkillDefinition, SkillParameter, SkillOutput
from workflow_agent.services.application_state import ApplicationStateStore
from workflow_agent.services.skill_context_builder import build_prompt_skill_context


@dataclass(frozen=True, slots=True)
class SkillSyncOutcome:
    skills_hash: str
    skill_count: int
    prompt_context_length: int


class _InMemorySkillRegistryStore:
    __slots__ = ("_lock", "_prompt_skill_context", "_raw_registry")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._raw_registry: list[dict[str, Any]] = []
        self._prompt_skill_context: str = ""

    def replace(self, raw: list[dict[str, Any]], prompt_text: str) -> None:
        with self._lock:
            self._raw_registry = copy.deepcopy(raw)
            self._prompt_skill_context = prompt_text

    def snapshot_raw(self) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._raw_registry)

    def get_prompt_context(self) -> str:
        with self._lock:
            return self._prompt_skill_context


_STORE = _InMemorySkillRegistryStore()


def _canonical_param_dict(p: SkillParameter) -> dict[str, Any]:
    payload = p.model_dump(mode="json", exclude_none=True)
    return dict(sorted(payload.items()))


def _canonical_output_dict(o: SkillOutput) -> dict[str, Any]:
    payload = o.model_dump(mode="json", exclude_none=True)
    return dict(sorted(payload.items()))


def _canonical_skill_dict(skill: SkillDefinition) -> dict[str, Any]:
    row: dict[str, Any] = {
        "name": skill.name,
        "description": skill.description,
        "inputs": {k: _canonical_param_dict(skill.inputs[k]) for k in sorted(skill.inputs)},
    }
    if skill.outputs:
        row["outputs"] = {k: _canonical_output_dict(skill.outputs[k]) for k in sorted(skill.outputs)}
    if skill.namespace:
        row["namespace"] = skill.namespace
    if skill.version:
        row["version"] = skill.version
    return dict(sorted(row.items()))


def _normalize_registry(skills: list[SkillDefinition]) -> list[dict[str, Any]]:
    rows = [_canonical_skill_dict(s) for s in skills]
    rows.sort(key=lambda row: row["name"])
    return rows


def _registry_hash(normalized: list[dict[str, Any]]) -> str:
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def sync_from_studio(store: ApplicationStateStore, skills: list[SkillDefinition]) -> SkillSyncOutcome:
    """Replace in-memory registry, rebuild prompt context, update runtime status fields."""
    normalized = _normalize_registry(skills)
    prompt_text = build_prompt_skill_context(normalized)
    digest = _registry_hash(normalized)
    skills_ready = len(normalized) > 0

    _STORE.replace(normalized, prompt_text)
    store.set_skills(ready=skills_ready, skills_hash=digest)
    return SkillSyncOutcome(
        skills_hash=digest,
        skill_count=len(normalized),
        prompt_context_length=len(prompt_text),
    )


def get_raw_registry() -> list[dict[str, Any]]:
    """Return a deep copy of the last synced raw registry (for callers outside HTTP)."""
    return _STORE.snapshot_raw()


def get_prompt_skill_context() -> str:
    """Cached prompt-ready skill block from the last successful sync."""
    return _STORE.get_prompt_context()
