# Middleware 연동 계약 (현재 코드 기준)

기준 코드:
- middleware client/WS 반영: `backend/app/adapters/middleware_client.py`
- middleware 실행 어댑터: `backend/app/adapters/middleware_engine.py`
- 백엔드 프록시 API: `backend/app/api/middleware_proxy.py`

## 1. 경계 정의

- **Backend**
  - Run/Node/Event 영속화의 최종 책임
  - 미들웨어 호출(REST/WS) 주체
- **Middleware**
  - 실제 Workflow 실행 엔진
  - 실행 상태/이벤트 제공

### 네이밍 규칙
- Studio API/프론트 모델: `camelCase`
- 미들웨어 원본 payload: `snake_case`
- 문서 예시에서 두 표기가 섞일 때는 원본 payload 스키마를 우선

## 2. Control Plane (REST)

백엔드가 미들웨어에 호출하는 주요 API:
- `GET /api/v1/runner/status`
- `POST /api/v1/workflows/run` (`request_type=start|cancel`)
- `GET /api/v1/workflows/{workflow_id}`
- `GET /api/v1/workflows/{workflow_id}/json`
- `GET /api/v1/skill-set`
- `POST /api/v1/workflows/action-status`

백엔드 외부 노출 프록시:
- `GET /api/v1/runner/status`
- `POST /api/v1/workflows/run`
- `GET /api/v1/workflows/{workflowId}/json`
- `POST /api/v1/workflows/action-status`

## 3. Data Plane (WebSocket)

- 백엔드(middleware 어댑터)는 `WS /api/v1/workflows/monitor`에 연결
- 수신 메시지를 DB(`runs`, `node_runs`, `run_events`)에 반영
- 주요 메시지 타입:
  - `initial`
  - `node_status_change`
  - `workflow_completed`
  - `workflow_cancelled`
  - `error`
  - `feedback`
  - `graph_patch`
  - `pong`

## 4. 이벤트 매핑 규칙 (현재 구현)

- `initial`:
  - Run 시작 정보/노드 이력(`node_history`) 반영
  - 필요 시 `RUN_CREATED`, `RUN_STARTED` 보정 이벤트 생성
- `node_status_change`:
  - Node 상태 업데이트 + `NODE_STARTED|NODE_SUCCEEDED|NODE_FAILED` 생성
- `workflow_completed|workflow_cancelled`:
  - Run 터미널 상태 반영 + `RUN_SUCCEEDED|RUN_FAILED|RUN_CANCELED` 생성
- `error`:
  - Run `FAILED` 반영 + `RUN_FAILED` 생성
- `feedback`:
  - Node의 `feedback_json` 갱신
- `graph_patch`:
  - `GRAPH_PATCH` 이벤트로 저장(리플레이/동적 DAG 패치용)

## 5. 장애/종료 보정

- WS 종료 시 Run이 아직 active면 `GET /api/v1/workflows/{workflow_id}`로 fallback 동기화 시도
- Middleware가 idle인데 DB Run이 active면 reconcile 로직으로 `CANCELED` 처리 가능

## 6. 프론트엔드 사용 관점

- 라이브 모니터 페이지는
  - REST 폴링(`runner/status`)
  - WS(`workflows/monitor`)
  를 함께 사용
- 리플레이 모드는 백엔드 저장 이벤트(`run_events`) 기반이며 미들웨어에 실행 요청하지 않음

## 7. 현재 미구현/주의

- Middleware 실행 어댑터의 `resume_wait`는 미구현
- WS 메시지 스키마는 사실상 계약이므로 미들웨어 변경 시 프론트+백엔드 동시 수정 필요
- 이벤트는 `seq` 증가를 전제로 처리되며 역순/중복 입력은 저장 계층에서 주의 필요
