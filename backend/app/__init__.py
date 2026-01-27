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
        seed_data(
            workflow_repo=workflows._workflow_repo,
            version_repo=workflows._version_repo,
            view_repo=workflows._view_repo,
            reset=False,
        )
        seed_data(
            workflow_repo=runs._workflow_repo,
            version_repo=runs._workflow_version_repo,
            run_repo=runs._run_repo,
            node_run_repo=runs._node_run_repo,
            run_event_repo=runs._run_event_repo,
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
