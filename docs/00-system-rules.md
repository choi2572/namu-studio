# Namu Studio 시스템 규칙 (코드 기준)

이 문서는 현재 저장소 구현을 기준으로 시스템 규칙을 정리한 것이다.  
설계 문서와 충돌할 경우 코드 동작이 우선이다.

## 1. 우선순위

- 진실의 원천(SSOT): 백엔드 저장소 상태 + 백엔드 API 응답
- 프론트엔드는 표시/상호작용 계층이며 최종 상태 판정은 백엔드 기준
- 문서 목적: 구현된 동작 설명 + 미구현 지점 표시

## 1.1 용어/표기 컨벤션

- 문서 본문 용어는 `Workflow`, `Run`, `Node`, `Draft`, `Publish`로 통일
- 백엔드 내부(DB/파이썬) 식별자는 `snake_case` (`workflow_id`, `run_id`)
- 프론트/Studio API 식별자는 `camelCase` (`workflowId`, `runId`)
- 미들웨어 원본 payload는 원문 스키마를 우선(`workflow_id`, `runner_status`)

## 2. 실행 모델 핵심 규칙

- 단일 활성 Run 규칙: `RUNNING`/`WAITING` Run은 전체 시스템에서 최대 1개
- 새 Run 시작 시 활성 Run이 있으면 거절(`409`)
- 단, 같은 Workflow가 이미 실행 중이면 기존 Run을 반환할 수 있음(리다이렉트용)
- Run 터미널 상태: `SUCCESS`, `FAILED`, `CANCELED`
- Node 상태: `READY`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `SKIPPED`, `CANCELED`

## 3. 워크플로우/버전 규칙

- Workflow 상태: `DRAFT`, `PUBLISHED`
- Draft는 `workflow_versions.state=DRAFT` 버전으로 저장
- Publish는 검증 통과된 Draft만 가능
- `current_published_version_id`가 실행 가능한 버전을 가리킴
- Draft가 없으면 `get_draft`가 현재 published 버전을 fallback으로 반환

## 4. DSL 검증 규칙(현재 구현)

- 루트 필수: `StartAt`(string), `States`(object, 1개 이상)
- `StartAt`는 `States`에 존재해야 함
- 순환(cycle) 금지
- 공통 제약: `Next`와 `End=true` 동시 사용 금지
- `Condition`/`Parallel`/`Choice` 외 노드는 `Next` 또는 `End` 필요
- 상태 타입별 제약
  - `Skill`: `Skill` 필수
  - `Condition`: `If.Condition`, `If.Then`, `Else` 필수 및 참조 유효성 검사
  - `Parallel`: `Branches` 1개 이상, branch별 `StartAt/States` 필수, nested parallel 금지(M1)
  - `Wait`: `Event` 필수, `Event.Type`은 `webhook|ros_topic`, `Timeout` 필수

## 5. 모니터링/이벤트 규칙

- Timeline/Replay는 `run_events.seq` 순서를 기준으로 동작
- Snapshot은 Run 요약 + nodeStates를 반환
- Node debug 데이터가 없으면 빈 번들 형태 응답
- 프론트는 Run이 터미널 상태가 되면 폴링 중지

## 6. 실행 엔진 규칙

- `dummy` 엔진: 백엔드 내부 시뮬레이터 실행
- `middleware` 엔진: 미들웨어 REST + WS 모니터 이벤트를 DB에 반영
- `middleware` 모드에서 WS 종료 시 REST 조회로 상태 보정 시도

## 7. 저장소/DB 규칙

- 저장소 백엔드: `inmemory` 또는 `sqlite`
- sqlite 스키마 버전: `2`
- 주요 테이블: workflows, workflow_versions, workflow_views, runs, node_runs, run_events

## 8. 현재 미구현/주의 사항

- `RunService.resume_wait` 인터페이스는 있으나 middleware 어댑터 구현은 미완성
- `GET /api/capabilities/skills`는 더미 응답
- `GET /api/runs`의 `timeRange` 파라미터는 현재 백엔드에서 실질 필터 미적용
