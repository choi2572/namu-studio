# 모니터 페이지 구현 시 주의사항

## 1. Live Mode Polling (중요)

**현재 문제**: 시뮬레이션 이벤트만 사용 중

**UI 노트 요구사항**: "Auto-updating via backend polling"

**해결 방법**:
```typescript
// useQuery에 refetchInterval 추가
const { data: snapshot } = useQuery({
  queryKey: ["run-snapshot", runId],
  queryFn: () => runsApi.getSnapshot(runId),
  enabled: !isReplayMode && runStatus !== null && !isTerminal,
  refetchInterval: (query) => {
    const status = query.state.data?.run.status;
    // RUNNING 또는 WAITING일 때만 polling
    return status === RunStatus.RUNNING || status === RunStatus.WAITING 
      ? 2000 // 2초마다
      : false;
  }
});

// 새 이벤트 가져오기
const { data: newEvents } = useQuery({
  queryKey: ["run-events", runId, events.length],
  queryFn: () => runsApi.getEvents(runId, events.length > 0 ? events[events.length - 1].seq : 0),
  enabled: !isReplayMode && runStatus !== null && !isTerminal,
  refetchInterval: (query) => {
    const status = runStatus;
    return status === RunStatus.RUNNING || status === RunStatus.WAITING ? 2000 : false;
  }
});
```

## 2. Replay Mode 구현 (중요)

**현재 문제**: Play/Pause/Scrub이 실제로 동작하지 않음

**UI 노트 요구사항**: 
- Play/Pause로 재생 제어
- Scrub으로 특정 시점으로 이동

**해결 방법**:
```typescript
// replayPosition에 따라 표시할 이벤트 필터링
const visibleEvents = useMemo(() => {
  if (!isReplayMode || !replayPlaying) {
    // Pause 상태: 현재 position까지의 이벤트만 표시
    const maxSeq = Math.floor((replayPosition / 100) * initialEvents.length);
    return initialEvents.filter(e => e.seq <= maxSeq);
  }
  // Play 상태: 시간에 따라 점진적으로 표시
  return initialEvents; // 실제로는 애니메이션 필요
}, [isReplayMode, replayPlaying, replayPosition, initialEvents]);

// replayPosition에 따라 노드 상태도 업데이트
useEffect(() => {
  if (!isReplayMode || !snapshot) return;
  // replayPosition에 해당하는 시점의 노드 상태로 업데이트
  // 이벤트 히스토리를 역추적하여 노드 상태 복원
}, [isReplayMode, replayPosition, snapshot]);
```

## 3. Top Bar 레이아웃

**UI 노트 요구사항**: 
- Left: Workflow name + Run state

**현재**: Workflow name만 표시

**수정 필요**:
```typescript
<div>
  <h1 className="text-xl font-semibold">{workflowName}</h1>
  {runStatus && (
    <p className="text-sm text-slate-500 mt-1">
      Status: <StatusBadge status={runStatus} />
    </p>
  )}
</div>
```

## 4. 이벤트 순서 보장

**주의**: Timeline의 이벤트는 반드시 시간 순서대로 정렬되어야 함

```typescript
const sortedEvents = useMemo(() => {
  return [...events].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.seq - b.seq; // 같은 시간이면 seq로 정렬
  });
}, [events]);
```

## 5. 노드 선택 동기화

**주의**: Timeline에서 이벤트 클릭 시 DAG view의 노드도 하이라이트되어야 함

**현재**: 구현되어 있음 (selectedNode 상태로 관리)

## 6. Auto-scroll 동작

**주의**: 
- Live 모드에서만 auto-scroll 활성화
- 사용자가 스크롤하면 auto-scroll 중지
- Replay 모드에서는 auto-scroll 없음

**현재**: 구현되어 있음

## 7. Cancel 기능

**주의**: 
- Cancel은 실제 API 호출이 필요 (현재는 로컬 상태만 변경)
- Cancel 후 polling 중지

```typescript
const handleCancel = async () => {
  if (!snapshot) return;
  try {
    await runsApi.cancelRun(runId); // API 호출 필요
    setRunStatus(RunStatus.CANCELED);
  } catch (error) {
    // 에러 처리
  }
};
```

## 8. DAG View 개선

**현재**: 그리드 레이아웃으로 노드 표시

**향후 개선**:
- 실제 DAG 그래프로 표시 (노드 간 연결선 표시)
- Workflow view_json의 노드 위치 정보 활용
- 노드 간 transition 표시

## 9. 에러 처리

**주의**: 
- API 호출 실패 시 에러 메시지 표시
- 네트워크 오류 시 재시도 로직
- 로딩 상태 표시

## 10. 성능 최적화

**주의**:
- 많은 이벤트가 있을 때 Timeline 렌더링 최적화 (가상화 고려)
- 노드 상태 업데이트 시 불필요한 리렌더링 방지
- useMemo, useCallback 적절히 활용

## 11. 접근성

**주의**:
- 키보드 네비게이션 지원
- 스크린 리더 지원
- 포커스 관리

## 12. 상태 관리 일관성

**주의**:
- Replay 모드와 Live 모드의 상태 분리
- Replay 모드에서는 절대 실행을 트리거하지 않음 (UI 노트 규칙)
- Live 모드에서만 Cancel 가능
