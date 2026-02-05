# Mock Middleware (테스트용)

실제 미들웨어 없이 **Run → 실시간 모니터링 → Replay** 흐름을 확인하기 위한 mock 서버입니다.

## API (docs/middleware_api_spec.md 준수)

- **POST** `/api/v1/workflows/run` — `request_type: "start"` | `"cancel"`, `workflow_json` (DSL)
- **GET** `/api/v1/runner/status` — runner_status (idle | running), workflow 진행 정보
- **GET** `/api/v1/workflows/{workflow_id}` — workflow information (node_history, progress 등)
- **WS** `/api/v1/workflows/monitor` — 연결 시 initial 전송 후, 노드 진행 시 `node_status_change`, 완료 시 `workflow_completed` 전송 (2초 간격 시뮬레이션)

## 실행 방법

```bash
# backend 디렉터리에서
cd backend
pip install -r requirements.txt
python -m mock_middleware
# → http://localhost:8000 에서 대기
```

## 테스트 시나리오 (Run → 모니터 → Replay)

1. **Mock 미들웨어 실행** (터미널 1)
   ```bash
   cd backend && python -m mock_middleware
   ```

2. **백엔드 실행** (터미널 2) — 미들웨어 모드 + 시드 데이터
   ```bash
   cd backend
   set EXECUTION_ENGINE=middleware
   set MIDDLEWARE_BASE_URL=http://localhost:8000
   set SEED_DATA=true
   set REPO_BACKEND=sqlite
   python run.py
   ```
   (Linux/macOS: `export EXECUTION_ENGINE=middleware` 등)

3. **프론트엔드 실행** (터미널 3)
   ```bash
   cd frontend && npm run dev
   ```

4. **브라우저에서**
   - 워크플로 목록에서 **"Seeded Condition + Parallel Workflow"** 선택 (스킬 3개 + Condition + Parallel 포함).
   - **Run** 실행 후 **Monitor**로 이동 → 실시간으로 노드가 2초 간격으로 진행되는 것을 확인.
   - Run이 끝난 뒤 **Replay** 또는 History에서 해당 Run 선택 후 재생/확인.

이 워크플로는 시드에 포함되어 있으며, Condition(CheckCondition) → Parallel(두 브랜치: Pick/Place) → JoinNode(Process) 순서로 실행됩니다.
