"""SQLite repository implementations."""

import json
from datetime import datetime
from typing import Any

from app.db.connection import get_db
from app.domain.models import (
    NodeRun,
    NodeStatus,
    Run,
    RunEvent,
    RunStatus,
    VersionState,
    Workflow,
    WorkflowState,
    WorkflowVersion,
    WorkflowView,
)
from app.repos.interfaces import (
    NodeRunRepository,
    RunEventRepository,
    RunRepository,
    WorkflowRepository,
    WorkflowVersionRepository,
    WorkflowViewRepository,
)


def _datetime_to_iso(dt: datetime | None) -> str | None:
    """Convert datetime to ISO format string."""
    return dt.isoformat() if dt else None


def _iso_to_datetime(iso: str | None) -> datetime | None:
    """Convert ISO format string to datetime."""
    if iso is None:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _json_to_text(data: dict[str, Any] | None) -> str | None:
    """Convert dict to JSON string."""
    return json.dumps(data) if data is not None else None


def _text_to_json(text: str | None) -> dict[str, Any] | None:
    """Convert JSON string to dict."""
    if text is None:
        return None
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None


class WorkflowRepositorySqlite(WorkflowRepository):
    """SQLite workflow repository."""

    def clear(self) -> None:
        """Clear all workflows (for testing)."""
        conn = get_db()
        # Delete in order to respect foreign key constraints
        conn.execute("DELETE FROM workflow_views")
        conn.execute("DELETE FROM workflow_versions")
        conn.execute("DELETE FROM workflows")
        conn.commit()

    def create(self, workflow: Workflow) -> Workflow:
        """Create a new workflow."""
        conn = get_db()
        conn.execute(
            """
            INSERT INTO workflows (
                workflow_id, name, description, state,
                current_published_version_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (
                workflow.workflow_id,
                workflow.name,
                workflow.description,
                workflow.state.value,
                workflow.current_published_version_id,
                _datetime_to_iso(workflow.created_at),
                _datetime_to_iso(workflow.updated_at),
            ),
        )
        conn.commit()
        return workflow

    def get(self, workflow_id: str) -> Workflow | None:
        """Get workflow by ID."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT workflow_id, name, description, state,
                   current_published_version_id, created_at, updated_at
            FROM workflows
            WHERE workflow_id = ?
        """,
            (workflow_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return Workflow(
            workflow_id=row["workflow_id"],
            name=row["name"],
            description=row["description"],
            state=WorkflowState(row["state"]),
            current_published_version_id=row["current_published_version_id"],
            created_at=_iso_to_datetime(row["created_at"]),
            updated_at=_iso_to_datetime(row["updated_at"]),
        )

    def list_all(self) -> list[Workflow]:
        """List all workflows."""
        conn = get_db()
        cursor = conn.execute("""
            SELECT workflow_id, name, description, state,
                   current_published_version_id, created_at, updated_at
            FROM workflows
            ORDER BY created_at DESC
        """)
        workflows = []
        for row in cursor.fetchall():
            workflows.append(
                Workflow(
                    workflow_id=row["workflow_id"],
                    name=row["name"],
                    description=row["description"],
                    state=WorkflowState(row["state"]),
                    current_published_version_id=row["current_published_version_id"],
                    created_at=_iso_to_datetime(row["created_at"]),
                    updated_at=_iso_to_datetime(row["updated_at"]),
                )
            )
        return workflows

    def update(self, workflow: Workflow) -> Workflow:
        """Update workflow."""
        conn = get_db()
        workflow.updated_at = datetime.utcnow()
        conn.execute(
            """
            UPDATE workflows
            SET name = ?, description = ?, state = ?,
                current_published_version_id = ?, updated_at = ?
            WHERE workflow_id = ?
        """,
            (
                workflow.name,
                workflow.description,
                workflow.state.value,
                workflow.current_published_version_id,
                _datetime_to_iso(workflow.updated_at),
                workflow.workflow_id,
            ),
        )
        conn.commit()
        return workflow

    def delete(self, workflow_id: str) -> None:
        """Delete workflow by ID."""
        conn = get_db()
        conn.execute(
            "DELETE FROM workflows WHERE workflow_id = ?",
            (workflow_id,),
        )
        conn.commit()


class WorkflowVersionRepositorySqlite(WorkflowVersionRepository):
    """SQLite workflow version repository."""

    def clear(self) -> None:
        """Clear all versions (for testing)."""
        conn = get_db()
        # Delete in order to respect foreign key constraints
        conn.execute("DELETE FROM workflow_views")
        conn.execute("DELETE FROM workflow_versions")
        conn.commit()

    def create(self, version: WorkflowVersion) -> WorkflowVersion:
        """Create a new version."""
        conn = get_db()
        conn.execute(
            """
            INSERT INTO workflow_versions (
                version_id, workflow_id, version_number, state,
                dsl_json, created_at, published_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (
                version.version_id,
                version.workflow_id,
                version.version_number,
                version.state.value,
                _json_to_text(version.dsl_json),
                _datetime_to_iso(version.created_at),
                _datetime_to_iso(version.published_at),
            ),
        )
        conn.commit()
        return version

    def get(self, version_id: str) -> WorkflowVersion | None:
        """Get version by ID."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT version_id, workflow_id, version_number, state,
                   dsl_json, created_at, published_at
            FROM workflow_versions
            WHERE version_id = ?
        """,
            (version_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return WorkflowVersion(
            version_id=row["version_id"],
            workflow_id=row["workflow_id"],
            version_number=row["version_number"],
            state=VersionState(row["state"]),
            dsl_json=_text_to_json(row["dsl_json"]) or {},
            created_at=_iso_to_datetime(row["created_at"]),
            published_at=_iso_to_datetime(row["published_at"]),
        )

    def get_by_workflow(self, workflow_id: str) -> list[WorkflowVersion]:
        """Get all versions for a workflow."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT version_id, workflow_id, version_number, state,
                   dsl_json, created_at, published_at
            FROM workflow_versions
            WHERE workflow_id = ?
            ORDER BY created_at DESC
        """,
            (workflow_id,),
        )
        versions = []
        for row in cursor.fetchall():
            versions.append(
                WorkflowVersion(
                    version_id=row["version_id"],
                    workflow_id=row["workflow_id"],
                    version_number=row["version_number"],
                    state=VersionState(row["state"]),
                    dsl_json=_text_to_json(row["dsl_json"]) or {},
                    created_at=_iso_to_datetime(row["created_at"]),
                    published_at=_iso_to_datetime(row["published_at"]),
                )
            )
        return versions

    def get_latest_draft(self, workflow_id: str) -> WorkflowVersion | None:
        """Get latest draft version."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT version_id, workflow_id, version_number, state,
                   dsl_json, created_at, published_at
            FROM workflow_versions
            WHERE workflow_id = ? AND state = ?
            ORDER BY created_at DESC
            LIMIT 1
        """,
            (workflow_id, VersionState.DRAFT.value),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return WorkflowVersion(
            version_id=row["version_id"],
            workflow_id=row["workflow_id"],
            version_number=row["version_number"],
            state=VersionState(row["state"]),
            dsl_json=_text_to_json(row["dsl_json"]) or {},
            created_at=_iso_to_datetime(row["created_at"]),
            published_at=_iso_to_datetime(row["published_at"]),
        )

    def update(self, version: WorkflowVersion) -> WorkflowVersion:
        """Update version."""
        conn = get_db()
        conn.execute(
            """
            UPDATE workflow_versions
            SET workflow_id = ?, version_number = ?, state = ?,
                dsl_json = ?, published_at = ?
            WHERE version_id = ?
        """,
            (
                version.workflow_id,
                version.version_number,
                version.state.value,
                _json_to_text(version.dsl_json),
                _datetime_to_iso(version.published_at),
                version.version_id,
            ),
        )
        conn.commit()
        return version

    def delete(self, version_id: str) -> None:
        """Delete version by ID."""
        conn = get_db()
        conn.execute(
            "DELETE FROM workflow_versions WHERE version_id = ?",
            (version_id,),
        )
        conn.commit()


class WorkflowViewRepositorySqlite(WorkflowViewRepository):
    """SQLite workflow view repository."""

    def clear(self) -> None:
        """Clear all views (for testing)."""
        conn = get_db()
        conn.execute("DELETE FROM workflow_views")
        conn.commit()

    def get(self, version_id: str) -> WorkflowView | None:
        """Get view by version ID."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT version_id, view_json, created_at, updated_at
            FROM workflow_views
            WHERE version_id = ?
        """,
            (version_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return WorkflowView(
            version_id=row["version_id"],
            view_json=_text_to_json(row["view_json"]) or {},
            created_at=_iso_to_datetime(row["created_at"]),
            updated_at=_iso_to_datetime(row["updated_at"]),
        )

    def save(self, view: WorkflowView) -> WorkflowView:
        """Save or update view."""
        conn = get_db()
        view.updated_at = datetime.utcnow()
        conn.execute(
            """
            INSERT INTO workflow_views (version_id, view_json, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(version_id) DO UPDATE SET
                view_json = ?,
                updated_at = ?
        """,
            (
                view.version_id,
                _json_to_text(view.view_json),
                _datetime_to_iso(view.created_at),
                _datetime_to_iso(view.updated_at),
                _json_to_text(view.view_json),
                _datetime_to_iso(view.updated_at),
            ),
        )
        conn.commit()
        return view

    def delete(self, version_id: str) -> None:
        """Delete view by version ID."""
        conn = get_db()
        conn.execute(
            "DELETE FROM workflow_views WHERE version_id = ?",
            (version_id,),
        )
        conn.commit()


class RunRepositorySqlite(RunRepository):
    """SQLite run repository."""

    def clear(self) -> None:
        """Clear all runs (for testing)."""
        conn = get_db()
        # Delete in order to respect foreign key constraints
        conn.execute("DELETE FROM run_events")
        conn.execute("DELETE FROM node_runs")
        conn.execute("DELETE FROM runs")
        conn.commit()

    def create(self, run: Run) -> Run:
        """Create a new run."""
        conn = get_db()
        conn.execute(
            """
            INSERT INTO runs (
                run_id, workflow_id, version_id, trigger_type,
                trigger_meta_json, run_input_json, status,
                failure_code, failure_message, started_at,
                finished_at, created_at, updated_at, middleware_workflow_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                run.run_id,
                run.workflow_id,
                run.version_id,
                run.trigger_type,
                _json_to_text(run.trigger_meta_json),
                _json_to_text(run.run_input_json),
                run.status.value,
                run.failure_code,
                run.failure_message,
                _datetime_to_iso(run.started_at),
                _datetime_to_iso(run.finished_at),
                _datetime_to_iso(run.created_at),
                _datetime_to_iso(run.updated_at),
                getattr(run, "middleware_workflow_id", None),
            ),
        )
        conn.commit()
        return run

    def get(self, run_id: str) -> Run | None:
        """Get run by ID."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT run_id, workflow_id, version_id, trigger_type,
                   trigger_meta_json, run_input_json, status,
                   failure_code, failure_message, started_at,
                   finished_at, created_at, updated_at, middleware_workflow_id
            FROM runs
            WHERE run_id = ?
        """,
            (run_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return Run(
            run_id=row["run_id"],
            workflow_id=row["workflow_id"],
            version_id=row["version_id"],
            trigger_type=row["trigger_type"],
            trigger_meta_json=_text_to_json(row["trigger_meta_json"]),
            run_input_json=_text_to_json(row["run_input_json"]),
            status=RunStatus(row["status"]),
            failure_code=row["failure_code"],
            failure_message=row["failure_message"],
            started_at=_iso_to_datetime(row["started_at"]),
            finished_at=_iso_to_datetime(row["finished_at"]),
            created_at=_iso_to_datetime(row["created_at"]),
            updated_at=_iso_to_datetime(row["updated_at"]),
            middleware_workflow_id=row["middleware_workflow_id"] if "middleware_workflow_id" in row.keys() else None,
        )

    def list_all(self, filters: dict | None = None) -> list[Run]:
        """List all runs with optional filters."""
        conn = get_db()
        query = (
            "SELECT run_id, workflow_id, version_id, trigger_type, trigger_meta_json, "
            "run_input_json, status, failure_code, failure_message, started_at, "
            "finished_at, created_at, updated_at, middleware_workflow_id "
            "FROM runs WHERE 1=1"
        )
        params = []

        if filters:
            if "status" in filters:
                query += " AND status = ?"
                params.append(
                    filters["status"].value if isinstance(filters["status"], RunStatus) else filters["status"]
                )
            if "workflow_id" in filters:
                query += " AND workflow_id = ?"
                params.append(filters["workflow_id"])

        query += " ORDER BY started_at DESC, created_at DESC"

        cursor = conn.execute(query, params)
        runs = []
        for row in cursor.fetchall():
            runs.append(
                Run(
                    run_id=row["run_id"],
                    workflow_id=row["workflow_id"],
                    version_id=row["version_id"],
                    trigger_type=row["trigger_type"],
                    trigger_meta_json=_text_to_json(row["trigger_meta_json"]),
                    run_input_json=_text_to_json(row["run_input_json"]),
                    status=RunStatus(row["status"]),
                    failure_code=row["failure_code"],
                    failure_message=row["failure_message"],
                    started_at=_iso_to_datetime(row["started_at"]),
                    finished_at=_iso_to_datetime(row["finished_at"]),
                    created_at=_iso_to_datetime(row["created_at"]),
                    updated_at=_iso_to_datetime(row["updated_at"]),
                    middleware_workflow_id=row["middleware_workflow_id"]
                    if "middleware_workflow_id" in row.keys()
                    else None,
                )
            )
        return runs

    def get_active_run(self) -> Run | None:
        """Get the currently active run (RUNNING or WAITING)."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT run_id, workflow_id, version_id, trigger_type,
                   trigger_meta_json, run_input_json, status,
                   failure_code, failure_message, started_at,
                   finished_at, created_at, updated_at, middleware_workflow_id
            FROM runs
            WHERE status IN (?, ?)
            ORDER BY started_at DESC
            LIMIT 1
        """,
            (RunStatus.RUNNING.value, RunStatus.WAITING.value),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return Run(
            run_id=row["run_id"],
            workflow_id=row["workflow_id"],
            version_id=row["version_id"],
            trigger_type=row["trigger_type"],
            trigger_meta_json=_text_to_json(row["trigger_meta_json"]),
            run_input_json=_text_to_json(row["run_input_json"]),
            status=RunStatus(row["status"]),
            failure_code=row["failure_code"],
            failure_message=row["failure_message"],
            started_at=_iso_to_datetime(row["started_at"]),
            finished_at=_iso_to_datetime(row["finished_at"]),
            created_at=_iso_to_datetime(row["created_at"]),
            updated_at=_iso_to_datetime(row["updated_at"]),
            middleware_workflow_id=row["middleware_workflow_id"] if "middleware_workflow_id" in row.keys() else None,
        )

    def update(self, run: Run) -> Run:
        """Update run."""
        conn = get_db()
        run.updated_at = datetime.utcnow()
        conn.execute(
            """
            UPDATE runs
            SET workflow_id = ?, version_id = ?, trigger_type = ?,
                trigger_meta_json = ?, run_input_json = ?, status = ?,
                failure_code = ?, failure_message = ?, started_at = ?,
                finished_at = ?, updated_at = ?, middleware_workflow_id = ?
            WHERE run_id = ?
        """,
            (
                run.workflow_id,
                run.version_id,
                run.trigger_type,
                _json_to_text(run.trigger_meta_json),
                _json_to_text(run.run_input_json),
                run.status.value,
                run.failure_code,
                run.failure_message,
                _datetime_to_iso(run.started_at),
                _datetime_to_iso(run.finished_at),
                _datetime_to_iso(run.updated_at),
                getattr(run, "middleware_workflow_id", None),
                run.run_id,
            ),
        )
        conn.commit()
        return run

    def delete(self, run_id: str) -> None:
        """Delete run by ID."""
        conn = get_db()
        conn.execute(
            "DELETE FROM runs WHERE run_id = ?",
            (run_id,),
        )
        conn.commit()


class NodeRunRepositorySqlite(NodeRunRepository):
    """SQLite node run repository."""

    def clear(self) -> None:
        """Clear all node runs (for testing)."""
        conn = get_db()
        conn.execute("DELETE FROM node_runs")
        conn.commit()

    def create(self, node_run: NodeRun) -> NodeRun:
        """Create a new node run."""
        conn = get_db()
        conn.execute(
            """
            INSERT INTO node_runs (
                node_run_id, run_id, state_name, node_type, attempt,
                status, started_at, finished_at, duration_ms,
                input_json, output_json, state_snapshot_json,
                feedback_json, decision_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                node_run.node_run_id,
                node_run.run_id,
                node_run.state_name,
                node_run.node_type,
                node_run.attempt,
                node_run.status.value,
                _datetime_to_iso(node_run.started_at),
                _datetime_to_iso(node_run.finished_at),
                node_run.duration_ms,
                _json_to_text(node_run.input_json),
                _json_to_text(node_run.output_json),
                _json_to_text(node_run.state_snapshot_json),
                _json_to_text(node_run.feedback_json),
                _json_to_text(node_run.decision_json),
            ),
        )
        conn.commit()
        return node_run

    def get(self, node_run_id: str) -> NodeRun | None:
        """Get node run by ID."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT node_run_id, run_id, state_name, node_type, attempt,
                   status, started_at, finished_at, duration_ms,
                   input_json, output_json, state_snapshot_json,
                   feedback_json, decision_json
            FROM node_runs
            WHERE node_run_id = ?
        """,
            (node_run_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return NodeRun(
            node_run_id=row["node_run_id"],
            run_id=row["run_id"],
            state_name=row["state_name"],
            node_type=row["node_type"],
            attempt=row["attempt"],
            status=NodeStatus(row["status"]),
            started_at=_iso_to_datetime(row["started_at"]),
            finished_at=_iso_to_datetime(row["finished_at"]),
            duration_ms=row["duration_ms"],
            input_json=_text_to_json(row["input_json"]),
            output_json=_text_to_json(row["output_json"]),
            state_snapshot_json=_text_to_json(row["state_snapshot_json"]),
            feedback_json=_text_to_json(row["feedback_json"]),
            decision_json=_text_to_json(row["decision_json"]),
        )

    def get_by_run(self, run_id: str) -> list[NodeRun]:
        """Get all node runs for a run."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT node_run_id, run_id, state_name, node_type, attempt,
                   status, started_at, finished_at, duration_ms,
                   input_json, output_json, state_snapshot_json,
                   feedback_json, decision_json
            FROM node_runs
            WHERE run_id = ?
            ORDER BY started_at ASC
        """,
            (run_id,),
        )
        node_runs = []
        for row in cursor.fetchall():
            node_runs.append(
                NodeRun(
                    node_run_id=row["node_run_id"],
                    run_id=row["run_id"],
                    state_name=row["state_name"],
                    node_type=row["node_type"],
                    attempt=row["attempt"],
                    status=NodeStatus(row["status"]),
                    started_at=_iso_to_datetime(row["started_at"]),
                    finished_at=_iso_to_datetime(row["finished_at"]),
                    duration_ms=row["duration_ms"],
                    input_json=_text_to_json(row["input_json"]),
                    output_json=_text_to_json(row["output_json"]),
                    state_snapshot_json=_text_to_json(row["state_snapshot_json"]),
                    feedback_json=_text_to_json(row["feedback_json"]),
                    decision_json=_text_to_json(row["decision_json"]),
                )
            )
        return node_runs

    def get_by_run_and_state(self, run_id: str, state_name: str) -> NodeRun | None:
        """Get node run by run ID and state name."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT node_run_id, run_id, state_name, node_type, attempt,
                   status, started_at, finished_at, duration_ms,
                   input_json, output_json, state_snapshot_json,
                   feedback_json, decision_json
            FROM node_runs
            WHERE run_id = ? AND state_name = ?
            ORDER BY attempt DESC
            LIMIT 1
        """,
            (run_id, state_name),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return NodeRun(
            node_run_id=row["node_run_id"],
            run_id=row["run_id"],
            state_name=row["state_name"],
            node_type=row["node_type"],
            attempt=row["attempt"],
            status=NodeStatus(row["status"]),
            started_at=_iso_to_datetime(row["started_at"]),
            finished_at=_iso_to_datetime(row["finished_at"]),
            duration_ms=row["duration_ms"],
            input_json=_text_to_json(row["input_json"]),
            output_json=_text_to_json(row["output_json"]),
            state_snapshot_json=_text_to_json(row["state_snapshot_json"]),
            feedback_json=_text_to_json(row["feedback_json"]),
            decision_json=_text_to_json(row["decision_json"]),
        )

    def update(self, node_run: NodeRun) -> NodeRun:
        """Update node run."""
        conn = get_db()
        conn.execute(
            """
            UPDATE node_runs
            SET run_id = ?, state_name = ?, node_type = ?, attempt = ?,
                status = ?, started_at = ?, finished_at = ?, duration_ms = ?,
                input_json = ?, output_json = ?, state_snapshot_json = ?,
                feedback_json = ?, decision_json = ?
            WHERE node_run_id = ?
        """,
            (
                node_run.run_id,
                node_run.state_name,
                node_run.node_type,
                node_run.attempt,
                node_run.status.value,
                _datetime_to_iso(node_run.started_at),
                _datetime_to_iso(node_run.finished_at),
                node_run.duration_ms,
                _json_to_text(node_run.input_json),
                _json_to_text(node_run.output_json),
                _json_to_text(node_run.state_snapshot_json),
                _json_to_text(node_run.feedback_json),
                _json_to_text(node_run.decision_json),
                node_run.node_run_id,
            ),
        )
        conn.commit()
        return node_run

    def delete_by_run(self, run_id: str) -> None:
        """Delete all node runs for a run."""
        conn = get_db()
        conn.execute(
            "DELETE FROM node_runs WHERE run_id = ?",
            (run_id,),
        )
        conn.commit()


class RunEventRepositorySqlite(RunEventRepository):
    """SQLite run event repository."""

    def clear(self) -> None:
        """Clear all events (for testing)."""
        conn = get_db()
        conn.execute("DELETE FROM run_events")
        conn.commit()

    def create(self, event: RunEvent) -> RunEvent:
        """Create a new event."""
        conn = get_db()
        conn.execute(
            """
            INSERT INTO run_events (
                event_id, run_id, seq, timestamp, event_type,
                state_name, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                event.event_id,
                event.run_id,
                event.seq,
                _datetime_to_iso(event.timestamp),
                event.event_type,
                event.state_name,
                _json_to_text(event.payload_json),
                _datetime_to_iso(event.created_at),
            ),
        )
        conn.commit()
        return event

    def get_by_run(self, run_id: str, after_seq: int | None = None) -> list[RunEvent]:
        """Get events for a run, optionally after a sequence number."""
        conn = get_db()
        if after_seq is not None:
            cursor = conn.execute(
                """
                SELECT event_id, run_id, seq, timestamp, event_type,
                       state_name, payload_json, created_at
                FROM run_events
                WHERE run_id = ? AND seq > ?
                ORDER BY seq ASC
            """,
                (run_id, after_seq),
            )
        else:
            cursor = conn.execute(
                """
                SELECT event_id, run_id, seq, timestamp, event_type,
                       state_name, payload_json, created_at
                FROM run_events
                WHERE run_id = ?
                ORDER BY seq ASC
            """,
                (run_id,),
            )
        events = []
        for row in cursor.fetchall():
            events.append(
                RunEvent(
                    event_id=row["event_id"],
                    run_id=row["run_id"],
                    seq=row["seq"],
                    timestamp=_iso_to_datetime(row["timestamp"]),
                    event_type=row["event_type"],
                    state_name=row["state_name"],
                    payload_json=_text_to_json(row["payload_json"]),
                    created_at=_iso_to_datetime(row["created_at"]),
                )
            )
        return events

    def get_max_seq(self, run_id: str) -> int:
        """Get maximum sequence number for a run."""
        conn = get_db()
        cursor = conn.execute(
            """
            SELECT MAX(seq) as max_seq
            FROM run_events
            WHERE run_id = ?
        """,
            (run_id,),
        )
        row = cursor.fetchone()
        return row["max_seq"] if row and row["max_seq"] is not None else 0

    def delete_by_run(self, run_id: str) -> None:
        """Delete all events for a run."""
        conn = get_db()
        conn.execute(
            "DELETE FROM run_events WHERE run_id = ?",
            (run_id,),
        )
        conn.commit()
