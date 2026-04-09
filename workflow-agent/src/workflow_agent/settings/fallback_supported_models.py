"""When no YAML-backed backend is used (noop), these ids remain valid for API validation."""

from __future__ import annotations

# Matches spec §3.1 default/optional naming at API level.
FALLBACK_SUPPORTED_MODEL_IDS: frozenset[str] = frozenset({"qwen", "gemma"})
