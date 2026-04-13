"""Deterministic client guidance for draft failures (spec §8) — no LLM-generated hints."""

from __future__ import annotations

from workflow_agent.api.schemas.draft import DraftGuidance


def guidance_model_unavailable() -> DraftGuidance:
    return DraftGuidance(
        basic="The local llama.cpp server is missing, not configured, or unreachable.",
        suggestion=(
            "Set WORKFLOW_AGENT_MODELS_CONFIG, activate a model, and confirm "
            "GET /workflow-agent/status shows model_loaded."
        ),
    )


def guidance_llm_timeout() -> DraftGuidance:
    return DraftGuidance(
        basic="The model did not finish generation within the timeout.",
        suggestion=("Retry with a shorter instruction, or adjust server resources / client timeout if allowed."),
    )


def guidance_skills_not_ready() -> DraftGuidance:
    return DraftGuidance(
        basic="Skill context for the LLM has not been loaded.",
        suggestion="Call POST /workflow-agent/skills/sync with the current robot skill list before drafting.",
    )


def guidance_spec_parse() -> DraftGuidance:
    return DraftGuidance(
        basic="The model output could not be read as the required workflow JSON shape.",
        suggestion="Ensure the model emits a single JSON object with start and nodes (see repair errors).",
    )


def guidance_spec_validation() -> DraftGuidance:
    return DraftGuidance(
        basic="The workflow JSON failed server-side schema and graph rules.",
        suggestion=("Fix node references, registry skill names, branch defaults, and reachability to an end node."),
    )


def guidance_compile_failed() -> DraftGuidance:
    return DraftGuidance(
        basic="The compiler could not build DSL from the intermediate spec.",
        suggestion=("This often indicates an internal bug or unsupported pattern; keep last_spec and server logs."),
    )


def guidance_dsl_validation() -> DraftGuidance:
    return DraftGuidance(
        basic="Compiled DSL broke second-stage validation (editor DSL rules).",
        suggestion=(
            "Compare with docs/dsl-example.json: Condition/Repeat/Parallel/Retry shape, "
            "Skill requires Next or End:true, Succeed terminals, and global state id references."
        ),
    )


def guidance_internal_error() -> DraftGuidance:
    return DraftGuidance(
        basic="The draft pipeline stopped unexpectedly; this indicates a server bug.",
        suggestion="Retry once; if it persists, report using the correlation id in the errors list plus server logs.",
    )


def guidance_replan_current_dsl_invalid() -> DraftGuidance:
    return DraftGuidance(
        basic="The workflow JSON sent for replan is not valid editor DSL.",
        suggestion=(
            "Export from the editor again (include OnFailure when used). "
            "Compare shape with docs/dsl-example.json: StartAt, non-empty States, and consistent state references."
        ),
    )
