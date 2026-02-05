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
            order.append((name, state))
            branches = state.get("Branches") or []
            for branch in branches:
                branch_start = branch.get("StartAt")
                branch_states = branch.get("States") or {}
                if branch_start:
                    _collect_linear(branch_start, branch_states, order, set())
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
