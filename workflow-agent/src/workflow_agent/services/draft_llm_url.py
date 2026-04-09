"""Resolve llama-server HTTP base URL for the active model id (chat completions)."""

from __future__ import annotations

from workflow_agent.services.llama_cpp_process_backend import LlamaCppProcessBackend
from workflow_agent.services.llm_client import chat_completions_base_url
from workflow_agent.services.model_runtime_backend import ModelRuntimeBackend


def resolve_llama_chat_base_url(model_backend: ModelRuntimeBackend, model_id: str) -> str | None:
    """
    Return chat ``base_url`` when using ``LlamaCppProcessBackend``; ``None`` for noop / unknown id.
    """
    if not isinstance(model_backend, LlamaCppProcessBackend):
        return None
    cfg = model_backend.models_config
    entry = cfg.models.get(model_id)
    if entry is None:
        return None
    return chat_completions_base_url(cfg.host, entry.port)
