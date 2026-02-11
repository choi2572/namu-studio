#!/bin/sh
# Entrypoint: run main UI backend or mock middleware via gunicorn.
# Set RUN_MOCK_MIDDLEWARE=1 (or true/yes) to run mock middleware instead.

GUNICORN_BIND="${GUNICORN_BIND:-0.0.0.0:8000}"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-2}"
_run_mock() {
    case "$(echo "${RUN_MOCK_MIDDLEWARE:-0}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

if _run_mock; then
    exec gunicorn --bind "$GUNICORN_BIND" --workers "$GUNICORN_WORKERS" \
        "mock_middleware.app:app"
else
    exec gunicorn --bind "$GUNICORN_BIND" --workers "$GUNICORN_WORKERS" \
        "run:app"
fi
