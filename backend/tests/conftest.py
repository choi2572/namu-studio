"""Pytest configuration and fixtures."""

import pytest

from app import create_app
from app.adapters.execution_engine import DummyExecutionEngineAdapter
from app.repos import registry
from app.repos.memory import (
    InMemoryNodeRunRepository,
    InMemoryRunEventRepository,
    InMemoryRunRepository,
    InMemoryWorkflowRepository,
    InMemoryWorkflowVersionRepository,
    InMemoryWorkflowViewRepository,
)
from app.seed import SEED_IDS, seed_data
from app.services.run_service import RunService
from app.services.workflow_service import WorkflowService

# Import parametrized fixtures (only if not already defined)
# Note: conftest_repos fixtures will override the non-parametrized ones below
pytest_plugins = ["tests.conftest_repos"]


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
def workflow_service(
    workflow_repo,
    version_repo,
    view_repo,
    run_repo,
    node_run_repo,
    run_event_repo,
):
    """Create workflow service."""
    return WorkflowService(
        workflow_repo,
        version_repo,
        view_repo,
        run_repo,
        node_run_repo,
        run_event_repo,
    )


@pytest.fixture
def execution_adapter(run_repo, node_run_repo, run_event_repo, workflow_repo, version_repo):
    """Create execution adapter."""
    return DummyExecutionEngineAdapter(run_repo, node_run_repo, run_event_repo, workflow_repo, version_repo)


@pytest.fixture
def run_service(
    run_repo,
    node_run_repo,
    run_event_repo,
    workflow_repo,
    version_repo,
    execution_adapter,
):
    """Create run service."""
    return RunService(
        run_repo,
        node_run_repo,
        run_event_repo,
        workflow_repo,
        version_repo,
        execution_adapter,
    )


@pytest.fixture
def seeded_data():
    """Seed deterministic data into API repositories."""
    seed_data(
        workflow_repo=registry.workflow_repo,
        version_repo=registry.version_repo,
        view_repo=registry.view_repo,
        run_repo=registry.run_repo,
        node_run_repo=registry.node_run_repo,
        run_event_repo=registry.run_event_repo,
        reset=True,
    )
    return SEED_IDS


@pytest.fixture
def seeded_client(client, seeded_data):
    """Create test client with seeded repositories."""
    return client
