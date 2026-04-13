"""Minimal, deterministic draft prompts (spec §3.3, §7 repair input)."""

from __future__ import annotations

import json
from typing import Any, Literal

# Shape matches ``WorkflowSpec`` / Pydantic models (spec §3.3, §6.1) — not a formal JSON Schema file.
_SCHEMA_PLACEHOLDER = """
Emit one JSON object matching this structure (JSON Schema–style notes):

{
  "type": "object",
  "required": ["start", "nodes"],
  "properties": {
    "start": { "type": "string", "minLength": 1 },
    "nodes": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [
          {
            "type": "object",
            "required": ["type", "skill", "next"],
            "properties": {
              "type": { "const": "skill" },
              "skill": { "type": "string", "minLength": 1 },
              "inputs": { "type": "object" },
              "next": { "type": "string", "minLength": 1 },
              "retry": {
                "type": "object",
                "properties": {
                  "max_attempts": { "type": "integer", "minimum": 1, "maximum": 3 },
                  "on_failure": { "enum": ["fail", "goto"] },
                  "goto_node": { "type": "string" }
                }
              }
            }
          },
          {
            "type": "object",
            "required": ["type", "branches", "default_next"],
            "properties": {
              "type": { "const": "branch" },
              "branches": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "type": "object",
                  "required": ["next"],
                  "properties": {
                    "next": { "type": "string", "minLength": 1 },
                    "label": { "type": "string" }
                  }
                }
              },
              "default_next": { "type": "string", "minLength": 1 }
            }
          },
          {
            "type": "object",
            "required": ["type"],
            "properties": { "type": { "const": "end" } }
          }
        ]
      }
    },
    "version": { "type": "string" }
  }
}

Rules: every next/default_next/branch.next targets a key in nodes; at least one end node; use only listed skill names.
"""

# Condensed from repo ``docs/dsl-example.json`` (Namu editor export). LLMs need this so user requests
# mentioning conditions, loops, fan-out, retries, or global failure handling map to what we can emit.
_FLOW_CONTROL_EDITOR_REFERENCE = """
Flow control (Namu editor DSL — reference only):
The JSON you emit is the *intermediate* graph above; the server compiles it to editor-shaped workflow DSL.
Compilation mapping:
- ``type: "branch"`` → one or more ``Condition`` states: ``If`` uses ``Then`` / ``Else`` to pick the next state; optional ``label`` per arm becomes a condition on ``Label``, otherwise arm index is used.
- ``type: "skill"`` with optional ``retry`` → a ``Skill`` state with an inline ``Retry`` block (``MaxAttempts``, ``OnFailure`` ``fail`` or ``goto``, optional ``GotoState``).
- ``type: "end"`` → ``Succeed`` (terminal).

Editor DSL also includes structures that *this* intermediate format does not model directly (see ``docs/dsl-example.json`` for full JSON). Recognize them when users ask, and approximate with branch/skill/end where possible:
- ``Repeat``: loop with ``RepeatCount``, inner ``StartAt`` + nested ``States``; approximate as a linear sequence of skills or describe repetition in ``inputs`` values only if the skills support it.
- ``Parallel``: ``Parallel`` with ``Branches`` (each branch has its own ``StartAt`` / ``States``); approximate as sequential skills unless the user explicitly needs concurrency (then note parallel steps may require editing in the editor).
- ``Retry`` *wrapper* state: nested ``States`` + ``MaxAttempts`` + optional ``BeforeRetryAfterFailure``; different from per-skill ``retry``. Prefer per-skill ``retry`` on the risky ``skill`` node; mention cleanup hooks may need the editor if the user insists.
- Root ``Inputs`` (``Type``: ``Pass`` + ``Parameters``): global workflow inputs; not emitted by this compiler—user-provided parameter values belong in each ``skill`` node's ``inputs``.
- ``OnFailure``: alternate subgraph when the workflow fails; not emitted—suggest critical paths use ``branch`` + ``skill.retry`` or later manual ``OnFailure`` in the editor.

When in doubt, prefer a clear ``branch`` / ``skill`` / ``end`` graph plus ``retry`` on individual skills.
"""

_CONSTRAINTS_PLACEHOLDER = """
Constraints:
- Use only skill names that appear in the Available skills section.
- Output must be a single JSON object (no markdown code fences, no commentary).
"""

# Replan-only system prefix (workflow-agent/docs/replan-prompt.md): rules through "---" before FOCUS REGION.
_REPLAN_SYSTEM_STATIC_PREFIX = """# Replan Prompt (Workflow Editing)

## SYSTEM ROLE

You are an expert workflow editor.

You are NOT generating a new workflow from scratch.
You are EDITING an existing workflow.

Your primary goal:
→ Make the SMALLEST POSSIBLE CHANGE that satisfies the user request.

You must preserve the existing workflow structure as much as possible.

---

## CRITICAL EDITING RULES

### 1. PRESERVE EXISTING WORKFLOW
- Keep all existing states unless explicitly instructed to remove them
- Do NOT rename or replace existing states unless explicitly requested
- Do NOT restructure unrelated parts of the workflow

### 2. MINIMAL LOCAL CHANGE
- Only modify the focus region (or inferred region)
- Do not change nodes outside the affected region
- Avoid large-scale rewrites

### 3. INSERT, DO NOT REPLACE
- When adding logic, INSERT it into the existing flow
- Do NOT replace existing nodes with new ones unless explicitly requested

### 4. PRESERVE DOWNSTREAM FLOW
- Existing downstream states must remain connected
- Do NOT delete or skip existing nodes
- Continue using existing states whenever possible

### 5. STRUCTURAL INTEGRITY (VERY IMPORTANT)
- All control flow nodes MUST be complete and valid

For example:
- Condition MUST have:
  - condition logic
  - Then
  - Else
- Retry MUST have:
  - MaxAttempts
  - States
  - StartAt
- Parallel MUST have:
  - valid branches

❌ NEVER output incomplete or placeholder control-flow nodes

### 6. NO FULL REWRITE
- Do NOT redesign the workflow
- Do NOT regenerate large portions unnecessarily
- Do NOT simplify by removing nodes

### 7. STATE NAME PRESERVATION
- Reuse existing state names whenever possible
- Do NOT introduce new names if existing ones can be reused

---

"""

# Replan user template (same doc): sections after static system prefix; {current_dsl} is JSON text.
_REPLAN_USER_TEMPLATE = """## FOCUS REGION

Focus states (if provided):
{focus_state_names}

Rules:
- Treat these states as the primary edit region
- Changes should be centered around them
- Avoid modifying unrelated states
- Expand minimally from this region only if required

---

## USER REQUEST

{user_request}

---

## EXISTING WORKFLOW (DSL)

{current_dsl}

---

## EXPECTED BEHAVIOR

You must:
- Modify the workflow according to the user request
- Preserve existing structure
- Apply only minimal necessary changes
- Keep all unrelated states intact

---

## EXAMPLE

### Existing flow:
1 → 2 → 3 → 4 → 5

### User request:
"After node 3, add a condition. If it fails, go to fallback node 4'. Otherwise continue to 4."

### CORRECT behavior:
- Keep 1, 2, 3, 4, 5 unchanged
- Insert a condition after 3
- Success path → existing 4
- Failure path → new 4'
- Continue flow to 5

### INCORRECT behavior:
- Replacing 4 with 4'
- Deleting 4
- Rewriting entire flow after 3
- Dropping existing nodes

---

## OUTPUT REQUIREMENTS

Return ONLY valid JSON.

You must output:
- a complete intermediate workflow spec
- that can be compiled into a valid DSL

---

## SELF CHECK (DO NOT SKIP)

Before producing output, verify:

- Did I preserve all existing states unless explicitly told otherwise?
- Did I avoid deleting or replacing nodes?
- Did I make only minimal changes?
- Did I keep downstream flow intact?
- Are all control-flow nodes complete and valid?

If any answer is "no", fix before output.
"""

_REPAIR_INSTRUCTION = """
This round is a REPAIR attempt: you previously produced output that failed automated checks.
You must emit one corrected FULL intermediate spec JSON object (same schema as above).
Do not apologize or explain; output JSON only.
"""


def build_draft_system_prompt(
    skill_context_block: str,
    *,
    repair_round: bool = False,
    system_prompt_suffix: str | None = None,
) -> str:
    """System message: skills + schema/constraints placeholders."""
    extra = f"\n{_REPAIR_INSTRUCTION}\n" if repair_round else ""
    tail = ""
    if system_prompt_suffix and system_prompt_suffix.strip():
        tail = "\n" + system_prompt_suffix.strip() + "\n"
    return (
        "You convert robot workflow requests into the intermediate workflow JSON format.\n"
        f"{_SCHEMA_PLACEHOLDER}\n"
        f"{_FLOW_CONTROL_EDITOR_REFERENCE}\n"
        f"{_CONSTRAINTS_PLACEHOLDER}\n"
        f"{extra}"
        "\n## Available skills\n"
        f"{skill_context_block}\n"
        f"{tail}"
    )


def build_replan_system_prompt(
    skill_context_block: str,
    *,
    repair_round: bool = False,
    system_prompt_suffix: str | None = None,
) -> str:
    """System message for replan only: edit-in-place rules + same schema/skills tail as draft."""
    extra = f"\n{_REPAIR_INSTRUCTION}\n" if repair_round else ""
    tail = ""
    if system_prompt_suffix and system_prompt_suffix.strip():
        tail = "\n" + system_prompt_suffix.strip() + "\n"
    return (
        f"{_REPLAN_SYSTEM_STATIC_PREFIX}"
        f"{_SCHEMA_PLACEHOLDER}\n"
        f"{_FLOW_CONTROL_EDITOR_REFERENCE}\n"
        f"{_CONSTRAINTS_PLACEHOLDER}\n"
        f"{extra}"
        "\n## Available skills\n"
        f"{skill_context_block}\n"
        f"{tail}"
    )


def build_draft_user_prompt(user_request: str) -> str:
    """User message: natural language intent only."""
    return f"User request:\n{user_request.strip()}\n\nGenerate the intermediate workflow JSON now."


def build_replan_user_prompt(
    *,
    instruction: str,
    current_dsl: dict[str, Any],
    focus_state_names: list[str] | None = None,
    dsl_max_chars: int = 56_000,
) -> str:
    """First replan turn: focus + request + current DSL (workflow-agent/docs/replan-prompt.md)."""
    dumped = json.dumps(current_dsl, indent=2, sort_keys=True, ensure_ascii=False)
    dsl_block = truncate_for_prompt(dumped, max_chars=dsl_max_chars)
    if focus_state_names:
        focus_line = ", ".join(focus_state_names)
    else:
        focus_line = "(none)"
    req = instruction.strip()
    out = _REPLAN_USER_TEMPLATE
    out = out.replace("{focus_state_names}", focus_line, 1)
    out = out.replace("{user_request}", req, 1)
    out = out.replace("{current_dsl}", dsl_block, 1)
    return out


FailurePhase = Literal["spec_parse", "spec_validation", "dsl_validation", "compile"]


def build_repair_user_prompt(
    *,
    user_request: str,
    repair_number: int,
    failure_phase: FailurePhase,
    error_lines: list[str],
    previous_spec: dict[str, Any] | None,
    raw_assistant_excerpt: str | None,
    anchor_context: str | None = None,
) -> str:
    """
    Repair prompt (spec §7): original request + invalid prior output + exact validator errors.

    ``repair_number`` is 1 or 2 for the first/second repair attempt after the initial generation.
    """
    err_block = "\n".join(f"  - {line}" for line in error_lines)
    prev_block = ""
    if previous_spec is not None:
        dumped = truncate_for_prompt(
            json.dumps(previous_spec, indent=2, sort_keys=True, ensure_ascii=False),
        )
        prev_block = f"\nPrevious invalid intermediate spec JSON:\n{dumped}\n"
    elif raw_assistant_excerpt:
        excerpt = truncate_for_prompt(raw_assistant_excerpt)
        prev_block = f"\nPrevious model output (excerpt, may be non-JSON or wrong shape):\n{excerpt}\n"

    anchor_block = ""
    if anchor_context and anchor_context.strip():
        anchor_block = (
            "Context: excerpt of the current editor DSL the user is editing (preserve intent of unchanged parts):\n"
            f"{anchor_context.strip()}\n\n"
        )

    return (
        f"{anchor_block}"
        f"Original user request:\n{user_request.strip()}\n\n"
        f"Repair attempt {repair_number} of 2 after the initial generation.\n"
        f"Failure phase: {failure_phase}.\n\n"
        f"The following errors were reported by the server (fix all of them):\n{err_block}\n"
        f"{prev_block}\n"
        "Output one corrected full JSON object for the intermediate workflow spec now."
    )


def truncate_for_prompt(text: str, max_chars: int = 24000) -> str:
    """Bound repair prompt size."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... (truncated for prompt size)"
