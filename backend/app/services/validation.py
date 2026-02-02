"""Workflow validation logic for DSL v1."""
from typing import List, Dict, Any, Set, Optional
from dataclasses import dataclass


@dataclass
class ValidationError:
    """Validation error."""
    id: str
    message: str
    nodeId: str = ""
    error_code: str = ""


def validate_workflow_dsl(dsl_json: Dict[str, Any]) -> List[ValidationError]:
    """Validate workflow DSL v1."""
    errors: List[ValidationError] = []
    
    if not isinstance(dsl_json, dict):
        errors.append(ValidationError(
            id="invalid_dsl",
            message="DSL must be an object",
            error_code="INVALID_DSL"
        ))
        return errors
    
    # Check StartAt
    start_at = dsl_json.get("StartAt")
    if not start_at:
        errors.append(ValidationError(
            id="missing_start",
            message="Workflow must have exactly one StartAt field",
            error_code="MISSING_START_AT"
        ))
        return errors
    
    if not isinstance(start_at, str):
        errors.append(ValidationError(
            id="invalid_start_type",
            message="StartAt must be a string",
            error_code="INVALID_START_AT_TYPE"
        ))
        return errors
    
    states = dsl_json.get("States", {})
    if not isinstance(states, dict) or not states:
        errors.append(ValidationError(
            id="no_states",
            message="Workflow must have at least one state",
            error_code="NO_STATES"
        ))
        return errors
    
    # Check StartAt exists in States
    if start_at not in states:
        errors.append(ValidationError(
            id="invalid_start",
            message=f"StartAt node '{start_at}' not found in States",
            nodeId=start_at,
            error_code="INVALID_START_AT"
        ))
        return errors
    
    # Check for cycles
    if has_cycle(states, start_at):
        errors.append(ValidationError(
            id="cycle_detected",
            message="Workflow contains a cycle",
            error_code="CYCLE_DETECTED"
        ))
    
    # Validate each state
    for state_name, state_def in states.items():
        if not isinstance(state_def, dict):
            errors.append(ValidationError(
                id=f"invalid_state_{state_name}",
                message=f"State '{state_name}' must be an object",
                nodeId=state_name,
                error_code="INVALID_STATE"
            ))
            continue
        
        state_type = state_def.get("Type")
        if not state_type:
            errors.append(ValidationError(
                id=f"missing_type_{state_name}",
                message=f"State '{state_name}' must have Type field",
                nodeId=state_name,
                error_code="MISSING_STATE_TYPE"
            ))
            continue
        
        # Validate End and Next are mutually exclusive
        has_next = "Next" in state_def
        has_end = state_def.get("End", False)
        if has_next and has_end:
            errors.append(ValidationError(
                id=f"mutually_exclusive_{state_name}",
                message=f"State '{state_name}' cannot have both Next and End",
                nodeId=state_name,
                error_code="MUTUALLY_EXCLUSIVE"
            ))
        
        # Terminal nodes must have End=true or Next (Condition/Parallel use If.Then/Else or Branches)
        if not has_next and not has_end:
            if state_type not in ("Condition", "Parallel"):
                errors.append(ValidationError(
                    id=f"missing_terminal_{state_name}",
                    message=f"State '{state_name}' must have either Next or End",
                    nodeId=state_name,
                    error_code="MISSING_TERMINAL"
                ))
        
        # Validate Next references
        if has_next:
            next_node = state_def.get("Next")
            if next_node and next_node not in states:
                errors.append(ValidationError(
                    id=f"invalid_next_{state_name}",
                    message=f"State '{state_name}' references non-existent Next node '{next_node}'",
                    nodeId=state_name,
                    error_code="INVALID_NEXT"
                ))
        
        # State-specific validation
        if state_type == "Condition":
            validate_condition_state(state_name, state_def, states, errors)
        elif state_type == "Parallel":
            validate_parallel_state(state_name, state_def, states, errors)
        elif state_type == "Wait":
            validate_wait_state(state_name, state_def, errors)
        elif state_type == "Skill":
            validate_skill_state(state_name, state_def, errors)
        elif state_type == "Pass":
            validate_pass_state(state_name, state_def, errors)
    
    return errors


def validate_condition_state(
    state_name: str,
    state_def: Dict[str, Any],
    states: Dict[str, Any],
    errors: List[ValidationError]
) -> None:
    """Validate Condition state."""
    if "If" not in state_def:
        errors.append(ValidationError(
            id=f"condition_missing_if_{state_name}",
            message=f"Condition state '{state_name}' must have If field",
            nodeId=state_name,
            error_code="CONDITION_MISSING_IF"
        ))
        return
    
    if_data = state_def.get("If", {})
    if not isinstance(if_data, dict):
        errors.append(ValidationError(
            id=f"condition_invalid_if_{state_name}",
            message=f"Condition state '{state_name}' If must be an object",
            nodeId=state_name,
            error_code="CONDITION_INVALID_IF"
        ))
        return
    
    condition_data = if_data.get("Condition", {})
    if not isinstance(condition_data, dict):
        errors.append(ValidationError(
            id=f"condition_invalid_condition_{state_name}",
            message=f"Condition state '{state_name}' If.Condition must be an object",
            nodeId=state_name,
            error_code="CONDITION_INVALID_CONDITION"
        ))
        return
    
    then_node = if_data.get("Then")
    if not then_node:
        errors.append(ValidationError(
            id=f"condition_missing_then_{state_name}",
            message=f"Condition state '{state_name}' If must have Then field",
            nodeId=state_name,
            error_code="CONDITION_MISSING_THEN"
        ))
    elif then_node not in states:
        errors.append(ValidationError(
            id=f"condition_invalid_then_{state_name}",
            message=f"Condition state '{state_name}' If.Then references non-existent node '{then_node}'",
            nodeId=state_name,
            error_code="CONDITION_INVALID_THEN"
        ))
    
    else_node = state_def.get("Else")
    if not else_node:
        errors.append(ValidationError(
            id=f"condition_missing_else_{state_name}",
            message=f"Condition state '{state_name}' must have Else field",
            nodeId=state_name,
            error_code="CONDITION_MISSING_ELSE"
        ))
    elif else_node not in states:
        errors.append(ValidationError(
            id=f"condition_invalid_else_{state_name}",
            message=f"Condition state '{state_name}' Else references non-existent node '{else_node}'",
            nodeId=state_name,
            error_code="CONDITION_INVALID_ELSE"
        ))


def validate_parallel_state(
    state_name: str,
    state_def: Dict[str, Any],
    states: Dict[str, Any],
    errors: List[ValidationError]
) -> None:
    """Validate Parallel state."""
    branches = state_def.get("Branches", [])
    if not isinstance(branches, list) or len(branches) == 0:
        errors.append(ValidationError(
            id=f"parallel_no_branches_{state_name}",
            message=f"Parallel state '{state_name}' must have at least one branch",
            nodeId=state_name,
            error_code="PARALLEL_NO_BRANCHES"
        ))
        return
    
    for i, branch in enumerate(branches):
        if not isinstance(branch, dict):
            errors.append(ValidationError(
                id=f"parallel_invalid_branch_{state_name}_{i}",
                message=f"Parallel state '{state_name}' branch {i} must be an object",
                nodeId=state_name,
                error_code="PARALLEL_INVALID_BRANCH"
            ))
            continue
        
        branch_start_at = branch.get("StartAt")
        if not branch_start_at:
            errors.append(ValidationError(
                id=f"parallel_missing_startat_{state_name}_{i}",
                message=f"Parallel state '{state_name}' branch {i} must have StartAt",
                nodeId=state_name,
                error_code="PARALLEL_MISSING_START_AT"
            ))
            continue
        
        branch_states = branch.get("States", {})
        if not isinstance(branch_states, dict) or not branch_states:
            errors.append(ValidationError(
                id=f"parallel_no_states_{state_name}_{i}",
                message=f"Parallel state '{state_name}' branch {i} must have States",
                nodeId=state_name,
                error_code="PARALLEL_NO_STATES"
            ))
            continue
        
        if branch_start_at not in branch_states:
            errors.append(ValidationError(
                id=f"parallel_invalid_startat_{state_name}_{i}",
                message=f"Parallel state '{state_name}' branch {i} StartAt '{branch_start_at}' not found in branch States",
                nodeId=state_name,
                error_code="PARALLEL_INVALID_START_AT"
            ))
        
        # Check for nested Parallel (M1 constraint)
        for branch_state_name, branch_state_data in branch_states.items():
            if isinstance(branch_state_data, dict) and branch_state_data.get("Type") == "Parallel":
                errors.append(ValidationError(
                    id=f"parallel_nested_{state_name}_{i}",
                    message=f"Parallel state '{state_name}' branch {i} contains nested Parallel (not allowed in M1)",
                    nodeId=state_name,
                    error_code="PARALLEL_NESTED"
                ))


def validate_wait_state(
    state_name: str,
    state_def: Dict[str, Any],
    errors: List[ValidationError]
) -> None:
    """Validate Wait state."""
    event = state_def.get("Event")
    if not event:
        errors.append(ValidationError(
            id=f"wait_missing_event_{state_name}",
            message=f"Wait state '{state_name}' must have Event field",
            nodeId=state_name,
            error_code="WAIT_MISSING_EVENT"
        ))
        return
    
    if not isinstance(event, dict):
        errors.append(ValidationError(
            id=f"wait_invalid_event_{state_name}",
            message=f"Wait state '{state_name}' Event must be an object",
            nodeId=state_name,
            error_code="WAIT_INVALID_EVENT"
        ))
        return
    
    event_type = event.get("Type")
    if event_type not in ("webhook", "ros_topic"):
        errors.append(ValidationError(
            id=f"wait_invalid_event_type_{state_name}",
            message=f"Wait state '{state_name}' Event.Type must be 'webhook' or 'ros_topic'",
            nodeId=state_name,
            error_code="WAIT_INVALID_EVENT_TYPE"
        ))
    
    if "Timeout" not in state_def:
        errors.append(ValidationError(
            id=f"wait_missing_timeout_{state_name}",
            message=f"Wait state '{state_name}' must have Timeout field",
            nodeId=state_name,
            error_code="WAIT_MISSING_TIMEOUT"
        ))


def validate_skill_state(
    state_name: str,
    state_def: Dict[str, Any],
    errors: List[ValidationError]
) -> None:
    """Validate Skill state."""
    if "Skill" not in state_def:
        errors.append(ValidationError(
            id=f"skill_missing_skill_{state_name}",
            message=f"Skill state '{state_name}' must have Skill field",
            nodeId=state_name,
            error_code="SKILL_MISSING_SKILL"
        ))


def validate_pass_state(
    state_name: str,
    state_def: Dict[str, Any],
    errors: List[ValidationError]
) -> None:
    """Validate Pass state."""
    # Pass state has no additional requirements
    pass


def has_cycle(states: Dict[str, Any], start_at: str) -> bool:
    """Check if workflow has a cycle (DSL v1)."""
    if not start_at:
        return False
    
    visited: Set[str] = set()
    rec_stack: Set[str] = set()
    
    def dfs(node: str) -> bool:
        if node in rec_stack:
            return True  # Cycle detected
        if node in visited:
            return False
        
        visited.add(node)
        rec_stack.add(node)
        
        state_def = states.get(node, {})
        if not isinstance(state_def, dict):
            rec_stack.remove(node)
            return False
        
        state_type = state_def.get("Type")
        
        # Check Next
        next_node = state_def.get("Next")
        if next_node and dfs(next_node):
            return True
        
        # Check Condition branches
        if state_type == "Condition":
            if_data = state_def.get("If", {})
            if isinstance(if_data, dict):
                then_node = if_data.get("Then")
                if then_node and dfs(then_node):
                    return True
            else_node = state_def.get("Else")
            if else_node and dfs(else_node):
                return True
        
        # Check Parallel branches (all branches must be checked)
        if state_type == "Parallel":
            branches = state_def.get("Branches", [])
            for branch in branches:
                if isinstance(branch, dict):
                    branch_start_at = branch.get("StartAt")
                    branch_states = branch.get("States", {})
                    if branch_start_at and branch_start_at in branch_states:
                        if dfs_parallel_branch(branch_states, branch_start_at):
                            return True
        
        rec_stack.remove(node)
        return False
    
    def dfs_parallel_branch(branch_states: Dict[str, Any], node: str) -> bool:
        """DFS for parallel branch (local visited set)."""
        local_visited: Set[str] = set()
        local_rec_stack: Set[str] = set()
        
        def branch_dfs(n: str) -> bool:
            if n in local_rec_stack:
                return True
            if n in local_visited:
                return False
            
            local_visited.add(n)
            local_rec_stack.add(n)
            
            state_def = branch_states.get(n, {})
            if not isinstance(state_def, dict):
                local_rec_stack.remove(n)
                return False
            
            next_node = state_def.get("Next")
            if next_node and branch_dfs(next_node):
                return True
            
            local_rec_stack.remove(n)
            return False
        
        return branch_dfs(node)
    
    return dfs(start_at)


def is_reachable(states: Dict[str, Any], start: str, target: str) -> bool:
    """Check if target node is reachable from start (DSL v1)."""
    if start == target:
        return True
    
    visited: Set[str] = set()
    
    def dfs(node: str) -> bool:
        if node == target:
            return True
        if node in visited:
            return False
        
        visited.add(node)
        state_def = states.get(node, {})
        if not isinstance(state_def, dict):
            return False
        
        state_type = state_def.get("Type")
        
        # Check Next
        next_node = state_def.get("Next")
        if next_node and dfs(next_node):
            return True
        
        # Check Condition branches
        if state_type == "Condition":
            if_data = state_def.get("If", {})
            if isinstance(if_data, dict):
                then_node = if_data.get("Then")
                if then_node and dfs(then_node):
                    return True
            else_node = state_def.get("Else")
            if else_node and dfs(else_node):
                return True
        
        # Check Parallel branches
        if state_type == "Parallel":
            branches = state_def.get("Branches", [])
            for branch in branches:
                if isinstance(branch, dict):
                    branch_start_at = branch.get("StartAt")
                    branch_states = branch.get("States", {})
                    if branch_start_at and branch_start_at in branch_states:
                        if is_reachable_in_branch(branch_states, branch_start_at, target):
                            return True
        
        return False
    
    def is_reachable_in_branch(branch_states: Dict[str, Any], start_node: str, target_node: str) -> bool:
        """Check reachability within a parallel branch."""
        if start_node == target_node:
            return True
        
        local_visited: Set[str] = set()
        
        def branch_dfs(n: str) -> bool:
            if n == target_node:
                return True
            if n in local_visited:
                return False
            
            local_visited.add(n)
            state_def = branch_states.get(n, {})
            if not isinstance(state_def, dict):
                return False
            
            next_node = state_def.get("Next")
            if next_node and branch_dfs(next_node):
                return True
            
            return False
        
        return branch_dfs(start_node)
    
    return dfs(start)
