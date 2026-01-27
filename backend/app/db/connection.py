"""SQLite connection management."""
import sqlite3
import threading
import os
from pathlib import Path
from typing import Optional

# Thread-local storage for connections
_local = threading.local()


def get_db_path() -> str:
    """Get database file path from environment or default."""
    db_path = os.environ.get("DB_PATH", "./data/app.db")
    # Ensure directory exists
    db_dir = Path(db_path).parent
    db_dir.mkdir(parents=True, exist_ok=True)
    return db_path


def get_db() -> sqlite3.Connection:
    """Get thread-local database connection."""
    if not hasattr(_local, "connection") or _local.connection is None:
        db_path = get_db_path()
        _local.connection = sqlite3.connect(
            db_path,
            check_same_thread=False,
            timeout=10.0
        )
        _local.connection.row_factory = sqlite3.Row
        _apply_pragmas(_local.connection)
    return _local.connection


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    """Apply recommended SQLite PRAGMAs."""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.commit()


def init_db() -> None:
    """Initialize database connection and apply schema."""
    conn = get_db()
    migrate_schema(conn)
    conn.close()
    # Clear thread-local connection after init
    if hasattr(_local, "connection"):
        _local.connection = None


def close_db() -> None:
    """Close thread-local database connection."""
    if hasattr(_local, "connection") and _local.connection is not None:
        _local.connection.close()
        _local.connection = None
