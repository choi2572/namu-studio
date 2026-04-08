"""Repository fixtures for parametrized tests."""

import os
from pathlib import Path

import pytest

from app.db import close_db, init_db
from app.repos.memory import (
    InMemoryNodeRunRepository,
    InMemoryRunEventRepository,
    InMemoryRunRepository,
    InMemoryWorkflowRepository,
    InMemoryWorkflowVersionRepository,
    InMemoryWorkflowViewRepository,
)
from app.repos.sqlite import (
    NodeRunRepositorySqlite,
    RunEventRepositorySqlite,
    RunRepositorySqlite,
    WorkflowRepositorySqlite,
    WorkflowVersionRepositorySqlite,
    WorkflowViewRepositorySqlite,
)


@pytest.fixture(params=["inmemory", "sqlite"])
def repo_backend(request):
    """Parametrize repository backend."""
    return request.param


@pytest.fixture(scope="function")
def db_path(repo_backend, tmp_path):
    """Create database path for SQLite tests."""
    if repo_backend == "sqlite":
        db_path = str(tmp_path / "test.db")
        os.environ["DB_PATH"] = db_path

        init_db()
        yield db_path
        close_db()
        # Clean up
        if Path(db_path).exists():
            Path(db_path).unlink()
        if "DB_PATH" in os.environ:
            del os.environ["DB_PATH"]
    else:
        yield None


@pytest.fixture
def workflow_repo(repo_backend, db_path):
    """Create workflow repository based on backend."""
    if repo_backend == "sqlite":
        return WorkflowRepositorySqlite()
    else:
        return InMemoryWorkflowRepository()


@pytest.fixture
def version_repo(repo_backend, db_path):
    """Create version repository based on backend."""
    if repo_backend == "sqlite":
        return WorkflowVersionRepositorySqlite()
    else:
        return InMemoryWorkflowVersionRepository()


@pytest.fixture
def view_repo(repo_backend, db_path):
    """Create view repository based on backend."""
    if repo_backend == "sqlite":
        return WorkflowViewRepositorySqlite()
    else:
        return InMemoryWorkflowViewRepository()


@pytest.fixture
def run_repo(repo_backend, db_path):
    """Create run repository based on backend."""
    if repo_backend == "sqlite":
        return RunRepositorySqlite()
    else:
        return InMemoryRunRepository()


@pytest.fixture
def node_run_repo(repo_backend, db_path):
    """Create node run repository based on backend."""
    if repo_backend == "sqlite":
        return NodeRunRepositorySqlite()
    else:
        return InMemoryNodeRunRepository()


@pytest.fixture
def run_event_repo(repo_backend, db_path):
    """Create run event repository based on backend."""
    if repo_backend == "sqlite":
        return RunEventRepositorySqlite()
    else:
        return InMemoryRunEventRepository()


@pytest.fixture
def repos(workflow_repo, version_repo, view_repo, run_repo, node_run_repo, run_event_repo):
    """Create all repositories as a dict."""
    return {
        "workflow_repo": workflow_repo,
        "version_repo": version_repo,
        "view_repo": view_repo,
        "run_repo": run_repo,
        "node_run_repo": node_run_repo,
        "event_repo": run_event_repo,
    }
