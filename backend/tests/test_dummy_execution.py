"""Test dummy execution engine adapter (DSL v1)."""
import pytest
import time
from datetime import datetime

from app.adapters.execution_engine import DummyExecutionEngineAdapter
from app.domain.models import Run, RunStatus, NodeStatus
from app.repos.memory import (
    InMemoryRunRepository,
    InMemoryNodeRunRepository,
    InMemoryRunEventRepository,
    InMemoryWorkflowRepository,
    InMemoryWorkflowVersionRepository,
)


@pytest.fixture
def repos():
    """Create in-memory repositories."""
    run_repo = InMemoryRunRepository()
    node_run_repo = InMemoryNodeRunRepository()
    event_repo = InMemoryRunEventRepository()
    workflow_repo = InMemoryWorkflowRepository()
    version_repo = InMemoryWorkflowVersionRepository()
    
    return {
        "run_repo": run_repo,
        "node_run_repo": node_run_repo,
        "event_repo": event_repo,
        "workflow_repo": workflow_repo,
        "version_repo": version_repo,
    }


@pytest.fixture
def adapter(repos):
    """Create dummy execution adapter."""
    return DummyExecutionEngineAdapter(
        repos["run_repo"],
        repos["node_run_repo"],
        repos["event_repo"],
        repos["workflow_repo"],
        repos["version_repo"],
    )


@pytest.fixture
def run(repos):
    """Create a test run."""
    test_run = Run(
        run_id="test-run-1",
        workflow_id="test-workflow",
        version_id="test-version",
        status=RunStatus.CREATED,
    )
    repos["run_repo"].create(test_run)
    return test_run


def test_linear_flow_execution(adapter, run, repos):
    """Test linear flow execution."""
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
        }
    }
    
    adapter.start_execution(run.run_id, dsl)
    
    # Wait for execution to complete
    time.sleep(2)
    
    # Check run status
    updated_run = repos["run_repo"].get(run.run_id)
    assert updated_run.status == RunStatus.SUCCESS
    assert updated_run.started_at is not None
    assert updated_run.finished_at is not None
    
    # Check node runs
    node_runs = repos["node_run_repo"].list_all({"run_id": run.run_id})
    assert len(node_runs) == 2
    
    state1_run = next((nr for nr in node_runs if nr.state_name == "State1"), None)
    assert state1_run is not None
    assert state1_run.status == NodeStatus.SUCCEEDED
    assert state1_run.node_type == "Skill"
    
    state2_run = next((nr for nr in node_runs if nr.state_name == "State2"), None)
    assert state2_run is not None
    assert state2_run.status == NodeStatus.SUCCEEDED
    
    # Check events
    events = repos["event_repo"].get_by_run(run.run_id)
    event_types = [e.event_type for e in events]
    assert "RUN_CREATED" in event_types
    assert "RUN_STARTED" in event_types
    assert "NODE_STARTED" in event_types
    assert "NODE_SUCCEEDED" in event_types
    assert "RUN_SUCCEEDED" in event_types


def test_condition_true_branch(adapter, run, repos):
    """Test Condition state with True branch."""
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
        }
    }
    
    adapter.start_execution(run.run_id, dsl)
    
    # Wait for execution
    time.sleep(2)
    
    # Check run status
    updated_run = repos["run_repo"].get(run.run_id)
    assert updated_run.status == RunStatus.SUCCESS
    
    # Check that StateA was executed (simulated True branch)
    node_runs = repos["node_run_repo"].list_all({"run_id": run.run_id})
    state_a_run = next((nr for nr in node_runs if nr.state_name == "StateA"), None)
    assert state_a_run is not None
    assert state_a_run.status == NodeStatus.SUCCEEDED
    
    # Check condition decision
    condition_run = next((nr for nr in node_runs if nr.state_name == "CheckCondition"), None)
    assert condition_run is not None
    assert condition_run.decision_json is not None
    assert condition_run.decision_json.get("result") is True


def test_wait_and_resume(adapter, run, repos):
    """Test Wait state and resume."""
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
        }
    }
    
    adapter.start_execution(run.run_id, dsl)
    
    # Wait for execution to reach Wait state
    time.sleep(1)
    
    # Check that run is waiting
    updated_run = repos["run_repo"].get(run.run_id)
    assert updated_run.status == RunStatus.WAITING
    
    # Check Wait node is in WAITING status
    node_runs = repos["node_run_repo"].list_all({"run_id": run.run_id})
    wait_run = next((nr for nr in node_runs if nr.state_name == "WaitNode"), None)
    assert wait_run is not None
    assert wait_run.status == NodeStatus.WAITING
    
    # Check WAITING event
    events = repos["event_repo"].get_by_run(run.run_id)
    event_types = [e.event_type for e in events]
    assert "NODE_WAITING" in event_types
    
    # Resume wait
    adapter.resume_wait(run.run_id, "WaitNode", {"confirmed": True})
    
    # Wait for completion
    time.sleep(1)
    
    # Check final status
    final_run = repos["run_repo"].get(run.run_id)
    assert final_run.status == RunStatus.SUCCESS
    
    # Check that ContinueNode was executed
    final_node_runs = repos["node_run_repo"].list_all({"run_id": run.run_id})
    continue_run = next((nr for nr in final_node_runs if nr.state_name == "ContinueNode"), None)
    assert continue_run is not None
    assert continue_run.status == NodeStatus.SUCCEEDED


def test_parallel_execution(adapter, run, repos):
    """Test Parallel state execution."""
    dsl = {
        "StartAt": "ParallelSplit",
        "States": {
            "ParallelSplit": {
                "Type": "Parallel",
                "Branches": [
                    {
                        "StartAt": "Branch1Start",
                        "States": {
                            "Branch1Start": {"Type": "Skill", "Skill": "Pick", "End": True},
                        }
                    },
                    {
                        "StartAt": "Branch2Start",
                        "States": {
                            "Branch2Start": {"Type": "Skill", "Skill": "Place", "End": True},
                        }
                    },
                ],
                "Next": "JoinNode",
            },
            "JoinNode": {"Type": "Skill", "Skill": "Process", "End": True},
        }
    }
    
    adapter.start_execution(run.run_id, dsl)
    
    # Wait for execution
    time.sleep(2)
    
    # Check run status
    updated_run = repos["run_repo"].get(run.run_id)
    assert updated_run.status == RunStatus.SUCCESS
    
    # Check that Parallel node was executed
    node_runs = repos["node_run_repo"].list_all({"run_id": run.run_id})
    parallel_run = next((nr for nr in node_runs if nr.state_name == "ParallelSplit"), None)
    assert parallel_run is not None
    assert parallel_run.status == NodeStatus.SUCCEEDED
    
    # Check that JoinNode was executed
    join_run = next((nr for nr in node_runs if nr.state_name == "JoinNode"), None)
    assert join_run is not None
    assert join_run.status == NodeStatus.SUCCEEDED


def test_cancel_execution(adapter, run, repos):
    """Test canceling execution."""
    dsl = {
        "StartAt": "State1",
        "States": {
            "State1": {
                "Type": "Skill",
                "Skill": "Pick",
                "Next": "State2",
            },
            "State2": {
                "Type": "Skill",
                "Skill": "Place",
                "End": True,
            },
        }
    }
    
    adapter.start_execution(run.run_id, dsl)
    
    # Wait a bit
    time.sleep(0.5)
    
    # Cancel
    adapter.cancel_execution(run.run_id)
    
    # Wait a bit more
    time.sleep(0.5)
    
    # Check run status
    updated_run = repos["run_repo"].get(run.run_id)
    assert updated_run.status == RunStatus.CANCELED
    assert updated_run.finished_at is not None
    
    # Check CANCELED event
    events = repos["event_repo"].get_by_run(run.run_id)
    event_types = [e.event_type for e in events]
    assert "RUN_CANCELED" in event_types
