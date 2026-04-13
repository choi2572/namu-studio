# Replan: LLM prompt shape (reference)


Same layout as [draft-prompt-example.md](draft-prompt-example.md), but for `POST /workflow-agent/replan`. Examples use English so they match the literal strings in `draft_prompt.py`.

For each LLM call the client sends **two messages**. **System** is built with the **same** `build_draft_system_prompt()` as draft. Only the **first user message** differs; **repair rounds** reuse `build_repair_user_prompt()` with an extra **DSL anchor** block.

| Role | Source |
|------|--------|
| `system` | `build_draft_system_prompt(skill_block, repair_round=attempt>0, system_prompt_suffix=…)` — schema, flow notes, constraints, **skill catalog**, optional suffix |
| `user` (initial) | `build_replan_user_prompt(instruction=request, current_dsl=…, focus_state_names=…)` |
| `user` (repair 1–2) | `build_repair_user_prompt(..., user_request=request, anchor_context=truncated_dsl)` |

Skill rendering and system block order match draft §2. Difference: **initial replan** has no `_REPAIR_INSTRUCTION`; **repair** attempts add it (same as draft).

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
- `focus_state_names`: optional list of **state keys** (main `States` or `OnFailure.States`). If empty, the “User-focused …” line is omitted from `user`.
- `system_prompt_suffix`: appended at the **end** of `system` (trimmed), same as draft.

---

## 2. User message — **initial** (`build_replan_user_prompt`)

### 2.1 With `focus_state_names`

Suppose the instruction is:

> After Pick, add two retries on failure.

The `user` content looks like this. `current_dsl` is `json.dumps(..., indent=2, sort_keys=True, ensure_ascii=False)`, then truncated to **56_000** characters (`dsl_max_chars`); overflow gets `\n... (truncated for prompt size)`.

```text
User-focused DSL state names (States or OnFailure keys): PickObject, NotifyOps

Current workflow DSL JSON (editor export; may include OnFailure):
{
  "Comment": "Generated from editor",
  "StartAt": "DetectObjects",
  "States": {
    "DetectObjects": { "...": "..." },
    "PickObject": { "...": "..." },
    "done": { "Type": "Succeed" }
  }
}

Edit instruction:
After Pick, add two retries on failure.

Emit one FULL intermediate workflow spec JSON that applies the instruction. Preserve the behavior of parts the user did not ask to change. Output JSON only — intermediate spec, not editor DSL.
```

### 2.2 With empty `focus_state_names`

The focus line is omitted; `user` starts with `Current workflow DSL JSON…`.

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
- On repair rounds, `system` includes `_REPAIR_INSTRUCTION` (see draft §2 item 5).

---

## 4. System prompt — same as draft

Opening line is unchanged:

```text
You convert robot workflow requests into the intermediate workflow JSON format.
```

Then `_SCHEMA_PLACEHOLDER`, `_FLOW_CONTROL_EDITOR_REFERENCE`, `_CONSTRAINTS_PLACEHOLDER`, optional `_REPAIR_INSTRUCTION`, `## Available skills`, skill block, `system_prompt_suffix`.

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

Code: `workflow_agent/services/replan_service.py`, `draft_prompt.py`, `draft_service.py` (repair text parity).
