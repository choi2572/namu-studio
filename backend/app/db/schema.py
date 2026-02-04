"""Database schema and migrations."""
import sqlite3
import json
from typing import Optional


SCHEMA_VERSION = 2


def migrate_schema(conn: sqlite3.Connection) -> None:
    """Apply schema migrations."""
    _create_version_table(conn)
    current_version = _get_schema_version(conn)
    
    if current_version < 1:
        _migrate_to_v1(conn)
        _set_schema_version(conn, 1)
    if current_version < 2:
        _migrate_to_v2(conn)
        _set_schema_version(conn, 2)


def _create_version_table(conn: sqlite3.Connection) -> None:
    """Create schema version table if it doesn't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        )
    """)
    conn.commit()


def _get_schema_version(conn: sqlite3.Connection) -> int:
    """Get current schema version."""
    cursor = conn.execute("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
    row = cursor.fetchone()
    return row[0] if row else 0


def _set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    """Set schema version."""
    conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", (version,))
    conn.commit()


def _migrate_to_v1(conn: sqlite3.Connection) -> None:
    """Create initial schema (v1)."""
    # Workflows table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS workflows (
            workflow_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            state TEXT NOT NULL,
            current_published_version_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    
    # Workflow versions table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS workflow_versions (
            version_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            version_number TEXT NOT NULL,
            state TEXT NOT NULL,
            dsl_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            published_at TEXT,
            FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id)
        )
    """)
    
    # Workflow views table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS workflow_views (
            version_id TEXT PRIMARY KEY,
            view_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (version_id) REFERENCES workflow_versions(version_id)
        )
    """)
    
    # Runs table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            version_id TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            trigger_meta_json TEXT,
            run_input_json TEXT,
            status TEXT NOT NULL,
            failure_code TEXT,
            failure_message TEXT,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            middleware_workflow_id TEXT,
            FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id),
            FOREIGN KEY (version_id) REFERENCES workflow_versions(version_id)
        )
    """)
    
    # Node runs table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS node_runs (
            node_run_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            state_name TEXT NOT NULL,
            node_type TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            duration_ms INTEGER,
            input_json TEXT,
            output_json TEXT,
            state_snapshot_json TEXT,
            feedback_json TEXT,
            decision_json TEXT,
            FOREIGN KEY (run_id) REFERENCES runs(run_id)
        )
    """)
    
    # Run events table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS run_events (
            event_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            event_type TEXT NOT NULL,
            state_name TEXT,
            payload_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (run_id) REFERENCES runs(run_id)
        )
    """)
    
    # Create indexes
    conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_status_started ON runs(status, started_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_workflow_started ON runs(workflow_id, started_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_node_runs_run_state ON node_runs(run_id, state_name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_run_events_run_seq ON run_events(run_id, seq)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow ON workflow_versions(workflow_id, version_number)")
    
    conn.commit()


def _migrate_to_v2(conn: sqlite3.Connection) -> None:
    """Add middleware_workflow_id to runs (for existing v1 DBs)."""
    try:
        conn.execute("ALTER TABLE runs ADD COLUMN middleware_workflow_id TEXT")
    except sqlite3.OperationalError:
        pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_middleware_workflow ON runs(middleware_workflow_id)")
    conn.commit()
