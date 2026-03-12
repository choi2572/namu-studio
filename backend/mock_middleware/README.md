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
| `WS` | `/api/v1/workflows/monitor` | WebSocket: initial state, then `node_status_change`, `workflow_completed` (simulated). Node duration: 3s when `MOCK_VLM_DYNAMIC_PATCH=true`, else 2s. Optional: `graph_patch` sequence when `MOCK_VLM_DYNAMIC_PATCH=true`. |

### VLM dynamic graph (optional, off by default)

Set `MOCK_VLM_DYNAMIC_PATCH=true` (or `1`) to enable the **VLM dynamic test scenario**:

- Node execution delay is **3 seconds** per node (so you can watch the monitor in real time).
- The run stays **"running" for 17 seconds** (even after the DSL node finishes) so you can see graph_patch updates in the monitor in real time; then `workflow_completed` is sent.
- Four `graph_patch` events are emitted on a timer from run start:
  - **5s**: add DAG `Pick1 → Place1 → Pick2 → Place2` under `root/VLMPlanner_1/generated`.
  - **8s**: append `Pick3 → Pick4` after Place2 (second pick “starting” feel).
  - **14s**: append `Place3 → Place4 → Place5` after Pick4 (after “two picks” finish).
  - **17s**: replan — remove Place4, Place5 and add `Pick5 → Pick6 → Place6` after Place3.

Use a workflow that includes a VLM node (e.g. Pass state named `VLMPlanner_1`). The backend persists each as a `GRAPH_PATCH` run event; the frontend applies patches only when `ENABLE_DYNAMIC_GRAPH_PATCH` is on (e.g. `localStorage.setItem("ENABLE_DYNAMIC_GRAPH_PATCH", "true")` and refresh). See `docs/vlm_monitoring.md`.

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
