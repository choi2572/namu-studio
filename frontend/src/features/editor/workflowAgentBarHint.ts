import type { WorkflowAgentStatusResponse } from "@/api/workflowAgent";

export type WorkflowAgentBarHintInput = {
  agentConfigured: boolean;
  syncPending: boolean;
  syncErrorMessage: string | null;
  statusError: Error | null;
  status: WorkflowAgentStatusResponse | undefined;
  syncSucceeded: boolean;
  agentReadyForDraftUi: boolean;
};

export function getWorkflowAgentBarHint(input: WorkflowAgentBarHintInput): string | null {
  if (!input.agentConfigured) return null;
  if (input.syncPending) return "스킬 카탈로그 동기화 중…";
  if (input.syncErrorMessage) return input.syncErrorMessage;
  if (input.statusError) return input.statusError.message;
  const st = input.status;
  if (!st && input.syncSucceeded) return "에이전트 상태를 불러오는 중…";
  if (!st) return null;
  if (input.agentReadyForDraftUi) return null;
  if (!st.alive) return "Workflow Agent에 연결할 수 없습니다.";
  if (!st.skills_ready) return "스킬 컨텍스트가 준비되지 않았습니다.";
  if (!st.model_loaded) return "모델을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.";
  return null;
}
