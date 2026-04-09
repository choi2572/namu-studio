import type { QueryClient } from "@tanstack/react-query";

import { workflowAgentApi } from "@/api";
import type { WorkflowAgentStatusResponse } from "@/api/workflowAgent";

export type PollWorkflowAgentModelReadyOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  /** 단·통합 테스트용. 미설정 시 `workflowAgentApi.getStatus` */
  getStatus?: () => Promise<WorkflowAgentStatusResponse>;
};

/** activate 후 `model_loaded` 가 될 때까지 짧게 폴링하고 React Query 캐시를 갱신한다. */
export async function pollWorkflowAgentUntilModelReady(
  targetModel: string,
  queryClient: QueryClient,
  workflowId: string,
  options?: PollWorkflowAgentModelReadyOptions
): Promise<WorkflowAgentStatusResponse> {
  const maxAttempts = options?.maxAttempts ?? 120;
  const intervalMs = options?.intervalMs ?? 250;
  const getStatus = options?.getStatus ?? (() => workflowAgentApi.getStatus());
  const key = ["workflow-agent-status", workflowId];
  for (let i = 0; i < maxAttempts; i += 1) {
    const st = await getStatus();
    queryClient.setQueryData(key, st);
    if (st.active_model === targetModel && st.model_loaded) {
      return st;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("모델이 준비되는 데 시간이 오래 걸립니다. 잠시 후 다시 시도해 주세요.");
}
