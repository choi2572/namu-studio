"""Workflow validation logic."""
from typing import List, Dict, Any, Set
from dataclasses import dataclass


@dataclass
class ValidationError:
    """Validation error."""
    id: str
    message: str
    nodeId: str = ""


def validate_workflow_dsl(dsl_json: Dict[str, Any]) -> List[ValidationError]:
    """Validate workflow DSL."""
    errors: List[ValidationError] = []
    
    if not isinstance(dsl_json, dict):
        errors.append(ValidationError(id="invalid_dsl", message="DSL must be an object"))
        return errors
    
    # Check StartAt
    start_at = dsl_json.get("StartAt")
    if not start_at:
        errors.append(ValidationError(id="missing_start", message="Workflow must have exactly one Start node"))
    
    states = dsl_json.get("States", {})
    if not isinstance(states, dict) or not states:
        errors.append(ValidationError(id="no_states", message="Workflow must have at least one state"))
        return errors
    
    # Check StartAt exists
    if start_at and start_at not in states:
        errors.append(ValidationError(id="invalid_start", message=f"StartAt node '{start_at}' not found in States"))
    
    # Check for cycles
    if has_cycle(states, start_at):
        errors.append(ValidationError(id="cycle_detected", message="Workflow contains a cycle"))
    
    # Validate each state
    for state_name, state_def in states.items():
        if not isinstance(state_def, dict):
            continue
        
        state_type = state_def.get("Type", "Task")
        
        # Check condition nodes
        if state_type == "Choice" or state_type == "Condition":
            choices = state_def.get("Choices", [])
            if not isinstance(choices, list) or len(choices) < 2:
                errors.append(ValidationError(
                    id=f"condition_{state_name}",
                    message=f"Condition node '{state_name}' must have exactly two outgoing edges (True/False)",
                    nodeId=state_name
                ))
            else:
                # Check for True/False labels (simplified check)
                has_true = False
                has_false = False
                for choice in choices:
                    if choice.get("Variable") or choice.get("BooleanEquals", True):
                        has_true = True
                    if choice.get("BooleanEquals", False):
                        has_false = True
                
                if not (has_true and has_false):
                    errors.append(ValidationError(
                        id=f"condition_branches_{state_name}",
                        message=f"Condition node '{state_name}' must have both True and False branches",
                        nodeId=state_name
                    ))
        
        # Check for dangling nodes (nodes not reachable from StartAt)
        if state_name != start_at:
            # Check if node is reachable (simplified)
            if not is_reachable(states, start_at, state_name):
                # This is a warning, not an error in M1, but we'll include it
                pass
    
    return errors


def has_cycle(states: Dict[str, Any], start_at: str) -> bool:
    """Check if workflow has a cycle (basic detection)."""
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
        
        # Check Next
        next_node = state_def.get("Next")
        if next_node:
            if dfs(next_node):
                return True
        
        # Check Choices
        choices = state_def.get("Choices", [])
        for choice in choices:
            if isinstance(choice, dict):
                choice_next = choice.get("Next")
                if choice_next and dfs(choice_next):
                    return True
        
        rec_stack.remove(node)
        return False
    
    return dfs(start_at)


def is_reachable(states: Dict[str, Any], start: str, target: str) -> bool:
    """Check if target node is reachable from start."""
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
        
        # Check Next
        next_node = state_def.get("Next")
        if next_node and dfs(next_node):
            return True
        
        # Check Choices
        choices = state_def.get("Choices", [])
        for choice in choices:
            if isinstance(choice, dict):
                choice_next = choice.get("Next")
                if choice_next and dfs(choice_next):
                    return True
        
        return False
    
    return dfs(start)
