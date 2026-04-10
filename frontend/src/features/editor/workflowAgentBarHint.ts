import type { WorkflowAgentStatusResponse } from "@/api/workflowAgent";

export type WorkflowAgentBarHintInput = {
  agentConfigured: boolean;
  syncPending: boolean;
  syncErrorMessage: string | null;
  statusError: Error | null;
  status: WorkflowAgentStatusResponse | undefined;
  syncSucceeded: boolean;
};

export function getWorkflowAgentBarHint(input: WorkflowAgentBarHintInput): string | null {
  if (!input.agentConfigured) return null;
  if (input.syncPending) return "스킬 카탈로그 동기화 중…";
  if (input.syncErrorMessage) return input.syncErrorMessage;
  if (input.statusError) return input.statusError.message;
  const st = input.status;
  if (!st && input.syncSucceeded) return "에이전트 상태를 불러오는 중…";
  if (!st) return null;
  if (!st.alive) return "Workflow Agent에 연결할 수 없습니다.";
  if (!st.skills_ready) return "스킬 컨텍스트가 준비되지 않았습니다.";
  // model_loaded false(전환 중)여도 Generate가 큐에서 대기하므로 막지 않음
  return null;
}
