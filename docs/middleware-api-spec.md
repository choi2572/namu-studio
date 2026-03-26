# Middleware API 스펙 (현재 사용 기준)

이 문서는 프론트/백엔드가 실제로 호출하는 미들웨어 API 형태를 정리한다.  
정확한 구현은 미들웨어 서버가 최종 기준이지만, 본 저장소에서 기대하는 형태는 아래와 같다.

## 표기 규칙

- 이 문서는 미들웨어 원본 계약 문서이므로 예시는 `snake_case`를 유지한다.
- Studio 내부 모델(`workflowId`, `runId`)과 다를 수 있으며, 변환은 백엔드/프론트 어댑터에서 처리한다.

## 1. 실행 제어

### `POST /api/v1/workflows/run`

#### start 요청
```json
{
  "request_type": "start",
  "workflow_json": {
    "StartAt": "NodeA",
    "States": {}
  }
}
```

#### cancel 요청
```json
{
  "request_type": "cancel"
}
```

#### 정상 응답 예시
```json
{
  "workflow_id": "wf_1753xxxxxx",
  "status": "running"
}
```

오류 시 `error`, `message`, `details` 필드를 포함할 수 있다.

## 2. 러너 상태 조회

### `GET /api/v1/runner/status`

#### running 예시
```json
{
  "runner_status": "running",
  "workflow": {
    "workflow_id": "wf_xxxxx",
    "current_node": "Pick",
    "progress": {
      "completed_states": ["A"],
      "current_state": "B",
      "pending_states": ["C"]
    },
    "started_at": "2026-01-23T12:34:56Z",
    "updated_at": "2026-01-23T12:35:06Z"
  }
}
```

#### idle 예시
```json
{
  "runner_status": "idle"
}
```

#### error 예시
```json
{
  "runner_status": "error",
  "error": "runner failed",
  "details": {
    "error_code": "RUNNER_ERROR",
    "error_message": "..."
  }
}
```

## 3. 워크플로우 정보/정의 조회

### `GET /api/v1/workflows/{workflow_id}`
- 실행 중 workflow 상태/히스토리 조회(백엔드 fallback 동기화에 사용)

### `GET /api/v1/workflows/{workflow_id}/json`
- workflow DSL JSON 반환
- 프론트 라이브 모니터가 DAG 렌더링에 사용

## 4. 스킬셋 조회

### `GET /api/v1/skill-set`
- 스킬셋 목록 반환
- 프론트 `skillsetsApi`가 사용

## 5. 외부 액션 상태 업데이트

### `POST /api/v1/workflows/action-status`

요청 예시:
```json
{
  "statuses": [
    {
      "action_id": "NodeA",
      "status": "success",
      "reason": ""
    }
  ]
}
```

응답 예시:
```json
{
  "results": [
    {
      "action_id": "NodeA",
      "result": "accepted"
    }
  ]
}
```

## 6. 모니터 WebSocket

### `WS /api/v1/workflows/monitor`

백엔드/프론트가 수신하는 주요 메시지 타입:
- `initial`
- `node_status_change`
- `feedback`
- `workflow_completed`
- `workflow_cancelled`
- `error`
- `graph_patch` (VLM 동적 그래프)
- `pong`

### `initial` 예시
```json
{
  "type": "initial",
  "runner_status": "running",
  "workflow": {
    "workflow_id": "wf_xxxxx",
    "started_at": "2026-01-23T12:34:56Z"
  },
  "node_history": []
}
```

### `node_status_change` 예시
```json
{
  "type": "node_status_change",
  "workflow_id": "wf_xxxxx",
  "timestamp": 1700000000,
  "node_name": "Pick",
  "prev_status": "IDLE",
  "status": "RUNNING",
  "input": {}
}
```

### `workflow_completed` 예시
```json
{
  "type": "workflow_completed",
  "workflow_id": "wf_xxxxx",
  "timestamp": 1700000200,
  "status": "succeeded",
  "final_stats": {
    "total_duration_ms": 12345
  }
}
```

## 7. ping/pong

- 클라이언트는 주기적으로 ping을 보낼 수 있다
- 서버는 pong으로 응답한다

```json
{ "type": "ping" }
```

```json
{ "type": "pong" }
```
