# Frontend

Next.js frontend for namu-studio: Dashboard, Workflow Editor, Run Monitor, and Run History.

## Prerequisites

- Node.js
- npm (or yarn/pnpm)

## Install

```bash
cd frontend
npm install
```

## Run

### Option A: With backend (recommended)

1. Start the backend (from project root):

   ```bash
   cd backend
   pip install -r requirements.txt
   python run.py
   ```

   Backend: **http://localhost:5000**

2. Start the frontend:

   ```bash
   cd frontend
   npm run dev
   ```

   App: **http://localhost:3000**

### Option B: Mock API only (no backend)

1. Set `NEXT_PUBLIC_USE_MOCK_API=true` (see [Environment variables](#environment-variables)).
2. Start the frontend:

   ```bash
   cd frontend
   npm run dev
   ```

   App: **http://localhost:3000**. Data is stored in browser local storage.

## Environment variables

Create `.env.local` in the `frontend` directory (or copy from `.env.example`):

```env
# Use mock API (true) or real HTTP API (false). Default: false
NEXT_PUBLIC_USE_MOCK_API=false

# Backend API base URL when using real API (no trailing slash)
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api
```

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_USE_MOCK_API` | `true`: mock adapter (no backend). `false` or unset: HTTP adapter (backend required). |
| `NEXT_PUBLIC_API_BASE_URL` | Base URL for backend API when not using mock. Only `NEXT_PUBLIC_*` vars are available in the browser. |

## Project structure

```
src/
  api/           # API interface and adapters
    interfaces.ts
    factory.ts   # Chooses mock vs HTTP by env
    http/        # Real HTTP client
    mock/        # Mock adapter + seed data
  app/           # Next.js app router (pages, layout)
  components/    # Reusable UI components
  domain/        # DTOs, enums, pure logic
  features/      # Dashboard, Editor, Monitor, History
  lib/           # Utilities (format, ids, helpers)
  tests/         # Unit tests (domain, mock API)
```

## API adapter behavior

- **Mock mode** (`NEXT_PUBLIC_USE_MOCK_API=true`): No backend; data in local storage. Good for UI work and prototyping.
- **HTTP mode** (`NEXT_PUBLIC_USE_MOCK_API=false`): All calls go to the backend. Use when backend is running.

Both modes share the same interface, so you can switch without changing UI code.

## Docker

Same base image as backend: `nvcr.io/nvidia/l4t-base:r36.2.0`. Build and run:

```bash
cd frontend
docker build -t namu-frontend .
docker run -p 3000:3000 namu-frontend
```

The image runs `npm run build` then `npm start` (Next.js on port 3000). For reverse-proxy setups (e.g. [docker compose](../README.md#docker-compose--nginx)), the build uses `NEXT_PUBLIC_API_BASE_URL=/api` so the browser talks to the same origin and nginx proxies `/api` to the backend.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (default port 3000) |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run test` | Run tests (Vitest) |

## Tips

- In dev, API calls are logged to the console (`[API Factory]`, `[API]`).
- Use the Network tab and console to verify backend connectivity when using HTTP mode.
