# Frontend

Next.js 기반 프론트엔드 애플리케이션입니다.

## 설치

```bash
cd frontend
npm install
```

## 실행

```bash
npm run dev
```

애플리케이션은 `http://localhost:3000`에서 실행됩니다.

## 프로젝트 구조

```
src/
  api/          # API 인터페이스 + mock 구현
  components/   # 재사용 가능한 UI 컴포넌트
  domain/       # DTOs, enums, 순수 로직
  features/     # Dashboard, Editor, Monitor, History
  lib/          # 유틸리티 (포맷팅, ids, 헬퍼)
  tests/        # 도메인 + mock API 단위 테스트
```

## Mock API에서 실제 API로 전환

현재는 mock 데이터를 사용하고 있습니다. 실제 백엔드 API로 전환하려면:

1. `src/api/index.ts`에서 mock API를 실제 API 클라이언트로 교체:

```ts
// import { mockRunsApi, mockWorkflowsApi } from "@/api/mock/mockApi";
// export const workflowsApi = mockWorkflowsApi;
// export const runsApi = mockRunsApi;

import { realWorkflowsApi, realRunsApi } from "@/api/real";
export const workflowsApi = realWorkflowsApi;
export const runsApi = realRunsApi;
```

2. 실제 API 클라이언트를 `src/api/real/`에 구현합니다.

3. API base URL을 환경 변수로 설정:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api
```

## 테스트

```bash
npm run test
```
