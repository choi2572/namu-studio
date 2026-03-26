# 데이터 모델 (현재 코드 기준)

기준 코드:
- 도메인 모델: `backend/app/domain/models.py`
- sqlite 스키마: `backend/app/db/schema.py`

표기 규칙:
- DB/백엔드 저장 필드는 `snake_case`를 사용한다.
- 프론트/Studio API에서는 동일 의미의 필드가 `camelCase`로 노출될 수 있다.

## 1. 엔티티 개요

현재 실제 사용 엔티티:
- `Workflow`
- `WorkflowVersion`
- `WorkflowView`
- `Run`
- `NodeRun`
- `RunEvent`

## 2. enum

- `WorkflowState`: `DRAFT`, `PUBLISHED`
- `VersionState`: `DRAFT`, `PUBLISHED`
- `RunStatus`: `CREATED`, `RUNNING`, `WAITING`, `SUCCESS`, `FAILED`, `CANCELED`
- `NodeStatus`: `READY`, `RUNNING`, `WAITING`, `SUCCEEDED`, `FAILED`, `SKIPPED`, `CANCELED`

## 3. 테이블/필드

### workflows
- `workflow_id` PK
- `name`
- `description`
- `state`
- `current_published_version_id`
- `created_at`
- `updated_at`

### workflow_versions
- `version_id` PK
- `workflow_id` FK -> workflows
- `version_number` (문자열, 예: `v1`)
- `state`
- `dsl_json` (JSON 문자열)
- `created_at`
- `published_at`

### workflow_views
- `version_id` PK/FK -> workflow_versions
- `view_json` (JSON 문자열)
- `created_at`
- `updated_at`

### runs
- `run_id` PK
- `workflow_id` FK -> workflows
- `version_id` FK -> workflow_versions
- `trigger_type` (현재 기본값 `MANUAL`)
- `trigger_meta_json`
- `run_input_json`
- `status`
- `failure_code`
- `failure_message`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`
- `middleware_workflow_id` (schema v2에서 추가)

### node_runs
- `node_run_id` PK
- `run_id` FK -> runs
- `state_name`
- `node_type`
- `attempt` (기본 1)
- `status`
- `started_at`
- `finished_at`
- `duration_ms`
- `input_json`
- `output_json`
- `state_snapshot_json`
- `feedback_json`
- `decision_json`

### run_events
- `event_id` PK
- `run_id` FK -> runs
- `seq` (run별 증가)
- `timestamp`
- `event_type`
- `state_name`
- `payload_json`
- `created_at`

## 4. 관계

- workflow 1:N workflow_versions
- workflow_versions 1:1 workflow_views(버전별 view)
- workflow 1:N runs
- run 1:N node_runs
- run 1:N run_events

## 5. 인덱스

현재 스키마 인덱스:
- `runs(status, started_at)`
- `runs(workflow_id, started_at)`
- `node_runs(run_id, state_name)`
- `run_events(run_id, seq)`
- `workflow_versions(workflow_id, version_number)`
- `runs(middleware_workflow_id)` (v2)

## 6. 데이터 모델 특이사항

- published 버전도 `workflow_versions`에 저장되며 immutable로 취급
- Draft 저장/조회는 최신 draft 버전을 중심으로 동작
- Run duration은 `started_at/finished_at`로 계산해서 응답 시 제공
- 이벤트 payload는 JSON blob 형태이며 event_type별 스키마 고정이 아님

## 7. 현재 미구현/비포함

- 별도 `ExternalEvent` 테이블 없음
- artifact/log 전용 테이블 없음
- 다중 로봇/멀티 테넌트 필드 없음
