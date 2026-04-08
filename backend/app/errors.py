"""Error handlers following Problem+JSON style."""

from flask import jsonify
from werkzeug.exceptions import HTTPException


def register_error_handlers(app):
    """Register error handlers for the application."""

    @app.errorhandler(400)
    def bad_request(error):
        """Handle 400 Bad Request."""
        return jsonify(
            {
                "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
                "title": "Bad Request",
                "status": 400,
                "detail": str(error.description) if hasattr(error, "description") else "Bad request",
            }
        ), 400

    @app.errorhandler(404)
    def not_found(error):
        """Handle 404 Not Found."""
        return jsonify(
            {
                "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
                "title": "Not Found",
                "status": 404,
                "detail": str(error.description) if hasattr(error, "description") else "Resource not found",
            }
        ), 404

    @app.errorhandler(409)
    def conflict(error):
        """Handle 409 Conflict."""
        return jsonify(
            {
                "type": "https://tools.ietf.org/html/rfc7231#section-6.5.8",
                "title": "Conflict",
                "status": 409,
                "detail": str(error.description) if hasattr(error, "description") else "Conflict",
            }
        ), 409

    @app.errorhandler(422)
    def unprocessable_entity(error):
        """Handle 422 Unprocessable Entity."""
        return jsonify(
            {
                "type": "https://tools.ietf.org/html/rfc4918#section-11.2",
                "title": "Unprocessable Entity",
                "status": 422,
                "detail": str(error.description) if hasattr(error, "description") else "Validation error",
            }
        ), 422

    @app.errorhandler(500)
    def internal_error(error):
        """Handle 500 Internal Server Error."""
        return jsonify(
            {
                "type": "https://tools.ietf.org/html/rfc7231#section-6.6.1",
                "title": "Internal Server Error",
                "status": 500,
                "detail": "An internal server error occurred",
            }
        ), 500

    @app.errorhandler(HTTPException)
    def handle_http_exception(error):
        """Handle HTTP exceptions."""
        return jsonify(
            {
                "type": f"https://tools.ietf.org/html/rfc7231#section-6.5.{error.code // 100}",
                "title": error.name,
                "status": error.code,
                "detail": error.description,
            }
        ), error.code

    @app.errorhandler(Exception)
    def handle_exception(error):
        """Handle unhandled exceptions."""
        app.logger.error(f"Unhandled exception: {error}", exc_info=True)
        return jsonify(
            {
                "type": "https://tools.ietf.org/html/rfc7231#section-6.6.1",
                "title": "Internal Server Error",
                "status": 500,
                "detail": "An unexpected error occurred",
            }
        ), 500
