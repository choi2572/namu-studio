# VLM 모니터링 확장 (현재 코드 기준)

기준 코드:
- 백엔드 이벤트 저장: `backend/app/adapters/middleware_client.py`
- 모니터 그래프 패치: `frontend/src/features/monitor/monitorGraph.ts`
- run 모니터 반영: `frontend/src/features/monitor/MonitorPage.tsx`
- live runner 모니터 반영: `frontend/src/features/monitor/LiveRunnerMonitorPage.tsx`

## 1. 핵심 개념

- VLM 실행 중 동적으로 그래프가 확장될 수 있음
- 이를 `GRAPH_PATCH` 이벤트로 저장/재생
- 목적은 실행 제어가 아니라 모니터 시각화 및 replay 일관성 확보

### 네이밍 규칙
- Studio 이벤트 모델 기준 표기: `eventType`, `stateName`
- 미들웨어 원본 메시지 표기: `type`, `node_name`, `workflow_id`
- 문서 본문 용어는 `Workflow`, `Run`, `Node`로 통일

## 2. 현재 이벤트 형태

백엔드는 middleware `graph_patch` 메시지에서 아래를 추출해 `RunEvent(event_type="GRAPH_PATCH")`로 저장:
- `target`
- `nodes_added`
- `edges_added`
- `nodes_removed`
- `start_at`
- `rev`

즉, 문서상 계약은 `graph_patch`지만 run_events에는 대문자 `GRAPH_PATCH`로 저장된다.

## 3. 프론트 적용 방식

- feature flag `ENABLE_DYNAMIC_GRAPH_PATCH`가 켜진 경우:
  - 이벤트 목록에서 `GRAPH_PATCH`를 필터링
  - base graph에 patch를 순서대로 적용
  - DAG에 동적 노드/엣지 반영
- flag가 꺼져 있으면 정적 DSL 그래프만 사용

## 4. replay와의 관계

- replay는 이벤트 순서를 재생하므로 `GRAPH_PATCH`도 같은 타임라인으로 반영
- 결과적으로 동적 생성 노드의 상태 변화(`NODE_*`)까지 재현 가능

## 5. live runner 모니터와의 관계

- `/monitor` 페이지는 WS 실시간 메시지에서 `graph_patch`를 받아 즉시 patch 배열에 추가
- 해당 patch는 DAG 렌더 단계에서 apply되어 화면에 반영됨

## 6. 현재 제약/주의

- patch schema는 middleware 메시지 계약에 의존
- patch 충돌/역순 입력/중복 rev 처리 정책은 엄격히 정의되어 있지 않음(코드 보정 위주)
- 에디터로 역수출(export) 경로는 아직 구현되지 않음
