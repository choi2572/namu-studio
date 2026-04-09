import type { WorkflowAgentDraftFailureResponse } from "@/api/workflowAgent";

export type WorkflowAgentImportConfirmContext = {
  hasUnsavedChanges: boolean;
  mainNodeCount: number;
  mainEdgeCount: number;
  failureGraphEnabled: boolean;
  failureNodeCount: number;
};

/** Generate로 DSL을 가져온 뒤 덮어쓰기 확인 대화상자를 띄울지 여부 */
export function shouldConfirmWorkflowAgentImport(ctx: WorkflowAgentImportConfirmContext): boolean {
  return (
    ctx.hasUnsavedChanges ||
    ctx.mainNodeCount > 0 ||
    ctx.mainEdgeCount > 0 ||
    (ctx.failureGraphEnabled && ctx.failureNodeCount > 0)
  );
}

const DEFAULT_RETRY_PLACEHOLDER = "다시 입력해 보세요.";

export function getWorkflowAgentDraftFailureHints(res: WorkflowAgentDraftFailureResponse): {
  feedbackMessage: string | null;
  placeholder: string;
} {
  const errJoined = res.errors.filter(Boolean).join(" · ");
  const basic = res.guidance.basic?.trim() ?? "";
  const suggest = res.guidance.suggestion?.trim() ?? "";
  return {
    feedbackMessage: errJoined || basic || suggest || null,
    placeholder: suggest || basic || res.errors[0] || DEFAULT_RETRY_PLACEHOLDER
  };
}
