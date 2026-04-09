"use client";

import { Button } from "@/components/Button";

const defaultPlaceholder = "대충 workflow를 생성해보세요…";

export type EditorWorkflowAgentBarProps = {
  modelIds: string[];
  selectedModel: string;
  onModelChange: (id: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  /** 비어 있으면 기본 placeholder 사용 */
  placeholder?: string;
  onGenerate: () => void;
  /** true면 입력·Generate 비활성 (동기화 중, 에이전트 미준비 등) */
  disabled: boolean;
  disabledHint: string | null;
  /** draft 실패 시 errors·안내 (textarea 아래) */
  feedbackMessage?: string | null;
};

export function EditorWorkflowAgentBar({
  modelIds,
  selectedModel,
  onModelChange,
  prompt,
  onPromptChange,
  placeholder = defaultPlaceholder,
  onGenerate,
  disabled,
  disabledHint,
  feedbackMessage = null
}: EditorWorkflowAgentBarProps) {
  return (
    <div
      className="shrink-0 border-t border-slate-200 bg-white px-1 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] sm:px-2"
      data-testid="editor-workflow-agent-bar"
    >
      {disabledHint ? (
        <p className="mb-2 text-center text-xs text-amber-900" role="status">
          {disabledHint}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex shrink-0 flex-col gap-1 sm:w-40">
          <label
            htmlFor="workflow-agent-model"
            className="text-[10px] font-medium uppercase tracking-wide text-slate-500"
          >
            모델
          </label>
          <select
            id="workflow-agent-model"
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            value={selectedModel}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={disabled || modelIds.length === 0}
          >
            {modelIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <label htmlFor="workflow-agent-prompt" className="sr-only">
            Workflow 설명
          </label>
          <textarea
            id="workflow-agent-prompt"
            rows={2}
            className="min-h-[44px] w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder={placeholder}
            value={prompt}
            spellCheck={false}
            onChange={(event) => onPromptChange(event.target.value)}
            disabled={disabled}
          />
          {feedbackMessage ? (
            <p className="text-xs text-red-700" role="alert">
              {feedbackMessage}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          className="shrink-0 self-stretch sm:self-auto"
          onClick={onGenerate}
          disabled={disabled || !prompt.trim()}
        >
          Generate
        </Button>
      </div>
    </div>
  );
}
