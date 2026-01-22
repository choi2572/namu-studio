# namu-studio

Robot Workflow Authoring & Monitoring Tool (frontend scaffold).

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Project Structure

```
src/
  api/          # API interfaces + mock implementation
  components/   # Reusable UI components
  domain/       # DTOs, enums, pure logic
  features/     # Dashboard, Editor, Monitor, History
  lib/          # Utilities (formatting, ids, helpers)
  tests/        # Unit tests for domain + mock API
```

## Replace Mock API with Real API

1. Implement real API clients that satisfy the interfaces in:
   - `src/api/interfaces.ts`
2. Create a real API module (e.g. `src/api/real/workflowsApi.ts` and
   `src/api/real/runsApi.ts`).
3. Swap the exports in `src/api/index.ts`:

```ts
// import { mockRunsApi, mockWorkflowsApi } from "@/api/mock/mockApi";
// export const workflowsApi = mockWorkflowsApi;
// export const runsApi = mockRunsApi;

export const workflowsApi = realWorkflowsApi;
export const runsApi = realRunsApi;
```

## Tests

```bash
npm run test
```