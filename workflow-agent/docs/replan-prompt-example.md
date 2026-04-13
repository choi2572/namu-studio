# Replan: LLM prompt shape (reference)


Same overall wire format as [draft-prompt-example.md](draft-prompt-example.md), but for `POST /workflow-agent/replan`. Replan uses a **dedicated** system builder (`build_replan_system_prompt`) and user template from [replan-prompt.md](replan-prompt.md). **Draft** continues to use `build_draft_system_prompt` only.

For each LLM call the client sends **two messages**. **System** is built with `build_replan_system_prompt(skill_block, repair_round=attempt>0, system_prompt_suffix=…)` — replan editing rules, then the same schema / flow notes / constraints / **skill catalog** / optional suffix as draft (but **not** the draft opening line). Only the **first user message** differs from draft; **repair rounds** reuse `build_repair_user_prompt()` with an extra **DSL anchor** block.

| Role | Source |
|------|--------|
| `system` | `build_replan_system_prompt(skill_block, repair_round=attempt>0, system_prompt_suffix=…)` — edit-not-rewrite rules, `_SCHEMA_PLACEHOLDER`, `_FLOW_CONTROL_EDITOR_REFERENCE`, `_CONSTRAINTS_PLACEHOLDER`, optional `_REPAIR_INSTRUCTION`, **skill catalog**, optional suffix |
| `user` (initial) | `build_replan_user_prompt(instruction=request, current_dsl=…, focus_state_names=…)` |
| `user` (repair 1–2) | `build_repair_user_prompt(..., user_request=request, anchor_context=truncated_dsl)` |

Skill rendering and the technical system block order (schema → flow → constraints → repair → skills) match draft §2. Difference: **replan system** opens with the replan document (workflow editing role and critical editing rules), not `You convert robot workflow requests…`. **Initial replan** has no `_REPAIR_INSTRUCTION`; **repair** attempts add it (same text as draft).

---

## 1. Request body (HTTP)

Example:

```json
{
  "request": "After PickObject, add another NotifyOps step.",
  "current_dsl": {
    "Comment": "…",
    "StartAt": "DetectObjects",
    "States": { "…": { "…": "…" } },
    "OnFailure": { "…": "…" }
  },
  "focus_state_names": ["PickObject"],
  "model": "qwen",
  "system_prompt_suffix": "…"
}
```

- `current_dsl` must pass `validate_workflow_dsl()` before any LLM call.
- `focus_state_names`: optional list of **state keys** (main `States` or `OnFailure.States`). If empty, the focus line in the user message is `(none)` (see §2.2).
- `system_prompt_suffix`: appended at the **end** of `system` (trimmed), same as draft.

---

## 2. User message — **initial** (`build_replan_user_prompt`)

The user content follows [replan-prompt.md](replan-prompt.md): `## FOCUS REGION` through `## SELF CHECK`, with `focus_state_names`, `user_request`, and `current_dsl` substituted. `current_dsl` is `json.dumps(..., indent=2, sort_keys=True, ensure_ascii=False)`, then truncated to **56_000** characters (`dsl_max_chars`); overflow gets `\n... (truncated for prompt size)`.

### 2.1 With `focus_state_names`

Suppose the instruction is:

> After Pick, add two retries on failure.

The `user` content begins like this (ellipsis omits the rest of the fixed template: EXPECTED BEHAVIOR, EXAMPLE, OUTPUT REQUIREMENTS, SELF CHECK):

```text
## FOCUS REGION

Focus states (if provided):
PickObject, NotifyOps

Rules:
- Treat these states as the primary edit region
- Changes should be centered around them
- Avoid modifying unrelated states
- Expand minimally from this region only if required

---

## USER REQUEST

After Pick, add two retries on failure.

---

## EXISTING WORKFLOW (DSL)

{
  "Comment": "Generated from editor",
  "StartAt": "DetectObjects",
  "States": {
    "DetectObjects": { "...": "..." },
    "PickObject": { "...": "..." },
    "done": { "Type": "Succeed" }
  }
}

---

## EXPECTED BEHAVIOR
…
```

### 2.2 With empty `focus_state_names`

The focus line under “Focus states (if provided):” is the literal `(none)`; the rest of the template is unchanged.

---

## 3. User message — **repair** (`build_repair_user_prompt` + `anchor_context`)

On spec / compile / DSL validation failure, `user` follows the draft repair template, but replan passes:

```python
anchor_for_repair = truncate_for_prompt(
    json.dumps(body.current_dsl, indent=2, sort_keys=True, ensure_ascii=False),
    max_chars=12_000,
)
```

Shape:

```text
Context: excerpt of the current editor DSL the user is editing (preserve intent of unchanged parts):
{ ... up to ~12k chars of current_dsl ... }

Original user request:
<same string as ReplanRequest.request>

Repair attempt <1|2> of 2 after the initial generation.
Failure phase: <spec_parse | spec_validation | dsl_validation | compile>.

The following errors were reported by the server (fix all of them):
  - ...

[Optional] Previous invalid intermediate spec JSON:
{ ... }

Output one corrected full JSON object for the intermediate workflow spec now.
```

- Field name **Original user request** is shared with draft repair; for replan it still holds the **natural-language edit instruction** (`request`), not a “greenfield” workflow description.
- On repair rounds, `system` includes `_REPAIR_INSTRUCTION` (see draft §2 item 5), prepended by the same replan editing rules and technical blocks as the initial turn.

---

## 4. System prompt — replan-specific

Opening is the replan document through the critical editing rules (see [replan-prompt.md](replan-prompt.md)), enforcing **edit, not rewrite** (smallest change, preserve structure, no full rewrite).

Then, in the same order as draft: `_SCHEMA_PLACEHOLDER`, `_FLOW_CONTROL_EDITOR_REFERENCE`, `_CONSTRAINTS_PLACEHOLDER`, optional `_REPAIR_INSTRUCTION`, `## Available skills`, skill block, `system_prompt_suffix`.

**Note:** `_FLOW_CONTROL_EDITOR_REFERENCE` says the intermediate compiler does not emit root `OnFailure`, while replan **user** embeds full editor DSL **including** `OnFailure`. When you tighten prompts, align this so the model is not pulled in two directions.

---

## 5. Wire format to the LLM

Same as draft:

```json
{
  "model": "local",
  "messages": [
    { "role": "system", "content": "<full system>" },
    { "role": "user", "content": "<§2 initial or §3 repair>" }
  ],
  "response_format": { "type": "json_object" },
  "temperature": 0.2,
  "stream": false
}
```

Code: `workflow_agent/services/replan_service.py`, `draft_prompt.py` (`build_replan_system_prompt`, `build_replan_user_prompt`, `build_repair_user_prompt`), `draft_service.py` (repair text parity for draft).
