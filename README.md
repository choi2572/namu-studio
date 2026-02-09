# namu-studio

Robot Workflow Authoring & Monitoring Tool. Create, edit, validate, and publish workflows; start runs; and monitor execution in real time or replay from history.

## Project structure

```
namu-studio/
  frontend/           # Next.js frontend (Dashboard, Editor, Monitor, History)
  backend/            # Flask backend API server
  backend/mock_middleware/  # Mock middleware for testing Run → Monitor → Replay
  docs/               # System documentation
```

## Quick start

### Prerequisites

- **Node.js** (for frontend)
- **Python 3.x** (for backend)
- **pip** (Python package manager)

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
python run.py
```

Backend runs at **http://localhost:5000**.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at **http://localhost:3000**.

### 3. (Optional) Mock middleware

To test Run → Monitor → Replay without a real robot/middleware:

```bash
cd backend
pip install -r requirements.txt
python -m mock_middleware
```

Mock middleware runs at **http://localhost:8000**. See [backend/mock_middleware/README.md](backend/mock_middleware/README.md) for full setup (backend + frontend with middleware mode).

## Documentation

| Document | Description |
|----------|-------------|
| [docs/00-system_rules.md](docs/00-system_rules.md) | System rules and constraints |
| [docs/10-backend_api.md](docs/10-backend_api.md) | Backend API responsibilities |
| [docs/20-data_model.md](docs/20-data_model.md) | Data model |
| [docs/30-middleware_contract.md](docs/30-middleware_contract.md) | Middleware contract |
| [docs/40-ui_notes.md](docs/40-ui_notes.md) | UI guidelines |

## Development status

- **Done:** Frontend/backend separation, Flask API, in-memory & SQLite repos, workflow CRUD, draft/publish/validate, run execution (dummy + middleware adapter), event pagination, single active run constraint, seed data, mock middleware.
- **Frontend:** Can use mock API (no backend) or real HTTP API via env.
- **Backend:** Real API; optional connection to mock or real middleware via `EXECUTION_ENGINE` and `MIDDLEWARE_BASE_URL`.

## Next steps

1. Point frontend at backend via `NEXT_PUBLIC_USE_MOCK_API=false` and `NEXT_PUBLIC_API_BASE_URL`.
2. Use mock middleware for Run → Monitor → Replay testing.
3. Connect to real middleware when available.
