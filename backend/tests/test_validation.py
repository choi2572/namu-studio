"""Test workflow validation (DSL v1)."""

from app.services.validation import validate_workflow_dsl


def test_missing_start_node():
    """Test validation error for missing StartAt."""
    dsl = {
        "States": {
            "State1": {"Type": "Skill", "Skill": "Pick", "Next": "State2"},
            "State2": {"Type": "Skill", "Skill": "Place", "End": True},
        }
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any(e.id == "missing_start" for e in errors)


def test_invalid_start_node():
    """Test validation error when StartAt node doesn't exist."""
    dsl = {
        "StartAt": "NonExistent",
        "States": {
            "State1": {"Type": "Skill", "Skill": "Pick", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any(e.id == "invalid_start" for e in errors)


def test_condition_missing_else():
    """Test validation error for Condition without Else."""
    dsl = {
        "StartAt": "CheckCondition",
        "States": {
            "CheckCondition": {
                "Type": "Condition",
                "If": {
                    "Condition": {
                        "Variable": "$.var_1",
                        "Operator": "==",
                        "Value": True,
                    },
                    "Then": "StateA",
                },
            },
            "StateA": {"Type": "Skill", "Skill": "Pick", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("condition_missing_else" in e.id for e in errors)


def test_condition_invalid_then():
    """Test validation error for Condition with invalid Then reference."""
    dsl = {
        "StartAt": "CheckCondition",
        "States": {
            "CheckCondition": {
                "Type": "Condition",
                "If": {
                    "Condition": {
                        "Variable": "$.var_1",
                        "Operator": "==",
                        "Value": True,
                    },
                    "Then": "NonExistent",
                },
                "Else": "StateB",
            },
            "StateB": {"Type": "Skill", "Skill": "Place", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("condition_invalid_then" in e.id for e in errors)


def test_parallel_missing_startat():
    """Test validation error for Parallel branch missing StartAt."""
    dsl = {
        "StartAt": "ParallelSplit",
        "States": {
            "ParallelSplit": {
                "Type": "Parallel",
                "Branches": [
                    {
                        "States": {
                            "Branch1Start": {
                                "Type": "Skill",
                                "Skill": "Pick",
                                "End": True,
                            },
                        }
                    }
                ],
                "Next": "JoinNode",
            },
            "JoinNode": {"Type": "Skill", "Skill": "Process", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("parallel_missing_startat" in e.id for e in errors)


def test_parallel_nested():
    """Test validation error for nested Parallel (M1 constraint)."""
    dsl = {
        "StartAt": "ParallelSplit",
        "States": {
            "ParallelSplit": {
                "Type": "Parallel",
                "Branches": [
                    {
                        "StartAt": "Branch1Start",
                        "States": {
                            "Branch1Start": {
                                "Type": "Parallel",
                                "Branches": [
                                    {
                                        "StartAt": "NestedStart",
                                        "States": {
                                            "NestedStart": {
                                                "Type": "Pass",
                                                "End": True,
                                            },
                                        },
                                    }
                                ],
                                "End": True,
                            },
                        },
                    }
                ],
                "End": True,
            },
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("parallel_nested" in e.id for e in errors)


def test_cycle_detection():
    """Test cycle detection in workflow."""
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {"Type": "Skill", "Skill": "Pick", "Next": "State2"},
            "State2": {"Type": "Skill", "Skill": "Place", "Next": "State1"},  # Cycle!
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any(e.id == "cycle_detected" for e in errors)


def test_mutually_exclusive_next_and_end():
    """Test validation error for state with both Next and End."""
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {
                "Type": "Skill",
                "Skill": "Pick",
                "Next": "State2",
                "End": True,  # Error!
            },
            "State2": {"Type": "Skill", "Skill": "Place", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("mutually_exclusive" in e.id for e in errors)


def test_missing_terminal():
    """Test validation error for state with neither Next nor End."""
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {
                "Type": "Skill",
                "Skill": "Pick",
                # Missing both Next and End
            },
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("missing_terminal" in e.id for e in errors)


def test_invalid_next_reference():
    """Test validation error for Next referencing non-existent node."""
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {
                "Type": "Skill",
                "Skill": "Pick",
                "Next": "NonExistent",
            },
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("invalid_next" in e.id for e in errors)


def test_wait_missing_event():
    """Test validation error for Wait state without Event."""
    dsl = {
        "StartAt": "WaitNode",
        "States": {
            "WaitNode": {
                "Type": "Wait",
                "Timeout": 300,
                "Next": "ContinueNode",
            },
            "ContinueNode": {"Type": "Skill", "Skill": "Place", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("wait_missing_event" in e.id for e in errors)


def test_wait_missing_timeout():
    """Test validation error for Wait state without Timeout."""
    dsl = {
        "StartAt": "WaitNode",
        "States": {
            "WaitNode": {
                "Type": "Wait",
                "Event": {
                    "Type": "webhook",
                    "Topic": "user_confirmation",
                },
                "Next": "ContinueNode",
            },
            "ContinueNode": {"Type": "Skill", "Skill": "Place", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) > 0
    assert any("wait_missing_timeout" in e.id for e in errors)


def test_valid_linear_workflow():
    """Test that a valid linear workflow passes validation."""
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {
                "Type": "Skill",
                "Skill": "Pick",
                "Parameters": {"target": "bin-A"},
                "Next": "State2",
            },
            "State2": {
                "Type": "Skill",
                "Skill": "Place",
                "Parameters": {"destination": "slot-1"},
                "End": True,
            },
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) == 0


def test_valid_condition_workflow():
    """Test that a valid Condition workflow passes validation."""
    dsl = {
        "StartAt": "CheckCondition",
        "States": {
            "CheckCondition": {
                "Type": "Condition",
                "If": {
                    "Condition": {
                        "Variable": "$.var_1",
                        "Operator": "==",
                        "Value": True,
                    },
                    "Then": "StateA",
                },
                "Else": "StateB",
            },
            "StateA": {"Type": "Skill", "Skill": "Pick", "End": True},
            "StateB": {"Type": "Skill", "Skill": "Place", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) == 0


def test_valid_parallel_workflow():
    """Test that a valid Parallel workflow passes validation."""
    dsl = {
        "StartAt": "ParallelSplit",
        "States": {
            "ParallelSplit": {
                "Type": "Parallel",
                "Branches": [
                    {
                        "StartAt": "Branch1Start",
                        "States": {
                            "Branch1Start": {
                                "Type": "Skill",
                                "Skill": "Pick",
                                "End": True,
                            },
                        },
                    },
                    {
                        "StartAt": "Branch2Start",
                        "States": {
                            "Branch2Start": {
                                "Type": "Skill",
                                "Skill": "Place",
                                "End": True,
                            },
                        },
                    },
                ],
                "Next": "JoinNode",
            },
            "JoinNode": {"Type": "Skill", "Skill": "Process", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) == 0


def test_valid_wait_workflow():
    """Test that a valid Wait workflow passes validation."""
    dsl = {
        "StartAt": "StartNode",
        "States": {
            "StartNode": {
                "Type": "Skill",
                "Skill": "Pick",
                "Next": "WaitNode",
            },
            "WaitNode": {
                "Type": "Wait",
                "Event": {
                    "Type": "webhook",
                    "Topic": "user_confirmation",
                },
                "Timeout": 300,
                "Next": "ContinueNode",
            },
            "ContinueNode": {"Type": "Skill", "Skill": "Place", "End": True},
        },
    }

    errors = validate_workflow_dsl(dsl)
    assert len(errors) == 0
