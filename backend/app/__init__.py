"""Flask application factory."""
import os

from flask import Flask
from flask_cors import CORS

from app.config import Config
from app.errors import register_error_handlers


def create_app(config_class=Config):
    """Create and configure Flask application."""
    app = Flask(__name__)
    app.config.from_object(config_class)
    
    # Initialize database if using SQLite
    repo_backend = app.config.get("REPO_BACKEND", "inmemory")
    if repo_backend == "sqlite":
        from app.db import init_db
        init_db()
    
    # Enable CORS for frontend dev
    CORS(app, origins=["http://localhost:3000"])
    
    # Register error handlers
    register_error_handlers(app)
    
    # Register blueprints
    from app.api import workflows, runs, capabilities
    app.register_blueprint(workflows.bp, url_prefix="/api/workflows")
    app.register_blueprint(runs.bp, url_prefix="/api/runs")
    app.register_blueprint(capabilities.bp, url_prefix="/api/capabilities")

    if _should_seed(app):
        from app.seed import seed_data
        from app.repos import registry
        seed_data(
            workflow_repo=registry.workflow_repo,
            version_repo=registry.version_repo,
            view_repo=registry.view_repo,
            run_repo=registry.run_repo,
            node_run_repo=registry.node_run_repo,
            run_event_repo=registry.run_event_repo,
            reset=False,
        )
    
    return app


def _should_seed(app: Flask) -> bool:
    if not app.config.get("SEED_DATA"):
        return False
    env = app.config.get("ENV")
    if env == "development" or app.config.get("DEBUG"):
        return True
    return os.environ.get("FLASK_ENV") == "development" or os.environ.get("FLASK_DEBUG") == "1"
