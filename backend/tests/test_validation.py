"""Test workflow validation."""
import pytest

from app.services.validation import validate_workflow_dsl, ValidationError


def test_missing_start_node():
    """Test validation error for missing StartAt."""
    dsl = {
        "States": {
            "State1": {"Type": "Task", "Next": "State2"},
            "State2": {"Type": "Task"},
        }
    }
    
    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any(e.id == "missing_start" for e in errors)


def test_condition_without_branches():
    """Test validation error for condition without True/False branches."""
    dsl = {
        "StartAt": "CheckCondition",
        "States": {
            "CheckCondition": {
                "Type": "Choice",
                "Choices": [
                    {
                        "Variable": "$.value",
                        "NumericEquals": 5,
                        "Next": "StateA"
                    }
                ],
                "Default": "StateB"
            },
            "StateA": {"Type": "Task"},
            "StateB": {"Type": "Task"},
        }
    }
    
    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("condition" in e.id.lower() for e in errors)


def test_cycle_detection():
    """Test cycle detection in workflow."""
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {"Type": "Task", "Next": "State2"},
            "State2": {"Type": "Task", "Next": "State1"},  # Cycle!
        }
    }
    
    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any(e.id == "cycle_detected" for e in errors)


def test_valid_workflow():
    """Test that a valid workflow passes validation."""
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {"Type": "Task", "Next": "State2"},
            "State2": {"Type": "Task"},
        }
    }
    
    errors = validate_workflow_dsl(dsl)
    assert len(errors) == 0


def test_invalid_start_node():
    """Test validation error when StartAt node doesn't exist."""
    dsl = {
        "StartAt": "NonExistent",
        "States": {
            "State1": {"Type": "Task"},
        }
    }
    
    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any(e.id == "invalid_start" for e in errors)
