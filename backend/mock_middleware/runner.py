"""Simulate workflow execution order from DSL (StartAt, Next, Condition, Parallel)."""
from typing import Any, Dict, List, Tuple


def get_execution_order(dsl: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    """
    Flatten DSL into a list of (state_name, state_def) in execution order.
    - Linear: StartAt -> Next -> ... -> End
    - Condition: evaluate (mock: always True -> Then, else Else)
    - Parallel: run all branch states (sequential for mock), then Next
    """
    states = dsl.get("States") or {}
    if not states:
        return []

    order: List[Tuple[str, Dict[str, Any]]] = []
    start_at = dsl.get("StartAt")
    if not start_at or start_at not in states:
        return order

    def collect_from(name: str) -> None:
        if name in _visited:
            return
        _visited.add(name)
        state = states.get(name)
        if not state:
            return
        stype = (state.get("Type") or "").strip()
        if stype == "Condition":
            order.append((name, state))
            # Mock: always take Then
            then_next = (state.get("If") or {}).get("Then")
            else_next = state.get("Else")
            next_name = then_next or else_next
            if next_name:
                collect_from(next_name)
        elif stype == "Parallel":
            # Parallel 자체만 order에 넣고, 브랜치 내부는 앱에서 스레드로 동시 실행
            order.append((name, state))
            next_name = state.get("Next")
            if next_name:
                collect_from(next_name)
        elif stype in ("Skill", "Pass", "Wait"):
            order.append((name, state))
            next_name = state.get("Next")
            if next_name:
                collect_from(next_name)
        else:
            order.append((name, state))
            next_name = state.get("Next")
            if next_name:
                collect_from(next_name)

    def _collect_linear(
        name: str,
        local_states: Dict[str, Any],
        out: List[Tuple[str, Dict[str, Any]]],
        seen: set,
    ) -> None:
        if name in seen:
            return
        seen.add(name)
        state = local_states.get(name)
        if not state:
            return
        out.append((name, state))
        next_name = state.get("Next")
        if next_name:
            _collect_linear(next_name, local_states, out, seen)

    _visited: set = set()
    collect_from(start_at)
    return order


def get_branch_order(branch: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    """한 Parallel 브랜치 내 (state_name, state_def) 순서. 스레드에서 실행용."""
    branch_states = branch.get("States") or {}
    branch_start = branch.get("StartAt")
    if not branch_start or branch_start not in branch_states:
        return []
    out: List[Tuple[str, Dict[str, Any]]] = []
    seen: set = set()

    def walk(name: str) -> None:
        if name in seen:
            return
        seen.add(name)
        state = branch_states.get(name)
        if not state:
            return
        out.append((name, state))
        next_name = state.get("Next")
        if next_name:
            walk(next_name)

    walk(branch_start)
    return out
