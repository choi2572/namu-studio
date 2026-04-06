"""Run Flask application."""
import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    # Playwright 등 자동화에서 리로더 자식 프로세스가 남지 않도록 끌 수 있음
    use_reloader = os.environ.get("FLASK_USE_RELOADER", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=use_reloader)
