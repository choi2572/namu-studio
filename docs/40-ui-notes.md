# UI 노트 (현재 코드 기준)

기준 코드:
- 대시보드: `frontend/src/features/dashboard/DashboardPage.tsx`
- 에디터: `frontend/src/features/editor/EditorPage.tsx`
- 모니터(run 기반): `frontend/src/features/monitor/MonitorPage.tsx`
- 모니터(runner 라이브): `frontend/src/features/monitor/LiveRunnerMonitorPage.tsx`
- 히스토리: `frontend/src/features/history/HistoryPage.tsx`

## 1. 라우팅

- `/` : Dashboard
- `/editor/new`, `/editor/{workflowId}` : Editor
- `/monitor/workflow/{workflowId}` : 실행 전 DAG + Run 버튼 페이지
- `/monitor/{runId}` : run 단위 모니터
- `/monitor/{runId}?mode=replay` : replay 모드
- `/monitor` : middleware runner 라이브 모니터
- `/history` : run 히스토리

### 네이밍 규칙
- UI/Studio API 식별자는 `camelCase`로 표기 (`workflowId`, `runId`, `stateName`)
- 미들웨어 원본 필드는 `snake_case`를 유지 (`workflow_id`, `runner_status`)
- 문장 내 일반 용어는 `Workflow`, `Run`, `Node`로 통일

## 2. Dashboard 동작

- Workflow/Runs 목록을 조회해 통계 카드 표시
- Latest Run 카드에서 상태/현재 노드/소요시간 표시
- 실패 Run 목록 클릭 시 해당 Run 모니터로 이동
- Workflow row 클릭:
  - `DRAFT` -> editor
  - `PUBLISHED` -> `/monitor/workflow/{workflowId}`
- 우하단 `+` 버튼으로 새 Workflow 생성 진입
- Workflow 삭제 버튼 제공(확인 모달 있음)

## 3. Editor 동작

- Draft 조회/저장/검증/Publish/Create 흐름 포함
- skillset API 호출하여 Node/파라미터 관련 UI 사용
- Publish 성공 시 토스트 표시
- 새 Workflow 생성은 Editor 내부에서 API 호출 후 이동

참고:
- 에디터 파일이 매우 큰 편이라 UI 세부 상호작용은 코드가 최종 기준

## 4. Run 모니터 (`/monitor/{runId}`)

- Snapshot/Events 폴링 기반
- DAG + Debug Panel + Timeline 구성
- Node 선택 시 debug(input/output/feedback/decision) 표시
- 실행 중 상태일 때 Cancel 버튼 노출
- 터미널/리플레이 모드에서 Play/Pause 리플레이 컨트롤 노출
- timeline auto-scroll on/off 토글 제공
- 조건 분기(then/else) 선택 경로 시각화 로직 포함

## 5. Runner 라이브 모니터 (`/monitor`)

- middleware WS + runner status polling 하이브리드
- 실행 중 Workflow를 자동 로드하여 DAG 표시
- 연결 상태(Connected/Disconnected) 배지 표시
- Node 선택 시 Debug Panel 표시
- 외부 상태 변경 가능한 Skill의 경우 Success/Failure 액션 버튼 노출

## 6. History 화면

- Runs 목록 + 필터(status/workflow/timeRange)
- Row 클릭 시 replay 모드 모니터로 이동
- FAILED 상태는 popover로 실패 코드/메시지 표시
- 페이지네이션 제공

## 7. 현재 UI 기준 미구현/주의

- History의 `timeRange` 필터는 UI에 있으나 백엔드 실질 필터 미적용 가능
- runner/live monitor는 middleware 메시지 스키마 의존도가 높음
- 일부 문구/행동은 과거 설계 문서보다 현재 코드 구현을 우선
