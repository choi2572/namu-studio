"""Shared repository instances for in-memory mode."""
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
