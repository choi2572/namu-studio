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

## Docker (Compose + nginx)

Backend and frontend each have a **Dockerfile** (same base image: `nvcr.io/nvidia/l4t-base:r36.2.0`). You build the images separately; then **docker compose** runs them behind an **nginx** reverse proxy.

1. **Build images**

   ```bash
   docker build -t namu-backend backend/
   docker build -t namu-frontend frontend/
   ```

2. **Start stack**

   ```bash
   docker compose up -d
   ```

3. **Access**

   - App: **http://localhost** (nginx → frontend:3000)
   - API: **http://localhost/api/** (nginx → backend:8000)

To run the **mock middleware** instead of the main backend in the same backend image:

```bash
docker compose run -e RUN_MOCK_MIDDLEWARE=1 backend
# or in docker-compose.yml set backend.environment.RUN_MOCK_MIDDLEWARE=1
```

- [backend/README.md](backend/README.md) — Backend Docker (gunicorn, `RUN_MOCK_MIDDLEWARE`)
- [frontend/README.md](frontend/README.md) — Frontend Docker
- `nginx/default.conf` — nginx reverse proxy config

## Documentation

| Document | Description |
|----------|-------------|
| [docs/00-system-rules.md](docs/00-system-rules.md) | System rules and constraints |
| [docs/10-backend-api.md](docs/10-backend-api.md) | Backend API responsibilities |
| [docs/20-data-model.md](docs/20-data-model.md) | Data model |
| [docs/30-middleware-contract.md](docs/30-middleware-contract.md) | Middleware contract |
| [docs/40-ui-notes.md](docs/40-ui-notes.md) | UI guidelines |

## Development status

- **Done:** Frontend/backend separation, Flask API, in-memory & SQLite repos, workflow CRUD, draft/publish/validate, run execution (dummy + middleware adapter), event pagination, single active run constraint, seed data, mock middleware.
- **Frontend:** Can use mock API (no backend) or real HTTP API via env.
- **Backend:** Real API; optional connection to mock or real middleware via `EXECUTION_ENGINE` and `MIDDLEWARE_BASE_URL`.

## Next steps

1. Point frontend at backend via `NEXT_PUBLIC_USE_MOCK_API=false` and `NEXT_PUBLIC_API_BASE_URL`.
2. Use mock middleware for Run → Monitor → Replay testing.
3. Connect to real middleware when available.
