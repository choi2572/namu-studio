"""Second-stage validation for compiled workflow DSL (editor / dsl-example.json shape)."""

from __future__ import annotations

from collections import deque
from typing import Any

from workflow_agent.dsl.types import DslValidationIssue, DslValidationReport

_ALLOWED_ROOT = frozenset({"Comment", "StartAt", "Inputs", "States", "OnFailure"})


def validate_workflow_dsl(dsl: dict[str, Any]) -> DslValidationReport:
    errors: list[DslValidationIssue] = []

    if not isinstance(dsl, dict):
        return DslValidationReport(
            ok=False,
            errors=[
                DslValidationIssue(path="/", code="DSL_NOT_OBJECT", message="DSL root must be an object"),
            ],
        )

    extra = set(dsl.keys()) - _ALLOWED_ROOT
    if extra:
        errors.append(
            DslValidationIssue(
                path="/",
                code="DSL_UNKNOWN_TOP_LEVEL_KEYS",
                message=f"unknown top-level keys: {sorted(extra)!r}",
            ),
        )

    start = dsl.get("StartAt")
    states = dsl.get("States")

    if not isinstance(start, str) or not start.strip():
        errors.append(
            DslValidationIssue(
                path="/StartAt",
                code="INVALID_START_AT",
                message="StartAt must be a non-empty string",
            ),
        )

    if not isinstance(states, dict) or not states:
        errors.append(
            DslValidationIssue(
                path="/States",
                code="INVALID_STATES",
                message="States must be a non-empty object",
            ),
        )
        return DslValidationReport(ok=False, errors=errors)

    if "Inputs" in dsl and dsl["Inputs"] is not None:
        _validate_inputs_block(dsl["Inputs"], errors)

    if "OnFailure" in dsl and dsl["OnFailure"] is not None:
        _validate_failure_subgraph(dsl["OnFailure"], errors)

    reg = _StateIdRegistry()
    _register_state_map(states, "/States", reg, errors)
    if isinstance(dsl.get("OnFailure"), dict):
        of = dsl["OnFailure"]
        if isinstance(of.get("States"), dict):
            _register_state_map(of["States"], "/OnFailure/States", reg, errors)

    if isinstance(start, str) and start.strip() and start not in reg.all_ids:
        errors.append(
            DslValidationIssue(
                path="/StartAt",
                code="START_AT_UNKNOWN",
                message=f"StartAt {start!r} is not defined in States",
            ),
        )

    _validate_state_map_bodies(states, "/States", errors)
    if isinstance(dsl.get("OnFailure"), dict):
        of = dsl["OnFailure"]
        _validate_failure_subgraph_structure(of, errors)
        if isinstance(of.get("States"), dict):
            _validate_state_map_bodies(of["States"], "/OnFailure/States", errors)

    _validate_all_refs(dsl, reg.all_ids, errors)

    succeed_total = _count_succeed_states(states)
    if isinstance(dsl.get("OnFailure"), dict) and isinstance(dsl["OnFailure"].get("States"), dict):
        succeed_total += _count_succeed_states(dsl["OnFailure"]["States"])
    if succeed_total == 0:
        errors.append(
            DslValidationIssue(
                path="/States",
                code="NO_SUCCEED_STATE",
                message="at least one Succeed state is required in States or OnFailure",
            ),
        )

    if isinstance(start, str) and start in states and isinstance(states, dict):
        reachable = _reachable_top_level(start, states)
        unreachable = set(states.keys()) - reachable
        if unreachable:
            errors.append(
                DslValidationIssue(
                    path="/States",
                    code="UNREACHABLE_STATES",
                    message=f"top-level states not reachable from StartAt: {sorted(unreachable)!r}",
                ),
            )

    return DslValidationReport(ok=len(errors) == 0, errors=errors)


class _StateIdRegistry:
    def __init__(self) -> None:
        self.all_ids: set[str] = set()


def _register_state_map(
    states: dict[str, Any],
    base_path: str,
    reg: _StateIdRegistry,
    errors: list[DslValidationIssue],
) -> None:
    for sid, body in states.items():
        path = f"{base_path}/{sid}"
        if not isinstance(sid, str) or not sid.strip():
            errors.append(
                DslValidationIssue(
                    path=path,
                    code="INVALID_STATE_ID",
                    message="state id must be a non-empty string key",
                ),
            )
            continue
        if sid in reg.all_ids:
            errors.append(
                DslValidationIssue(
                    path=path,
                    code="DUPLICATE_STATE_ID",
                    message=f"state id {sid!r} appears in more than one States map",
                ),
            )
        else:
            reg.all_ids.add(sid)
        if isinstance(body, dict):
            _register_nested_ids(body, path, reg, errors)


def _register_nested_ids(
    body: dict[str, Any],
    path_prefix: str,
    reg: _StateIdRegistry,
    errors: list[DslValidationIssue],
) -> None:
    st = body.get("Type")
    if st == "Repeat":
        inner = body.get("States")
        if isinstance(inner, dict):
            _register_state_map(inner, f"{path_prefix}/States", reg, errors)
    elif st == "Parallel":
        branches = body.get("Branches")
        if isinstance(branches, list):
            for i, br in enumerate(branches):
                if isinstance(br, dict) and isinstance(br.get("States"), dict):
                    _register_state_map(br["States"], f"{path_prefix}/Branches/{i}/States", reg, errors)
    elif st == "Retry":
        inner = body.get("States")
        if isinstance(inner, dict):
            _register_state_map(inner, f"{path_prefix}/States", reg, errors)
        braf = body.get("BeforeRetryAfterFailure")
        if isinstance(braf, dict):
            _register_state_map(braf, f"{path_prefix}/BeforeRetryAfterFailure", reg, errors)


def _validate_inputs_block(block: Any, errors: list[DslValidationIssue]) -> None:
    path = "/Inputs"
    if not isinstance(block, dict):
        errors.append(DslValidationIssue(path=path, code="INPUTS_NOT_OBJECT", message="Inputs must be an object"))
        return
    t = block.get("Type")
    if t != "Pass":
        errors.append(
            DslValidationIssue(
                path=f"{path}/Type",
                code="INPUTS_TYPE_UNSUPPORTED",
                message="Inputs.Type must be 'Pass' for current canonical shape",
            ),
        )
    sk = block.get("Skill")
    if not isinstance(sk, str) or not sk.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path}/Skill",
                code="INPUTS_SKILL",
                message="Inputs.Skill must be a non-empty string",
            ),
        )
    nxt = block.get("Next")
    if not isinstance(nxt, str) or not nxt.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path}/Next",
                code="INPUTS_NEXT",
                message="Inputs.Next must be a non-empty string",
            ),
        )
    if "Parameters" in block and block["Parameters"] is not None and not isinstance(block["Parameters"], dict):
        errors.append(
            DslValidationIssue(
                path=f"{path}/Parameters",
                code="INPUTS_PARAMETERS",
                message="Inputs.Parameters must be an object when present",
            ),
        )


def _validate_failure_subgraph(of: Any, errors: list[DslValidationIssue]) -> None:
    if not isinstance(of, dict):
        errors.append(
            DslValidationIssue(path="/OnFailure", code="ON_FAILURE_NOT_OBJECT", message="OnFailure must be an object"),
        )


def _validate_failure_subgraph_structure(of: dict[str, Any], errors: list[DslValidationIssue]) -> None:
    path = "/OnFailure"
    sa = of.get("StartAt")
    if not isinstance(sa, str) or not sa.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path}/StartAt",
                code="ON_FAILURE_START",
                message="OnFailure.StartAt must be a non-empty string",
            ),
        )
    st = of.get("States")
    if not isinstance(st, dict) or not st:
        errors.append(
            DslValidationIssue(
                path=f"{path}/States",
                code="ON_FAILURE_STATES",
                message="OnFailure.States must be a non-empty object",
            ),
        )


def _validate_state_map_bodies(states: dict[str, Any], base_path: str, errors: list[DslValidationIssue]) -> None:
    for sid, body in states.items():
        path_prefix = f"{base_path}/{sid}"
        if not isinstance(body, dict):
            errors.append(
                DslValidationIssue(
                    path=path_prefix,
                    code="STATE_NOT_OBJECT",
                    message="state body must be an object",
                ),
            )
            continue
        stype = body.get("Type")
        if stype == "Skill":
            _validate_skill_state(path_prefix, body, errors)
        elif stype == "Succeed":
            _validate_succeed_state(path_prefix, body, errors)
        elif stype == "Condition":
            _validate_condition_state(path_prefix, body, errors)
        elif stype == "Repeat":
            _validate_repeat_state(path_prefix, body, errors)
        elif stype == "Parallel":
            _validate_parallel_state(path_prefix, body, errors)
        elif stype == "Retry":
            _validate_retry_state(path_prefix, body, errors)
        else:
            errors.append(
                DslValidationIssue(
                    path=f"{path_prefix}/Type",
                    code="UNKNOWN_STATE_TYPE",
                    message=f"unknown Type {stype!r} (expected Skill, Succeed, Condition, Repeat, Parallel, Retry)",
                ),
            )


def _validate_skill_state(path_prefix: str, body: dict[str, Any], errors: list[DslValidationIssue]) -> None:
    if "Choices" in body or "Default" in body:
        errors.append(
            DslValidationIssue(
                path=path_prefix,
                code="SKILL_WITH_CHOICE_FIELDS",
                message="Skill state must not define Choices or Default",
            ),
        )
    sk = body.get("Skill")
    if not isinstance(sk, str) or not sk.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/Skill",
                code="SKILL_MISSING_NAME",
                message="Skill state requires non-empty Skill field",
            ),
        )
    nxt = body.get("Next")
    end = body.get("End")
    has_next = isinstance(nxt, str) and bool(nxt.strip())
    has_end = end is True
    if has_next and has_end:
        errors.append(
            DslValidationIssue(
                path=path_prefix,
                code="SKILL_NEXT_END_CONFLICT",
                message="Skill state must not define both Next and End: true",
            ),
        )
    if not has_next and not has_end:
        errors.append(
            DslValidationIssue(
                path=path_prefix,
                code="SKILL_MISSING_TRANSITION",
                message="Skill state requires non-empty Next or End: true",
            ),
        )
    if "Parameters" in body and body["Parameters"] is not None and not isinstance(body["Parameters"], dict):
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/Parameters",
                code="SKILL_PARAMETERS_TYPE",
                message="Parameters must be an object when present",
            ),
        )
    if "Retry" in body and body["Retry"] is not None:
        _validate_retry_block(f"{path_prefix}/Retry", body["Retry"], errors)


def _validate_succeed_state(path_prefix: str, body: dict[str, Any], errors: list[DslValidationIssue]) -> None:
    if "Next" in body:
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/Next",
                code="SUCCEED_WITH_NEXT",
                message="Succeed state must not define Next",
            ),
        )
    if body.get("End"):
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/End",
                code="SUCCEED_WITH_END",
                message="Succeed state must not define End",
            ),
        )
    if "Choices" in body or "Default" in body:
        errors.append(
            DslValidationIssue(
                path=path_prefix,
                code="SUCCEED_WITH_CHOICE_FIELDS",
                message="Succeed state must not define Choices or Default",
            ),
        )


def _validate_condition_state(path_prefix: str, body: dict[str, Any], errors: list[DslValidationIssue]) -> None:
    if_stmt = body.get("If")
    if not isinstance(if_stmt, dict):
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/If",
                code="CONDITION_IF",
                message="Condition requires If object",
            ),
        )
    else:
        cond = if_stmt.get("Condition")
        if not isinstance(cond, dict):
            errors.append(
                DslValidationIssue(
                    path=f"{path_prefix}/If/Condition",
                    code="CONDITION_PREDICATE",
                    message="If.Condition must be an object",
                ),
            )
        else:
            _validate_predicate(cond, f"{path_prefix}/If/Condition", errors)
        then = if_stmt.get("Then")
        if not isinstance(then, str) or not then.strip():
            errors.append(
                DslValidationIssue(
                    path=f"{path_prefix}/If/Then",
                    code="CONDITION_THEN",
                    message="If.Then must be a non-empty string",
                ),
            )
    el = body.get("Else")
    if not isinstance(el, str) or not el.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/Else",
                code="CONDITION_ELSE",
                message="Condition requires non-empty Else state id",
            ),
        )


def _validate_predicate(cond: dict[str, Any], path: str, errors: list[DslValidationIssue]) -> None:
    if "Type" in cond:
        ct = cond.get("Type")
        if ct == "ArmIndex":
            if not isinstance(cond.get("Index"), int) or cond["Index"] < 0:
                errors.append(
                    DslValidationIssue(
                        path=f"{path}/Index",
                        code="PREDICATE_ARM_INDEX",
                        message="ArmIndex requires non-negative integer Index",
                    ),
                )
        elif ct == "Label":
            if not isinstance(cond.get("Label"), str) or not str(cond.get("Label")).strip():
                errors.append(
                    DslValidationIssue(
                        path=f"{path}/Label",
                        code="PREDICATE_LABEL",
                        message="Label predicate requires non-empty Label string",
                    ),
                )
        else:
            errors.append(
                DslValidationIssue(
                    path=f"{path}/Type",
                    code="PREDICATE_TYPE",
                    message=f"unsupported predicate Type {ct!r}",
                ),
            )
    elif "Variable" in cond and "Operator" in cond and "Value" in cond:
        if not isinstance(cond.get("Operator"), str) or not cond["Operator"].strip():
            errors.append(
                DslValidationIssue(
                    path=f"{path}/Operator",
                    code="PREDICATE_OP",
                    message="comparison Condition requires non-empty Operator string",
                ),
            )
    else:
        errors.append(
            DslValidationIssue(
                path=path,
                code="PREDICATE_SHAPE",
                message="Condition must be ArmIndex, Label, or Variable+Operator+Value comparison",
            ),
        )


def _validate_repeat_state(path_prefix: str, body: dict[str, Any], errors: list[DslValidationIssue]) -> None:
    rc = body.get("RepeatCount")
    if not isinstance(rc, int) or isinstance(rc, bool) or rc < 1:
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/RepeatCount",
                code="REPEAT_COUNT",
                message="Repeat requires integer RepeatCount >= 1",
            ),
        )
    sa = body.get("StartAt")
    if not isinstance(sa, str) or not sa.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/StartAt",
                code="REPEAT_START",
                message="Repeat requires non-empty StartAt",
            ),
        )
    st = body.get("States")
    if not isinstance(st, dict) or not st:
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/States",
                code="REPEAT_STATES",
                message="Repeat.States must be a non-empty object",
            ),
        )
    else:
        if isinstance(sa, str) and sa.strip() and sa not in st:
            errors.append(
                DslValidationIssue(
                    path=f"{path_prefix}/StartAt",
                    code="REPEAT_START_UNKNOWN",
                    message=f"Repeat.StartAt {sa!r} missing from Repeat.States",
                ),
            )
        _validate_state_map_bodies(st, f"{path_prefix}/States", errors)
    nxt = body.get("Next")
    if not isinstance(nxt, str) or not nxt.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/Next",
                code="REPEAT_NEXT",
                message="Repeat requires non-empty Next",
            ),
        )


def _validate_parallel_state(path_prefix: str, body: dict[str, Any], errors: list[DslValidationIssue]) -> None:
    branches = body.get("Branches")
    if not isinstance(branches, list) or len(branches) == 0:
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/Branches",
                code="PARALLEL_BRANCHES",
                message="Parallel requires non-empty Branches array",
            ),
        )
    else:
        for i, br in enumerate(branches):
            bp = f"{path_prefix}/Branches/{i}"
            if not isinstance(br, dict):
                errors.append(
                    DslValidationIssue(path=bp, code="PARALLEL_BRANCH", message="each branch must be an object"),
                )
                continue
            sa = br.get("StartAt")
            if not isinstance(sa, str) or not sa.strip():
                errors.append(
                    DslValidationIssue(
                        path=f"{bp}/StartAt",
                        code="PARALLEL_BRANCH_START",
                        message="branch requires non-empty StartAt",
                    ),
                )
            st = br.get("States")
            if not isinstance(st, dict) or not st:
                errors.append(
                    DslValidationIssue(
                        path=f"{bp}/States",
                        code="PARALLEL_BRANCH_STATES",
                        message="branch.States must be non-empty object",
                    ),
                )
            else:
                if isinstance(sa, str) and sa.strip() and sa not in st:
                    errors.append(
                        DslValidationIssue(
                            path=f"{bp}/StartAt",
                            code="PARALLEL_START_UNKNOWN",
                            message=f"branch StartAt {sa!r} missing from branch.States",
                        ),
                    )
                _validate_state_map_bodies(st, f"{bp}/States", errors)
    nxt = body.get("Next")
    if not isinstance(nxt, str) or not nxt.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/Next",
                code="PARALLEL_NEXT",
                message="Parallel requires non-empty Next",
            ),
        )


def _validate_retry_state(path_prefix: str, body: dict[str, Any], errors: list[DslValidationIssue]) -> None:
    ma_try = body.get("MaxAttempts")
    if not isinstance(ma_try, int) or isinstance(ma_try, bool) or ma_try < 1:
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/MaxAttempts",
                code="RETRY_MAX",
                message="Retry requires integer MaxAttempts >= 1",
            ),
        )
    sa = body.get("StartAt")
    if not isinstance(sa, str) or not sa.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/StartAt",
                code="RETRY_START",
                message="Retry requires non-empty StartAt",
            ),
        )
    st = body.get("States")
    if not isinstance(st, dict) or not st:
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/States",
                code="RETRY_STATES",
                message="Retry.States must be a non-empty object",
            ),
        )
    else:
        if isinstance(sa, str) and sa.strip() and sa not in st:
            errors.append(
                DslValidationIssue(
                    path=f"{path_prefix}/StartAt",
                    code="RETRY_START_UNKNOWN",
                    message=f"Retry.StartAt {sa!r} missing from Retry.States",
                ),
            )
        _validate_state_map_bodies(st, f"{path_prefix}/States", errors)
    braf = body.get("BeforeRetryAfterFailure")
    if braf is not None:
        if not isinstance(braf, dict):
            errors.append(
                DslValidationIssue(
                    path=f"{path_prefix}/BeforeRetryAfterFailure",
                    code="RETRY_BRAF",
                    message="BeforeRetryAfterFailure must be an object mapping state id -> state",
                ),
            )
        else:
            _validate_state_map_bodies(braf, f"{path_prefix}/BeforeRetryAfterFailure", errors)
    nxt = body.get("Next")
    if not isinstance(nxt, str) or not nxt.strip():
        errors.append(
            DslValidationIssue(
                path=f"{path_prefix}/Next",
                code="RETRY_NEXT",
                message="Retry requires non-empty Next",
            ),
        )


def _validate_retry_block(path: str, block: Any, errors: list[DslValidationIssue]) -> None:
    if not isinstance(block, dict):
        errors.append(
            DslValidationIssue(path=path, code="RETRY_NOT_OBJECT", message="Retry must be an object"),
        )
        return
    ma = block.get("MaxAttempts")
    if ma is not None and (not isinstance(ma, int) or isinstance(ma, bool)):
        errors.append(
            DslValidationIssue(
                path=f"{path}/MaxAttempts",
                code="RETRY_BAD_MAX_ATTEMPTS",
                message="MaxAttempts must be an integer if present",
            ),
        )
    of = block.get("OnFailure")
    if of is not None and of not in ("fail", "goto"):
        errors.append(
            DslValidationIssue(
                path=f"{path}/OnFailure",
                code="RETRY_BAD_ON_FAILURE",
                message="OnFailure must be 'fail' or 'goto' if present",
            ),
        )
    if block.get("OnFailure") == "goto":
        g = block.get("GotoState")
        if not isinstance(g, str) or not g.strip():
            errors.append(
                DslValidationIssue(
                    path=f"{path}/GotoState",
                    code="RETRY_GOTO_MISSING",
                    message="GotoState is required when OnFailure is goto",
                ),
            )


def _collect_ref_strings_from_state(body: dict[str, Any], out: list[str]) -> None:
    st = body.get("Type")
    if st == "Skill":
        r = body.get("Retry")
        if isinstance(r, dict) and isinstance(r.get("GotoState"), str):
            out.append(r["GotoState"])
        n = body.get("Next")
        if isinstance(n, str):
            out.append(n)
    elif st == "Condition":
        if_stmt = body.get("If")
        if isinstance(if_stmt, dict):
            t = if_stmt.get("Then")
            if isinstance(t, str):
                out.append(t)
        el = body.get("Else")
        if isinstance(el, str):
            out.append(el)
    elif st in ("Repeat", "Parallel", "Retry"):
        n = body.get("Next")
        if isinstance(n, str):
            out.append(n)
    # nested bodies walked separately


def _collect_refs_from_map(states: dict[str, Any], out: list[str]) -> None:
    for _sid, body in states.items():
        if isinstance(body, dict):
            _collect_ref_strings_from_state(body, out)
            _collect_nested_refs(body, out)


def _collect_nested_refs(body: dict[str, Any], out: list[str]) -> None:
    st = body.get("Type")
    if st == "Repeat":
        inner = body.get("States")
        if isinstance(inner, dict):
            _collect_refs_from_map(inner, out)
    elif st == "Parallel":
        branches = body.get("Branches")
        if isinstance(branches, list):
            for br in branches:
                if isinstance(br, dict) and isinstance(br.get("States"), dict):
                    _collect_refs_from_map(br["States"], out)
    elif st == "Retry":
        inner = body.get("States")
        if isinstance(inner, dict):
            _collect_refs_from_map(inner, out)
        braf = body.get("BeforeRetryAfterFailure")
        if isinstance(braf, dict):
            _collect_refs_from_map(braf, out)


def _validate_all_refs(dsl: dict[str, Any], all_ids: set[str], errors: list[DslValidationIssue]) -> None:
    refs: list[str] = []
    inputs = dsl.get("Inputs")
    if isinstance(inputs, dict):
        n = inputs.get("Next")
        if isinstance(n, str):
            refs.append(n)
    states = dsl.get("States")
    if isinstance(states, dict):
        _collect_refs_from_map(states, refs)
    if isinstance(dsl.get("OnFailure"), dict):
        of = dsl["OnFailure"]
        if isinstance(of.get("States"), dict):
            _collect_refs_from_map(of["States"], refs)

    for r in refs:
        if r.strip() and r not in all_ids:
            errors.append(
                DslValidationIssue(
                    path="/",
                    code="UNKNOWN_TRANSITION_TARGET",
                    message=f"transition target {r!r} is not a registered state id",
                ),
            )


def _count_succeed_states(states: dict[str, Any]) -> int:
    n = 0
    for body in states.values():
        if isinstance(body, dict) and body.get("Type") == "Succeed":
            n += 1
        elif isinstance(body, dict):
            n += _count_succeed_nested(body)
    return n


def _count_succeed_nested(body: dict[str, Any]) -> int:
    st = body.get("Type")
    tot = 0
    if st == "Repeat":
        inner = body.get("States")
        if isinstance(inner, dict):
            tot += _count_succeed_states(inner)
    elif st == "Parallel":
        for br in body.get("Branches") or []:
            if isinstance(br, dict) and isinstance(br.get("States"), dict):
                tot += _count_succeed_states(br["States"])
    elif st == "Retry":
        inner = body.get("States")
        if isinstance(inner, dict):
            tot += _count_succeed_states(inner)
        braf = body.get("BeforeRetryAfterFailure")
        if isinstance(braf, dict):
            tot += _count_succeed_states(braf)
    return tot


def _reachable_top_level(start: str, states: dict[str, Any]) -> set[str]:
    seen: set[str] = set()
    q: deque[str] = deque([start])
    while q:
        cur = q.popleft()
        if cur in seen or cur not in states:
            continue
        seen.add(cur)
        body = states[cur]
        if not isinstance(body, dict):
            continue
        for tgt in _top_level_transition_targets(body):
            if tgt not in seen:
                q.append(tgt)
    return seen


def _top_level_transition_targets(body: dict[str, Any]) -> list[str]:
    st = body.get("Type")
    if st == "Skill":
        out: list[str] = []
        if isinstance(body.get("Next"), str):
            out.append(body["Next"])
        r = body.get("Retry")
        if isinstance(r, dict) and isinstance(r.get("GotoState"), str):
            out.append(r["GotoState"])
        return out
    if st == "Condition":
        out = []
        if_stmt = body.get("If")
        if isinstance(if_stmt, dict) and isinstance(if_stmt.get("Then"), str):
            out.append(if_stmt["Then"])
        if isinstance(body.get("Else"), str):
            out.append(body["Else"])
        return out
    if st in ("Repeat", "Parallel", "Retry"):
        if isinstance(body.get("Next"), str):
            return [body["Next"]]
    if st == "Succeed":
        return []
    return []
