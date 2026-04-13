"""Replan: edit an existing editor DSL via NL → intermediate spec → compile (same pipeline as draft)."""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass

from workflow_agent.api.schemas.draft import (
    DraftFailureResponse,
    DraftGuidance,
    DraftMetadata,
    DraftSuccessResponse,
)
from workflow_agent.api.schemas.replan import ReplanRequest
from workflow_agent.dsl.dsl_validation import validate_workflow_dsl
from workflow_agent.dsl.pipeline import compile_validated_spec_pipeline
from workflow_agent.services.application_state import ApplicationStateStore
from workflow_agent.services.draft_guidance import (
    guidance_compile_failed,
    guidance_dsl_validation,
    guidance_internal_error,
    guidance_llm_timeout,
    guidance_model_unavailable,
    guidance_replan_current_dsl_invalid,
    guidance_skills_not_ready,
    guidance_spec_parse,
    guidance_spec_validation,
)
from workflow_agent.services.draft_llm_url import resolve_llama_chat_base_url
from workflow_agent.services.draft_prompt import (
    FailurePhase,
    build_draft_system_prompt,
    build_repair_user_prompt,
    build_replan_user_prompt,
    truncate_for_prompt,
)
from workflow_agent.services.draft_spec_extract import extract_workflow_spec_dict
from workflow_agent.services.llm_client import (
    LlamaChatCompletionClient,
    LLMClientError,
    LLMConnectionError,
    LLMHttpStatusError,
    LLMMalformedResponseError,
    LLMTimeoutError,
    ResponseFormat,
)
from workflow_agent.services.model_activation import normalize_model_id
from workflow_agent.services.model_runtime_backend import ModelRuntimeBackend
from workflow_agent.services.skill_registry import get_prompt_skill_context, get_raw_registry
from workflow_agent.spec.skill_resolution import skill_emit_map_from_registry, skill_names_from_registry_rows
from workflow_agent.spec.validation import parse_and_validate_workflow_spec

_MAX_GENERATION_ATTEMPTS = 3


@dataclass
class _RepairContext:
    phase: FailurePhase
    error_lines: list[str]
    spec_snapshot: dict | None = None
    raw_excerpt: str | None = None


async def generate_replan(
    body: ReplanRequest,
    *,
    store: ApplicationStateStore,
    model_backend: ModelRuntimeBackend,
) -> DraftSuccessResponse | DraftFailureResponse:
    return await asyncio.to_thread(_run_replan_pipeline, body, store, model_backend)


def _run_replan_pipeline(
    body: ReplanRequest,
    store: ApplicationStateStore,
    model_backend: ModelRuntimeBackend,
) -> DraftSuccessResponse | DraftFailureResponse:
    snap = store.get_snapshot()
    req_id = f"replan-{uuid.uuid4()}"

    raw_requested = normalize_model_id(body.model) if body.model and body.model.strip() else None
    if raw_requested and raw_requested != snap.active_model:
        return DraftFailureResponse(
            success=False,
            error_code="REPLAN_MODEL_NOT_ACTIVE",
            errors=[
                f"Requested model {raw_requested!r} but active model is {snap.active_model!r}.",
                "Call POST /workflow-agent/models/activate with the same model id before replanning.",
            ],
            guidance=DraftGuidance(
                basic="Replan uses the currently active llama-server model only.",
                suggestion=f"Activate {raw_requested!r} (or omit model to use {snap.active_model!r}).",
            ),
            last_spec=None,
        )

    effective_model = snap.active_model

    if not snap.alive:
        return _fail("MODEL_UNAVAILABLE", ["Service is not alive."], guidance_model_unavailable())
    if not snap.model_loaded:
        return _fail(
            "MODEL_UNAVAILABLE",
            ["Local model is not loaded (llama-server not ready)."],
            guidance_model_unavailable(),
        )
    if not snap.skills_ready:
        return _fail(
            "SKILL_CONTEXT_NOT_READY",
            ["Skills have not been synced; call POST /workflow-agent/skills/sync first."],
            guidance_skills_not_ready(),
        )

    if effective_model not in model_backend.supported_models():
        return _fail(
            "MODEL_UNAVAILABLE",
            [f"Active model {effective_model!r} is not in the runtime backend configuration."],
            guidance_model_unavailable(),
        )

    dsl_report = validate_workflow_dsl(body.current_dsl)
    if not dsl_report.ok:
        lines = [f"[{e.code}] {e.message}" for e in dsl_report.errors]
        return DraftFailureResponse(
            success=False,
            error_code="REPLAN_CURRENT_DSL_INVALID",
            errors=lines,
            guidance=guidance_replan_current_dsl_invalid(),
            last_spec=None,
        )

    base_url = resolve_llama_chat_base_url(model_backend, effective_model)
    if not base_url:
        return DraftFailureResponse(
            success=False,
            error_code="MODEL_UNAVAILABLE",
            errors=[
                "Cannot resolve llama-server base URL (noop backend or missing YAML model entry).",
                "Set WORKFLOW_AGENT_MODELS_CONFIG and activate a configured model.",
            ],
            guidance=guidance_model_unavailable(),
            last_spec=None,
        )

    skill_block = get_prompt_skill_context()
    raw_registry = get_raw_registry()
    known = skill_names_from_registry_rows(raw_registry)
    skill_emit_map = skill_emit_map_from_registry(raw_registry)
    client = LlamaChatCompletionClient(base_url, timeout=120.0, api_model_name="local")

    anchor_for_repair = truncate_for_prompt(
        json.dumps(body.current_dsl, indent=2, sort_keys=True, ensure_ascii=False),
        max_chars=12_000,
    )
    focus_list = [x for x in body.focus_state_names if isinstance(x, str) and x.strip()]
    focus_for_prompt = focus_list or None

    repair: _RepairContext | None = None
    last_spec_for_response: dict | None = None

    for attempt in range(_MAX_GENERATION_ATTEMPTS):
        is_repair = attempt > 0
        system_prompt = build_draft_system_prompt(
            skill_block,
            repair_round=is_repair,
            system_prompt_suffix=body.system_prompt_suffix,
        )
        if not is_repair:
            user_prompt = build_replan_user_prompt(
                instruction=body.request,
                current_dsl=body.current_dsl,
                focus_state_names=focus_for_prompt,
            )
        else:
            assert repair is not None
            snapdict = repair.spec_snapshot
            if snapdict is not None:
                last_spec_for_response = snapdict
            user_prompt = build_repair_user_prompt(
                user_request=body.request,
                repair_number=attempt,
                failure_phase=repair.phase,
                error_lines=repair.error_lines,
                previous_spec=repair.spec_snapshot,
                raw_assistant_excerpt=repair.raw_excerpt,
                anchor_context=anchor_for_repair,
            )

        try:
            result = client.complete(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                response_format=ResponseFormat(type="json_object"),
                temperature=0.2,
            )
        except LLMTimeoutError as exc:
            return DraftFailureResponse(
                success=False,
                error_code="LLM_TIMEOUT",
                errors=[str(exc), f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})"],
                guidance=guidance_llm_timeout(),
                last_spec=last_spec_for_response,
            )
        except (LLMConnectionError, LLMHttpStatusError) as exc:
            return DraftFailureResponse(
                success=False,
                error_code="MODEL_UNAVAILABLE",
                errors=[str(exc), f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})"],
                guidance=guidance_model_unavailable(),
                last_spec=last_spec_for_response,
            )
        except LLMMalformedResponseError as exc:
            errs = [str(exc), f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})"]
            if _can_repair(attempt):
                repair = _RepairContext(
                    phase="spec_parse",
                    error_lines=errs,
                    spec_snapshot=None,
                    raw_excerpt=None,
                )
                continue
            return DraftFailureResponse(
                success=False,
                error_code="SPEC_PARSE_FAILED",
                errors=errs + _exhausted_suffix(),
                guidance=guidance_spec_parse(),
                last_spec=last_spec_for_response,
            )
        except LLMClientError as exc:
            return DraftFailureResponse(
                success=False,
                error_code="MODEL_UNAVAILABLE",
                errors=[str(exc), f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})"],
                guidance=guidance_model_unavailable(),
                last_spec=last_spec_for_response,
            )

        raw_obj = result.parsed_json
        if raw_obj is None:
            try:
                raw_obj = json.loads(result.content) if result.content.strip() else None
            except json.JSONDecodeError:
                raw_obj = None
        if not isinstance(raw_obj, dict):
            errs = [
                "LLM did not return a JSON object for the workflow spec.",
                f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})",
            ]
            if _can_repair(attempt):
                repair = _RepairContext(
                    phase="spec_parse",
                    error_lines=errs,
                    spec_snapshot=None,
                    raw_excerpt=truncate_for_prompt(result.content),
                )
                continue
            return DraftFailureResponse(
                success=False,
                error_code="SPEC_PARSE_FAILED",
                errors=errs + _exhausted_suffix(),
                guidance=guidance_spec_parse(),
                last_spec=last_spec_for_response,
            )

        spec_dict = extract_workflow_spec_dict(raw_obj)
        if spec_dict is None:
            errs = [
                "JSON is missing a {start, nodes} object (or known wrapper key).",
                f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})",
            ]
            last_spec_for_response = raw_obj
            if _can_repair(attempt):
                repair = _RepairContext(
                    phase="spec_parse",
                    error_lines=errs,
                    spec_snapshot=raw_obj,
                    raw_excerpt=None,
                )
                continue
            return DraftFailureResponse(
                success=False,
                error_code="SPEC_PARSE_FAILED",
                errors=errs + _exhausted_suffix(),
                guidance=guidance_spec_parse(),
                last_spec=raw_obj,
            )

        vr = parse_and_validate_workflow_spec(spec_dict, known_skill_names=known)
        if not vr.ok:
            lines = [f"[{e.code}] {e.message}" for e in vr.parse_errors]
            lines.extend(f"[{e.code}] {e.message}" for e in vr.business_errors)
            lines.append(f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})")
            last = vr.spec.model_dump(mode="json") if vr.spec is not None else spec_dict
            last_spec_for_response = last
            if _can_repair(attempt):
                repair = _RepairContext(
                    phase="spec_validation",
                    error_lines=lines,
                    spec_snapshot=last,
                    raw_excerpt=None,
                )
                continue
            return DraftFailureResponse(
                success=False,
                error_code="SPEC_VALIDATION_FAILED",
                errors=lines + _exhausted_suffix(),
                guidance=guidance_spec_validation(),
                last_spec=last,
            )

        assert vr.spec is not None
        try:
            compile_res = compile_validated_spec_pipeline(vr.spec, skill_emit_map=skill_emit_map)
        except (TypeError, ValueError, KeyError) as exc:
            errs = [
                f"Compile error: {exc}",
                f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})",
            ]
            spec_dump = vr.spec.model_dump(mode="json")
            last_spec_for_response = spec_dump
            if _can_repair(attempt):
                repair = _RepairContext(
                    phase="compile",
                    error_lines=errs,
                    spec_snapshot=spec_dump,
                    raw_excerpt=None,
                )
                continue
            return DraftFailureResponse(
                success=False,
                error_code="COMPILE_FAILED",
                errors=errs + _exhausted_suffix(),
                guidance=guidance_compile_failed(),
                last_spec=spec_dump,
            )

        if not compile_res.dsl_validation.ok:
            lines = [f"[{e.code}] {e.message}" for e in compile_res.dsl_validation.errors]
            lines.append(f"(replan attempt {attempt + 1} of {_MAX_GENERATION_ATTEMPTS})")
            spec_dump = vr.spec.model_dump(mode="json")
            last_spec_for_response = spec_dump
            if _can_repair(attempt):
                repair = _RepairContext(
                    phase="dsl_validation",
                    error_lines=lines,
                    spec_snapshot=spec_dump,
                    raw_excerpt=None,
                )
                continue
            return DraftFailureResponse(
                success=False,
                error_code="DSL_VALIDATION_FAILED",
                errors=lines + _exhausted_suffix(),
                guidance=guidance_dsl_validation(),
                last_spec=spec_dump,
            )

        warnings_out: list[str] = [f"{w.code}: {w.message}" for w in compile_res.warnings]

        return DraftSuccessResponse(
            success=True,
            model=effective_model,
            spec=vr.spec.model_dump(mode="json"),
            dsl=compile_res.dsl,
            warnings=warnings_out,
            metadata=DraftMetadata(request_id=req_id, skills_hash=snap.skills_hash),
        )

    return DraftFailureResponse(
        success=False,
        error_code="INTERNAL_ERROR",
        errors=[
            "Internal error: replan loop exited without result.",
            f"(correlation: {req_id})",
        ],
        guidance=guidance_internal_error(),
        last_spec=last_spec_for_response,
    )


def _can_repair(attempt_index: int) -> bool:
    return attempt_index + 1 < _MAX_GENERATION_ATTEMPTS


def _exhausted_suffix() -> list[str]:
    return ["Repair budget exhausted (1 initial generation + 2 repair attempts)."]


def _fail(code: str, errors: list[str], guidance: DraftGuidance) -> DraftFailureResponse:
    return DraftFailureResponse(
        success=False,
        error_code=code,
        errors=errors,
        guidance=guidance,
        last_spec=None,
    )
