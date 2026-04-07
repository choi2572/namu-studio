"use client";

export type EditorNoticeToastsProps = {
  publishToastVisible: boolean;
  failureFlowToastMessage: string | null;
};

export function EditorNoticeToasts({
  publishToastVisible,
  failureFlowToastMessage
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
    </>
  );
}
