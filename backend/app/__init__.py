"""Flask application factory."""
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
    
    return app
