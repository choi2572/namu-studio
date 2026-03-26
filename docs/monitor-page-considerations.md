# 모니터 페이지 고려사항 (현재 구현 반영)

기준:
- run 모니터: `frontend/src/features/monitor/MonitorPage.tsx`
- runner 라이브 모니터: `frontend/src/features/monitor/LiveRunnerMonitorPage.tsx`

## 1. run 모니터 폴링 규칙

- `run-snapshot`, `run-events`를 주기적으로 폴링
- Run 상태가 terminal(`SUCCESS|FAILED|CANCELED`)이면 폴링 중지
- terminal 전환 직후 한 번 더 refetch하여 마지막 이벤트 누락을 보정

## 2. replay 규칙

- replay는 저장된 이벤트를 순서대로 재적용해 Node 상태를 재구성
- 현재 구현은 시간 기반이 아닌 이벤트 순서 + duration 기반 재생에 가깝다
- `mode=replay` 또는 terminal run에서 replay 컨트롤 노출

## 3. Cancel 동작

- cancel 시 middleware cancel + backend cancel을 모두 시도
- 성공 여부와 별개로 UI 캐시를 terminal 상태로 즉시 갱신해 폴링을 멈춤
- 타임라인에 `RUN_CANCELED` 이벤트를 로컬 추가

## 4. DAG/Timeline 동기화

- Timeline 클릭 시 해당 Node가 DAG에서 선택되도록 연결
- 선택 Node는 Debug Panel 데이터 조회와 연결됨
- condition 분기는 이벤트 순서를 기반으로 then/else 경로를 계산해 표시

## 5. debug 패널 규칙

- 기본 데이터는 백엔드 `node debug` API 사용
- 라이브 모드(` /monitor `)는 WS payload(input/output/feedback)와 백엔드 데이터를 병합 표시
- 데이터가 없으면 빈 객체 또는 null-safe 렌더링

## 6. 라이브 러너 모니터(` /monitor `) 특성

- WS와 REST polling을 함께 사용
- WS 연결 깜빡임 완화를 위해 disconnected/error를 debounce 처리
- 실행 Workflow가 바뀌면 DSL/view를 다시 로드

## 7. 동적 그래프 패치(VLM)

- feature flag(`ENABLE_DYNAMIC_GRAPH_PATCH`)가 켜져 있고 `GRAPH_PATCH` 이벤트가 있으면 DAG를 동적으로 갱신
- replay에서도 patch 이벤트를 순차 반영 가능

## 8. 남은 리스크/개선 포인트

- 이벤트가 매우 많을 때 timeline 렌더링 비용 증가 가능
- middleware 메시지 스키마 변경 시 parser/상태 매핑 코드 동시 수정 필요
