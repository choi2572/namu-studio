"use client";

export type EditorNoticeToastsProps = {
  publishToastVisible: boolean;
  failureFlowToastMessage: string | null;
  /** Workflow Agent skills/sync 실패 등 */
  workflowAgentSyncErrorMessage?: string | null;
};

export function EditorNoticeToasts({
  publishToastVisible,
  failureFlowToastMessage,
  workflowAgentSyncErrorMessage = null
}: EditorNoticeToastsProps) {
  return (
    <>
      {publishToastVisible && (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg"
          role="status"
        >
          Workflow published successfully.
        </div>
      )}
      {failureFlowToastMessage && (
        <div
          className="fixed bottom-20 right-6 z-50 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg"
          role="status"
        >
          {failureFlowToastMessage}
        </div>
      )}
      {workflowAgentSyncErrorMessage && (
        <div
          className="fixed bottom-36 right-6 z-50 max-w-sm rounded-lg bg-amber-900 px-4 py-3 text-sm font-medium text-amber-50 shadow-lg"
          role="alert"
        >
          Workflow Agent sync failed: {workflowAgentSyncErrorMessage}
        </div>
      )}
    </>
  );
}
