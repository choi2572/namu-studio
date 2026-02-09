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
    CORS(app)
    
    # Register error handlers
    register_error_handlers(app)
    
    # Register blueprints
    from app.api import workflows, runs, capabilities, middleware_proxy
    app.register_blueprint(workflows.bp, url_prefix="/api/workflows")
    app.register_blueprint(runs.bp, url_prefix="/api/runs")
    app.register_blueprint(capabilities.bp, url_prefix="/api/capabilities")
    app.register_blueprint(middleware_proxy.bp, url_prefix="/api/v1")

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
    """Seed when SEED_DATA is true, or in development when DEBUG is true (default on)."""
    if app.config.get("SEED_DATA"):
        return True
    # Development default: seed so sample workflows appear without setting env
    if app.config.get("DEBUG") or app.config.get("ENV") == "development":
        return True
    return False
