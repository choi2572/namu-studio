"""Pytest configuration and fixtures."""
import pytest

from app import create_app
from app.repos.memory import (
    InMemoryWorkflowRepository,
    InMemoryWorkflowVersionRepository,
    InMemoryWorkflowViewRepository,
    InMemoryRunRepository,
    InMemoryNodeRunRepository,
    InMemoryRunEventRepository,
)
from app.services.workflow_service import WorkflowService
from app.services.run_service import RunService
from app.adapters.execution_engine import DummyExecutionEngineAdapter


@pytest.fixture
def app():
    """Create application for testing."""
    app = create_app()
    app.config["TESTING"] = True
    return app


@pytest.fixture
def client(app):
    """Create test client."""
    return app.test_client()


@pytest.fixture
def workflow_repo():
    """Create workflow repository."""
    return InMemoryWorkflowRepository()


@pytest.fixture
def version_repo():
    """Create version repository."""
    return InMemoryWorkflowVersionRepository()


@pytest.fixture
def view_repo():
    """Create view repository."""
    return InMemoryWorkflowViewRepository()


@pytest.fixture
def run_repo():
    """Create run repository."""
    return InMemoryRunRepository()


@pytest.fixture
def node_run_repo():
    """Create node run repository."""
    return InMemoryNodeRunRepository()


@pytest.fixture
def run_event_repo():
    """Create run event repository."""
    return InMemoryRunEventRepository()


@pytest.fixture
def workflow_service(workflow_repo, version_repo, view_repo):
    """Create workflow service."""
    return WorkflowService(workflow_repo, version_repo, view_repo)


@pytest.fixture
def execution_adapter(run_repo, node_run_repo, run_event_repo, workflow_repo, version_repo):
    """Create execution adapter."""
    return DummyExecutionEngineAdapter(
        run_repo,
        node_run_repo,
        run_event_repo,
        workflow_repo,
        version_repo
    )


@pytest.fixture
def run_service(run_repo, node_run_repo, run_event_repo, workflow_repo, version_repo, execution_adapter):
    """Create run service."""
    return RunService(
        run_repo,
        node_run_repo,
        run_event_repo,
        workflow_repo,
        version_repo,
        execution_adapter,
    )
