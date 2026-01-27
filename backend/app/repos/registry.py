"""Shared repository instances (in-memory or SQLite based on config)."""
import os

# Determine backend from environment
_repo_backend = os.environ.get("REPO_BACKEND", "inmemory")

if _repo_backend == "sqlite":
    from app.repos.sqlite import (
        WorkflowRepositorySqlite,
        WorkflowVersionRepositorySqlite,
        WorkflowViewRepositorySqlite,
        RunRepositorySqlite,
        NodeRunRepositorySqlite,
        RunEventRepositorySqlite,
    )
    workflow_repo = WorkflowRepositorySqlite()
    version_repo = WorkflowVersionRepositorySqlite()
    view_repo = WorkflowViewRepositorySqlite()
    run_repo = RunRepositorySqlite()
    node_run_repo = NodeRunRepositorySqlite()
    run_event_repo = RunEventRepositorySqlite()
else:
    from app.repos.memory import (
        InMemoryWorkflowRepository,
        InMemoryWorkflowVersionRepository,
        InMemoryWorkflowViewRepository,
        InMemoryRunRepository,
        InMemoryNodeRunRepository,
        InMemoryRunEventRepository,
    )
    workflow_repo = InMemoryWorkflowRepository()
    version_repo = InMemoryWorkflowVersionRepository()
    view_repo = InMemoryWorkflowViewRepository()
    run_repo = InMemoryRunRepository()
    node_run_repo = InMemoryNodeRunRepository()
    run_event_repo = InMemoryRunEventRepository()
