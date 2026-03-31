"""Simulate workflow execution order from DSL (StartAt, Next, Condition, Parallel)."""
from typing import Any, Dict, List, Optional, Tuple


def _resolve_start_state(dsl: Dict[str, Any], states: Dict[str, Any]) -> Optional[str]:
    """StartAt가 States에 없으면 top-level Inputs.Next로 보조 (에디터 외부 Input 블록)."""
    start_at = dsl.get("StartAt")
    if isinstance(start_at, str) and start_at in states:
        return start_at
    inputs = dsl.get("Inputs")
    if isinstance(inputs, dict):
        nxt = inputs.get("Next")
        if isinstance(nxt, str) and nxt in states:
            return nxt
    return None


def _is_inputs_pass_state(state_name: str, state: Dict[str, Any]) -> bool:
    """
    States 안에 남아 있는 레거시 Input(Pass)은 모니터/실행에서 노드로 치지 않고 Next만 탄다.
    VLM Pass(플래너)는 제외.
    """
    if (state.get("Type") or "").strip() != "Pass":
        return False
    sk = state.get("Skill")
    if sk == "flow_control.input":
        return True
    if sk:
        return False
    label = str(state.get("Label") or "")
    if state_name.startswith("VLMPlanner") or (
        "VLM" in label.upper() and "PLANNER" in label.upper()
    ):
        return False
    return True


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
    start_at = _resolve_start_state(dsl, states)
    if not start_at:
        return order

    def collect_from(name: str) -> None:
        if name in _visited:
            return
        _visited.add(name)
        state = states.get(name)
        if not state:
            return
        stype = (state.get("Type") or "").strip()
        if _is_inputs_pass_state(name, state):
            next_name = state.get("Next")
            if next_name:
                collect_from(next_name)
            return
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
        if _is_inputs_pass_state(name, state):
            next_name = state.get("Next")
            if next_name:
                walk(next_name)
            return
        out.append((name, state))
        next_name = state.get("Next")
        if next_name:
            walk(next_name)

    walk(branch_start)
    return out
