# 백엔드 API 명세 (현재 코드 기준)

기준 코드:
- Flask app factory: `backend/app/__init__.py`
- Workflows API: `backend/app/api/workflows.py`
- Runs API: `backend/app/api/runs.py`
- Capabilities API: `backend/app/api/capabilities.py`
- Middleware proxy API: `backend/app/api/middleware_proxy.py`

## 1. 공통

- 기본 prefix: `/api`
- 응답 포맷: JSON
- 에러 포맷: Problem+JSON (공통 에러 핸들러)
- CORS: 개발 환경 기준 활성화

### 네이밍 규칙
- Studio API 응답/요청은 `camelCase` 기준 (`workflowId`, `runId`, `stateName`)
- 백엔드 내부/DB 필드는 `snake_case` 기준 (`workflow_id`, `run_id`)
- 미들웨어 원본 계약 필드는 미들웨어 스키마를 유지 (`workflow_id`, `runner_status`)

## 2. Workflows API (`/api/workflows`)

### `GET /api/workflows`
- 모든 Workflow 목록 반환
- 각 항목 포함:
  - `workflowId`, `name`, `state`
  - `latestVersion`(있으면)
  - `latestRun`(있으면)

### `POST /api/workflows`
- Workflow 생성
- body: `{ name?, description? }`
- 응답: 생성된 workflow 메타

### `GET /api/workflows/{workflowId}`
- 단일 Workflow 메타 조회

### `PATCH /api/workflows/{workflowId}`
- Workflow 메타(name/description) 수정

### `GET /api/workflows/{workflowId}/draft`
- Draft가 있으면 Draft 반환
- Draft가 없고 published가 있으면 published 버전 fallback 반환

### `PUT /api/workflows/{workflowId}/draft`
- Draft 저장
- body: `{ dsl_json, view_json }`

### `POST /api/workflows/{workflowId}/validate`
- Draft(또는 fallback published) DSL 검증
- 응답: validation error 배열

### `POST /api/workflows/{workflowId}/publish`
- Draft publish 수행
- 검증 실패 시 `400`

### `DELETE /api/workflows/{workflowId}`
- Workflow + 연관 Runs/NodeRuns/RunEvents/Versions/Views 삭제

## 3. Runs API (`/api/runs`)

### `GET /api/runs`
- Run 목록 조회
- query:
  - `status`
  - `workflowId`
  - `timeRange` (현재 백엔드 실질 필터 미적용)

### `POST /api/runs`
- Run 시작
- body: `{ workflowId, runInput? }`
- 단일 활성 run 제약 위반 시 `409`

### `GET /api/runs/{runId}`
- Run 요약 조회

### `POST /api/runs/{runId}/cancel`
- Run 취소 요청

### `GET /api/runs/{runId}/snapshot`
- 모니터용 snapshot 조회
- 포함:
  - `run` 요약
  - `workflowName`
  - `nodeStates[]`

### `GET /api/runs/{runId}/nodes/{stateName}/debug`
- node debug bundle 조회
- node 데이터 없으면 빈 번들 형태 반환

### `GET /api/runs/{runId}/events?afterSeq={n}`
- Run Timeline 이벤트 조회
- `afterSeq` 이후 이벤트만 반환 가능

### `POST /api/runs/{runId}/resume`
- waiting Node 재개 요청
- body: `{ stateName, payload? }`
- 참고: middleware 실행 엔진에서는 실제 resume 구현 미완성

## 4. Capabilities API (`/api/capabilities`)

### `GET /api/capabilities/skill-set`
- middleware `GET /api/v1/skill-sets` 프록시 결과 반환

### `GET /api/capabilities/skills`
- 더미 skill 목록 반환 (현재 하드코딩)

### `GET /api/capabilities/health`
- 런타임 상태 응답(더미)

## 5. Middleware Proxy API (`/api/v1`)

### `GET /api/v1/runner/status`
- middleware runner 상태 프록시

### `POST /api/v1/workflows/run`
- middleware start/cancel 요청 프록시

### `GET /api/v1/workflows/{workflowId}/json`
- middleware workflow DSL JSON 조회 프록시

### `POST /api/v1/workflows/action-status`
- middleware action status 업데이트 프록시

## 6. 실행 엔진 관련 보조 규칙

- `EXECUTION_ENGINE=dummy|middleware` 환경변수로 실행 엔진 선택
- `middleware` 모드:
  - run 시작 시 middleware REST 호출
  - 이후 WS monitor 이벤트를 DB에 적재
  - WS 종료 후 필요시 REST fallback 동기화
