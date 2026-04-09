"""POST /workflow-agent/skills/sync request/response."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ParamRange(BaseModel):
    """Numeric `range` object on a skill parameter (middleware / json-schema)."""

    model_config = ConfigDict(extra="forbid")

    min: float | None = None
    max: float | None = None


class SkillParameter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(..., min_length=1, description="Type hint for generated DSL parameters.")
    description: str = Field(..., min_length=1, description="Prompt-facing parameter meaning.")
    range: ParamRange | None = Field(default=None, description="Optional inclusive numeric bounds.")
    candidates: list[str] | None = Field(
        default=None,
        description="Optional enumeration of allowed string values.",
    )

    @model_validator(mode="after")
    def _strip_strings(self) -> SkillParameter:
        self.type = self.type.strip()
        self.description = self.description.strip()
        if not self.type:
            msg = "type must be non-empty"
            raise ValueError(msg)
        if not self.description:
            msg = "description must be non-empty"
            raise ValueError(msg)
        if self.candidates is not None:
            stripped = [c.strip() for c in self.candidates]
            self.candidates = [c for c in stripped if c]
            if not self.candidates:
                self.candidates = None
        return self


class SkillOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _strip_strings(self) -> SkillOutput:
        self.type = self.type.strip()
        self.description = self.description.strip()
        if not self.type or not self.description:
            msg = "type and description must be non-empty"
            raise ValueError(msg)
        return self


class SkillDefinition(BaseModel):
    model_config = ConfigDict(extra="ignore")

    namespace: str | None = Field(default=None, description="Logical skill group (middleware catalog).")
    name: str
    version: str | None = Field(default=None, description="Optional definition version string.")
    description: str
    inputs: dict[str, SkillParameter] = Field(
        default_factory=dict,
        description=(
            "Parameter name → spec; same map as middleware `parameters` (or send `parameters`, see model validator)."
        ),
    )
    outputs: dict[str, SkillOutput] = Field(default_factory=dict)

    @field_validator("inputs", mode="before")
    @classmethod
    def _coerce_legacy_inputs(cls, v: Any) -> dict[str, Any]:
        """Allow legacy shorthand ``{\"arg\": \"string\"}`` as type-only hints."""
        if v is None:
            return {}
        if not isinstance(v, dict):
            msg = "inputs must be an object"
            raise TypeError(msg)
        out: dict[str, Any] = {}
        for key, val in v.items():
            if not isinstance(key, str):
                msg = "input keys must be strings"
                raise TypeError(msg)
            if isinstance(val, str):
                t = val.strip()
                if not t:
                    msg = f"inputs[{key!r}] string shorthand must be non-empty"
                    raise ValueError(msg)
                out[key] = {"type": t, "description": t}
            elif isinstance(val, dict):
                out[key] = val
            else:
                msg = f"inputs[{key!r}] must be a string or object"
                raise TypeError(msg)
        return out

    @field_validator("outputs", mode="before")
    @classmethod
    def _coerce_outputs(cls, v: Any) -> dict[str, Any]:
        if v is None:
            return {}
        if not isinstance(v, dict):
            msg = "outputs must be an object"
            raise TypeError(msg)
        return dict(v)

    @model_validator(mode="before")
    @classmethod
    def _parameters_vs_inputs(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        if "inputs" in d and "parameters" in d:
            d.pop("parameters", None)
        elif "parameters" in d and "inputs" not in d:
            d["inputs"] = d.pop("parameters")
        return d

    @model_validator(mode="after")
    def _strip_and_require_nonempty(self) -> SkillDefinition:
        self.name = self.name.strip()
        self.description = self.description.strip()
        if not self.name:
            msg = "name must be non-empty"
            raise ValueError(msg)
        if not self.description:
            msg = "description must be non-empty"
            raise ValueError(msg)
        if self.namespace is not None:
            ns = self.namespace.strip()
            self.namespace = ns or None
        if self.version is not None:
            vs = self.version.strip()
            self.version = vs or None
        return self


class SkillSyncRequest(BaseModel):
    skills: list[SkillDefinition] = Field(
        ...,
        description="Skill catalog aligned with middleware skill-sets (see docs/json-schemas.md §1).",
    )


class SkillSyncMetadata(BaseModel):
    """Basic sync result metadata for clients/observability."""

    skill_count: int = Field(..., ge=0)
    prompt_context_length: int = Field(..., ge=0, description="Character length of cached prompt context string.")


class SkillSyncResponse(BaseModel):
    success: bool
    skills_hash: str
    metadata: SkillSyncMetadata
