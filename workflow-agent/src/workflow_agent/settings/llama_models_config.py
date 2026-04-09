"""YAML configuration for local llama-server instances (one model id → GGUF path + port)."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator


class ModelServeEntry(BaseModel):
    gguf_path: str
    port: int = Field(..., ge=1, le=65535)
    extra_args: list[str] = Field(default_factory=list)


class LlamaModelsConfig(BaseModel):
    llama_server_executable: str = "llama-server"
    host: str = "127.0.0.1"
    startup_timeout_seconds: float = Field(90.0, gt=0)
    shutdown_timeout_seconds: float = Field(15.0, gt=0)
    healthcheck_timeout_seconds: float = Field(5.0, gt=0)
    health_poll_interval_seconds: float = Field(0.5, gt=0, le=10.0)
    health_path: str = "/health"
    default_model: str | None = Field(
        None,
        description="Startup activate target; must be a key in ``models`` when set.",
    )
    models: dict[str, ModelServeEntry]

    @field_validator("default_model", mode="before")
    @classmethod
    def _normalize_default_model(cls, value: object) -> object:
        if value is None or value == "":
            return None
        if isinstance(value, str):
            stripped = value.strip().lower()
            return stripped if stripped else None
        return value

    @model_validator(mode="after")
    def _ports_are_unique(self) -> LlamaModelsConfig:
        seen: dict[int, str] = {}
        for mid, entry in self.models.items():
            if entry.port in seen:
                msg = f"duplicate listen port {entry.port} on models {seen[entry.port]!r} and {mid!r}"
                raise ValueError(msg)
            seen[entry.port] = mid
        return self

    @model_validator(mode="after")
    def _default_model_must_exist(self) -> LlamaModelsConfig:
        if self.default_model is not None and self.default_model not in self.models:
            allowed = ", ".join(sorted(self.models))
            msg = f"default_model {self.default_model!r} missing from models keys: {allowed}"
            raise ValueError(msg)
        return self

    @classmethod
    def load_yaml_path(cls, path: Path) -> LlamaModelsConfig:
        raw_text = path.read_text(encoding="utf-8")
        data = yaml.safe_load(raw_text)
        if not isinstance(data, dict):
            msg = f"YAML root must be a mapping: {path}"
            raise ValueError(msg)
        return cls.model_validate(data)

    def resolve_gguf_path(self, config_file: Path, entry: ModelServeEntry) -> Path:
        p = Path(entry.gguf_path)
        if not p.is_absolute():
            p = (config_file.parent / p).resolve()
        return p
