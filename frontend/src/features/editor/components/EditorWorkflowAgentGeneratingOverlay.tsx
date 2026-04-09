"use client";

export type EditorWorkflowAgentGeneratingOverlayProps = {
  visible: boolean;
};

export function EditorWorkflowAgentGeneratingOverlay({
  visible
}: EditorWorkflowAgentGeneratingOverlayProps) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/25"
      data-testid="editor-workflow-agent-generating"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 rounded-xl bg-white px-8 py-6 shadow-xl">
        <svg
          className="h-8 w-8 animate-spin text-slate-800"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <p className="text-sm font-medium text-slate-800">워크플로 초안 생성 중…</p>
      </div>
    </div>
  );
}
