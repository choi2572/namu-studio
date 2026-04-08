"""API tests for deterministic seed data."""

from app.seed import SEED_FAILURE_CODE, SEED_FAILURE_MESSAGE


def test_seeded_workflows_list(seeded_client, seeded_data):
    """Workflows list returns seeded workflows."""
    response = seeded_client.get("/api/workflows")
    assert response.status_code == 200
    payload = response.get_json()

    workflow_ids = {wf["workflowId"] for wf in payload}
    assert seeded_data.workflow_draft_id in workflow_ids
    assert seeded_data.workflow_published_id in workflow_ids

    state_by_id = {wf["workflowId"]: wf["state"] for wf in payload}
    assert state_by_id[seeded_data.workflow_draft_id] == "DRAFT"
    assert state_by_id[seeded_data.workflow_published_id] == "PUBLISHED"


def test_seeded_run_history_list(seeded_client, seeded_data):
    """Run history list returns seeded runs."""
    response = seeded_client.get("/api/runs")
    assert response.status_code == 200
    payload = response.get_json()

    run_ids = {run["runId"] for run in payload}
    assert seeded_data.run_success_id in run_ids
    assert seeded_data.run_failed_id in run_ids

    by_id = {run["runId"]: run for run in payload}
    assert by_id[seeded_data.run_success_id]["status"] == "SUCCESS"
    assert by_id[seeded_data.run_failed_id]["status"] == "FAILED"


def test_seeded_events_pagination(seeded_client, seeded_data):
    """Events pagination by after_seq works for seeded runs."""
    response = seeded_client.get(f"/api/runs/{seeded_data.run_success_id}/events")
    assert response.status_code == 200
    events = response.get_json()
    assert len(events) > 1

    first_seq = events[0]["seq"]
    response = seeded_client.get(f"/api/runs/{seeded_data.run_success_id}/events?afterSeq={first_seq}")
    assert response.status_code == 200
    later_events = response.get_json()

    assert all(event["seq"] > first_seq for event in later_events)
    assert len(later_events) == len(events) - 1


def test_seeded_node_debug_bundle(seeded_client, seeded_data):
    """Node debug endpoint returns seeded debug bundle."""
    response = seeded_client.get(f"/api/runs/{seeded_data.run_success_id}/nodes/{seeded_data.node_fetch_state}/debug")
    assert response.status_code == 200
    payload = response.get_json()

    assert payload["stateName"] == seeded_data.node_fetch_state
    assert payload["input"]["source"] == "seed"
    assert payload["output"]["rows"] == 128
    assert payload["feedback"]["warnings"] == []


def test_seeded_failure_popover_data(seeded_client, seeded_data):
    """Failure popover data exists for failed seeded run."""
    response = seeded_client.get("/api/runs")
    assert response.status_code == 200
    payload = response.get_json()

    failed_runs = [run for run in payload if run["status"] == "FAILED"]
    assert failed_runs

    failed_run = failed_runs[0]
    assert failed_run["failureCode"] == SEED_FAILURE_CODE
    assert failed_run["failureMessage"] == SEED_FAILURE_MESSAGE
