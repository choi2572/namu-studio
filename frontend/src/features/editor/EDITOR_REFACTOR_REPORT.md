# Editor 리팩터링 결과 보고서 (참고용)

이 문서는 `frontend/src/features/editor` 리팩터링·정리 작업의 **최종 스냅샷**을 기록합니다. 향후 유지보수·온보딩 시 참고하세요.

---

## 1. 모듈 구조

```
editor/
├── EditorPage.tsx                 # 페이지 단 orchestration, 훅/JSX (순수 도메인 로직은 아래 모듈로 이동)
├── editorTypes.ts                 # 공용 타입 (외부: @/components/ContainerFrame)
├── editorConstants.ts             # 상수·정적 노드 설정
├── editorPureUtils.ts             # 연산자·가드·클립보드·ID 카운터·clamp 등 순수 유틸
├── editorViewJson.ts              # view_json 파싱 (`parseEditorView`)
├── editorContainerLayout.ts       # 컨테이너 기하·그래프 정규화·자동 레이아웃·캔버스 크기
├── editorDslBuild.ts              # DSL 생성 (`buildDslJson`, `buildViewJson`, `buildStateRecords` 등)
├── editorDslParse.ts              # DSL → 에디터 그래프, OnFailure 복원, import 검증
├── editorCanvasCoordinates.ts     # 순수 좌표 변환 ( 클라이언트 → 캔버스 / Failure 로컬 등 )
├── editorPageOrchestration.ts     # import 롤백 스냅샷, DSL OnFailure 병합, 자식 노드 id 수집 등
├── editorNodeLayout.ts            # 노드 높이·포트 오프셋 (에디터 카드용)
├── editorRetryScope.ts            # Retry 스코프 시작점·멤버십·스코프 내 노드 id / end id
├── editorSkillset.ts              # Skillset → NodeTypeConfig
├── editorFailureGraphInit.ts      # 실패 그래프 초기 상태
├── useFailureGraphCanvasHandlers.ts
├── EDITOR_REFACTOR_REPORT.md      # 본 문서
├── state/
│   ├── conditionMutations.ts
│   ├── nodeMutations.ts
│   └── variableMutations.ts
└── components/
    ├── NodeCard.tsx
    ├── EditorPalette.tsx
    ├── EditorNoticeToasts.tsx
    ├── SearchableNodeDropdown.tsx
    └── dialogs/
```

### 의존성 방향 (순환 없음)

- `editorConstants` → `editorTypes` (단방향). `editorTypes`는 에디터 내부 모듈을 import하지 않음.
- `editorPureUtils` → `editorConstants`, `editorTypes` 만 참조.
- `editorViewJson` → `editorPureUtils`, `editorConstants`, `editorTypes`.
- `editorContainerLayout` → `editorConstants`, `editorNodeLayout`, `editorTypes`, `@/components/ContainerFrame` (region 타입).
- `editorRetryScope` → `editorConstants` (`RETRY_SCOPE_FORBIDDEN_KINDS`), `editorTypes`.
- `editorDslBuild` → `editorRetryScope`, `editorPureUtils`, `editorContainerLayout`, `editorSkillset`, `@/domain/types`, `editorTypes`.
- `editorDslParse` → `editorContainerLayout`, `editorPureUtils`, `editorNodeLayout`, `editorConstants`, `@/lib/featureFlags`, `editorTypes`. **`editorDslBuild`를 import하지 않음** (`parse` ↔ `build` 분리).
- `EditorPage`는 위 모듈·`state/`·`components/`를 참조하며, 순수 로직 모듈에서 `EditorPage`를 import하지 않음.

---

## 2. 추출·정리 요약 (무엇이 바뀌었는지)

### 2.1 좌표 / 캔버스 (`editorCanvasCoordinates.ts`)

- 메인 캔버스: `clientToUnscaledCanvasSpace`, `scrollViewportCenterToUnscaledCanvasPosition`, `canvasPointToNewNodeTopLeft`
- Failure 캔버스: `failureCanvasLocalDropPosition` (y 오프셋은 기존 리터럴 `24` 유지), `parentLocalPositionFromPointer`
- **의도**: 수식은 `EditorPage`와 동일하게 복사; ref/null 처리는 페이지에 유지.

### 2.2 오케스트레이션 (`editorPageOrchestration.ts`)

- `buildEditorImportRollbackSnapshot` / `restoreEditorFromImportRollbackSnapshot`
- `mergePreservedOnFailureIntoDraftDsl`
- `collectChildNodeIdsForContainer`
- `clampEditorNodePositionToCanvas`

### 2.3 순수 도메인 로직 분리 (완만한 6모듈 절)

**목표**: `EditorPage.tsx` 모듈 스코프에 있던 **React·DOM과 무관한 함수**만 잘라서 전용 파일로 이동. 시그니처·동작은 그대로 유지.

| 모듈                         | 주요 심볼                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editorPureUtils.ts`         | `comparisonOperatorToDsl`, `dslOperatorToEditor`, `clamp`, `isRecord`, view/노드 검증·정규화, 클립보드 직렬화, `getNextIndexFromIds`, `assignEditorCountersAfterDraftLoad`                         |
| `editorViewJson.ts`          | `parseEditorView`                                                                                                                                                                                  |
| `editorContainerLayout.ts`   | 컨테이너 타입·프레임·`getCanvasBounds`, 엣지 필터·정규화, topological / auto-layout, `applyImportedLayout`, `getCanvasSizeForNodes`                                                                |
| `editorRetryScope.ts` (확장) | 기존 `getRetryScopeStartNodeId` + `isForbiddenInRetryScope`, `recomputeRetryScopeMembership`, `getRetryScopeNodeIds`, `getRetryScopeEndNodeId`                                                     |
| `editorDslBuild.ts`          | `buildStateNameMap`, `ContainerDslPayload`, 조건값·state 레코드, `buildDslJson`, `buildOnFailureDsl`, `buildViewJson`, `buildRetryScopeSubflow` (`buildStateRecords`와 동일 파일에 두어 순환 방지) |
| `editorDslParse.ts`          | `DslState` 등 내부 타입, `parseDslToEditor`, 실패 캔버스 기본 레이아웃, `failureGraphFromOnFailureDsl`, `validateImportedDslForEditor`                                                             |

**`EditorPage.tsx`에 남긴 것**: `isEditableKeyboardTarget` — `document` / `composedPath` 등 **DOM 의존**으로 순수 모듈로 옮기지 않음.

### 2.4 정리 패스

- 미사용 import·데드 코드 제거 (`getNodeTypeLabel`, `VariableInput` 등)
- `Skillset` 타입 import 경로 정리 (`@/domain/types`)
- 키보드 핸들러: `runModKeyCopy` 등으로만 분할 (동일 실행 순서)

### 2.5 훅 의존성 (안정화)

- `connectNodes`의 `useCallback` deps에 **`edges` 추가** — Retry 가상 엣지 계산 시 최신 그래프 반영.

---

## 3. 상태 소유 (중복이 아닌 이유)

| 영역          | 상태                                    | 비고                    |
| ------------- | --------------------------------------- | ----------------------- |
| 메인 워크플로 | `nodes`, `edges`, 캔버스·줌 등          | 단일 진실 공급원        |
| 실패 핸들링   | `failureGraph`, `failureConnectingFrom` | 별도 캔버스·훅으로 분리 |

---

## 4. 알려진 기술 부채 (TODO)

1. **`NodeCard` `onRetryScopeEndChange`**: `EditorPage`에서 전달하지만 카드 UI에서 아직 호출하지 않음 — JSDoc TODO 참고.
2. **`RecomputeRetryScopeMembershipFn`**: `state/nodeMutations.ts`와 `useFailureGraphCanvasHandlers.ts`에 타입 정의 중복.
3. **`EditorPage.tsx` 규모**: 순수 로직 대부분이 `editorPureUtils`·`editorContainerLayout`·`editorDsl*` 등으로 이전되어 **라인 수는 크게 감소**. 남은 덩어리는 훅·핸들러·JSX; 추가 분리는 훅/서브컴포넌트 단위로 검토 가능.
4. **`handleFailureInputDrop`**: `useCallback` deps가 `failureGraph.edges.length` 중심 (기존 패턴 유지).

---

## 5. 리스크·주의 구간

- **`handleParamChange`**: `setNodes` 이후 `nodes` 스냅샷을 읽는 분기가 있어, 이론상 한 틱 전 상태를 참조할 수 있음 (기존 동작 유지).
- **메인 / 실패 캔버스**: 선택 등 일부 UI 상태가 공유될 수 있어 교차 시나리오 검증 시 주의.
- **`connectNodes`**: deps 보완으로 콜백 참조 갱신 빈도만 증가할 수 있으나, 현재 다른 `useEffect` deps에 넣지 않아 영향은 제한적.

---

## 6. 검증 체크리스트 (작성 시점)

- [x] `npx tsc --noEmit` (프로젝트 루트 `frontend/` 기준)
- [x] 에디터 폴더 내 순환 import 없음
- [x] 주요 훅 의존성 보완 (`connectNodes` + `edges`)

배포/머지 전에는 **기본 E2E·수동 스모크**(연결, 드래그, import, failure drawer) 권장.

---

## 7. 변경 시 권장 원칙

- 캔버스 좌표·줌·연결 규칙 변경은 회귀 테스트와 함께 진행.
- 새 헬퍼는 **순수 함수**로 두고 ref/이벤트는 `EditorPage`에 남기는 편이 안전.
- `EditorPage` 밖으로 상태를 옮길 때는 **단일 소스** 원칙과 effect 순서를 반드시 확인.

---

_문서 버전: DSL/레이아웃 순수 로직 모듈 분리 반영. 내용이 코드와 어긋나면 코드를 우선하고, 이 파일을 갱신하세요._
