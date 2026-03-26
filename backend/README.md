# Backend

Flask backend API for namu-studio: workflows, runs, capabilities, and optional middleware proxy.

## Prerequisites

- Python 3.x
- pip

## Install

```bash
cd backend
pip install -r requirements.txt
```

## Run

```bash
cd backend
python run.py
```

Server runs at **http://localhost:5000** (host `0.0.0.0`, port 5000, debug on).

Alternative:

```bash
export FLASK_APP=app
flask run
```

Or:

```bash
python -m app
```

## Repository backend

| Backend | Env | Description |
|---------|-----|-------------|
| **In-memory** (default) | `REPO_BACKEND=inmemory` or unset | Data in memory; lost on restart. Good for dev/tests. |
| **SQLite** | `REPO_BACKEND=sqlite` | Persistent DB file. Optional: `DB_PATH=./data/app.db` (default: `./data/app.db`). |

Seed data is loaded automatically in development (when `DEBUG` or `ENV=development`), or when `SEED_DATA=true`.

## Execution engine

| Engine | Env | Description |
|--------|-----|-------------|
| **Dummy** (default) | `EXECUTION_ENGINE=dummy` or unset | Simulated execution; no external service. |
| **Middleware** | `EXECUTION_ENGINE=middleware` | Calls real or mock middleware. Set `MIDDLEWARE_BASE_URL` (e.g. `http://localhost:8000` for mock). |

Example with mock middleware:

```bash
set EXECUTION_ENGINE=middleware
set MIDDLEWARE_BASE_URL=http://localhost:8000
set SEED_DATA=true
set REPO_BACKEND=sqlite
python run.py
```

(Linux/macOS: use `export` instead of `set`.)

## Docker (gunicorn)

The UI backend can run in a container with **gunicorn** (no ASGI). Base image: `nvcr.io/nvidia/l4t-base:r36.2.0` (L4T / robot onboard).

Build and run:

```bash
cd backend
docker build -t namu-backend .
docker run -p 8000:8000 namu-backend
```

- **Bind:** `0.0.0.0:8000` (override with `GUNICORN_BIND`)
- **Workers:** 2 (override with `GUNICORN_WORKERS`, e.g. `1` for low-resource)
- **Healthcheck:** `GET /api/capabilities/health` (interval 30s)

### Run mock middleware in the same image

Set `RUN_MOCK_MIDDLEWARE=1` (or `true`/`yes`) to start the mock middleware server instead of the main backend:

```bash
docker run -p 8000:8000 -e RUN_MOCK_MIDDLEWARE=1 namu-backend
```

The same healthcheck path is used for both modes.

## Project structure

```
backend/
  app/
    __init__.py       # Flask app factory
    config.py         # Configuration
    errors.py         # Problem+JSON error handlers
    api/              # Blueprints
      workflows.py    # Workflow CRUD, draft, validate, publish
      runs.py         # Run start, cancel, snapshot, events, resume
      capabilities.py # Skills, skill-set, health
      middleware_proxy.py  # Proxy to middleware (/api/v1/...)
    domain/           # Domain models
    services/         # Workflow and run services
    repos/            # In-memory and SQLite repositories
    db/               # SQLite connection and schema
    adapters/         # Execution (dummy, middleware)
  tests/
  requirements.txt
  run.py
  mock_middleware/    # Mock middleware server (see mock_middleware/README.md)
```

## API specification

All backend APIs use the `/api` prefix. Errors use **Problem+JSON** (RFC 7807).

### Workflows — `/api/workflows`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workflows` | List workflows (id, name, state, latestVersion, latestRun). |
| `POST` | `/api/workflows` | Create workflow. Body: `name`, optional `description`. |
| `GET` | `/api/workflows/<workflow_id>` | Get workflow metadata. |
| `PATCH` | `/api/workflows/<workflow_id>` | Update name/description only. |
| `DELETE` | `/api/workflows/<workflow_id>` | Delete workflow and related data. |
| `GET` | `/api/workflows/<workflow_id>/draft` | Get draft (DSL + view). |
| `PUT` | `/api/workflows/<workflow_id>/draft` | Save draft. Body: `dsl_json`, `view_json`. |
| `POST` | `/api/workflows/<workflow_id>/validate` | Validate draft; returns list of errors. |
| `POST` | `/api/workflows/<workflow_id>/publish` | Publish validated draft. Workflow must be validated; only one active run per workflow. |

### Runs — `/api/runs`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/runs` | List runs. Query: `status`, `workflowId`, `timeRange`. |
| `POST` | `/api/runs` | Start run. Body: `workflowId` (required), optional `runInput`. Workflow must be published. |
| `GET` | `/api/runs/<run_id>` | Get run summary. |
| `POST` | `/api/runs/<run_id>/cancel` | Cancel run. |
| `GET` | `/api/runs/<run_id>/snapshot` | Run snapshot for monitoring (metadata, nodes, timing). |
| `GET` | `/api/runs/<run_id>/nodes/<state_name>/debug` | Node debug bundle (input, output, feedback, decision). |
| `GET` | `/api/runs/<run_id>/events` | Run events. Query: `afterSeq` for pagination. |
| `POST` | `/api/runs/<run_id>/resume` | Resume waiting node. Body: `stateName`, optional `payload`. |

### Capabilities — `/api/capabilities`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/capabilities/skills` | List skills (dummy list; name, version, parameterSchema). |
| `GET` | `/api/capabilities/skill-set` | Skill set from middleware (when middleware is used). |
| `GET` | `/api/capabilities/health` | Runtime health (status, runtime info). |

### Middleware proxy — `/api/v1`

When using middleware, the backend can proxy requests to the middleware under `/api/v1` (e.g. workflow run, runner status, monitor WebSocket). See `docs/middleware-api-spec.md` for the middleware API.

### Error response (Problem+JSON)

```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "Bad Request",
  "status": 400,
  "detail": "Error message"
}
```

## Tests

```bash
cd backend
pytest
```

With coverage:

```bash
pytest --cov=app --cov-report=html
```

Tests are parameterized for both `inmemory` and `sqlite` backends where relevant.

## CORS

CORS is enabled for development (e.g. frontend at `http://localhost:3000`).

## Documentation

- [docs/10-backend-api.md](../docs/10-backend-api.md) — API responsibilities and design.
- [docs/middleware-api-spec.md](../docs/middleware-api-spec.md) — Middleware API used by the backend when `EXECUTION_ENGINE=middleware`.
