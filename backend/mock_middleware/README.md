# Mock Middleware

A mock middleware server for testing the **Run → Monitor → Replay** flow without a real robot or middleware. It implements the API described in `docs/middleware_api_spec.md`.

## Run

From the **backend** directory:

```bash
cd backend
pip install -r requirements.txt
python -m mock_middleware
```

The server listens at **http://localhost:8000**.

## API (aligned with docs/middleware_api_spec.md)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/workflows/run` | Start or cancel workflow. Body: `request_type` (`"start"` \| `"cancel"`), `workflow_json` (DSL) for start. |
| `GET` | `/api/v1/runner/status` | Runner status: `idle` \| `running` \| `error`, plus workflow progress when running. |
| `GET` | `/api/v1/workflows/<workflow_id>` | Workflow info: `node_history`, `progress`, etc. |
| `WS` | `/api/v1/workflows/monitor` | WebSocket: initial state, then `node_status_change`, `workflow_completed` (simulated at ~2s intervals). Client `ping` → server `pong`. |

## Full test scenario (Run → Monitor → Replay)

1. **Start mock middleware** (terminal 1):

   ```bash
   cd backend
   python -m mock_middleware
   ```
   → http://localhost:8000

2. **Start backend** with middleware mode and seed data (terminal 2):

   ```bash
   cd backend
   set EXECUTION_ENGINE=middleware
   set MIDDLEWARE_BASE_URL=http://localhost:8000
   set SEED_DATA=true
   set REPO_BACKEND=sqlite
   python run.py
   ```
   (Linux/macOS: `export EXECUTION_ENGINE=middleware` etc.)

3. **Start frontend** (terminal 3):

   ```bash
   cd frontend
   npm run dev
   ```

4. **In the browser**

   - Open the app (e.g. http://localhost:3000).
   - Pick the seeded workflow **"Seeded Condition + Parallel Workflow"** (skills, Condition, Parallel).
   - Start a **Run**, then open **Monitor** — nodes advance every ~2 seconds.
   - When the run finishes, use **Replay** or **History** to review.

The seeded workflow runs: Condition (CheckCondition) → Parallel (Pick/Place branches) → JoinNode (Process).
