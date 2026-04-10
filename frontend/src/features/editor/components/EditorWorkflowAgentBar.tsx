"use client";

import type { SVGProps } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";

import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";
import { workflowAgentModelOptionLabel } from "@/features/editor/workflowAgentModelLabel";
import { AGENT_DRAFT_PLACEHOLDER } from "@/features/editor/workflowAgentDraftConstants";

const PROMPT_MAX_HEIGHT_PX = 192;

/** 배경 없음 · Heroicons 24 outline sparkles와 동일 */
function DraftAssistIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846-2.846-.813 2.846-.813L9 11.25l.813 2.846 2.846.813-2.846.813z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18.259 8.715L18 9.75l-.259-1.035-1.035-.259L18 7.75l.259-1.035 1.035-.259L18.75 6l.259 1.035 1.035.259L18.75 9l-.259-1.035-1.035-.259z"
      />
    </svg>
  );
}

const fieldBase = cn(
  "rounded-md border border-slate-200 bg-white text-sm text-slate-800",
  "outline-none transition placeholder:text-slate-400",
  "focus-visible:border-slate-400 focus-visible:ring-1 focus-visible:ring-slate-300/80",
  "disabled:cursor-not-allowed disabled:opacity-50"
);

const selectClassName = cn(
  fieldBase,
  "h-10 min-h-10 min-w-0 w-full flex-1 py-0 pl-2.5 pr-7 text-xs font-medium sm:w-auto sm:max-w-[10rem] sm:flex-none",
  "appearance-none bg-[length:0.6rem] bg-[right_0.45rem_center] bg-no-repeat",
  "[background-image:url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20fill%3D%27none%27%20viewBox%3D%270%200%2020%2020%27%20stroke%3D%27%2364748b%27%20stroke-width%3D%272%27%3E%3Cpath%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%20d%3D%27M6%208l4%204%204-4%27%2F%3E%3C%2Fsvg%3E')]"
);

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
  placeholder = AGENT_DRAFT_PLACEHOLDER,
  onGenerate,
  disabled,
  disabledHint,
  feedbackMessage = null
}: EditorWorkflowAgentBarProps) {
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const syncPromptHeight = useCallback(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, PROMPT_MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > PROMPT_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    syncPromptHeight();
  }, [syncPromptHeight, prompt, placeholder]);

  return (
    <div
      className="shrink-0 border-t border-slate-200 bg-white px-2 py-2.5 sm:px-3"
      data-testid="editor-workflow-agent-bar"
    >
      {disabledHint ? (
        <p className="mb-2 text-center text-xs text-amber-900" role="status">
          {disabledHint}
        </p>
      ) : null}

      {/* 순서: 아이콘 → 모델 → 입력 → Generate (모바일: 1행에 아이콘+모델, 이어서 입력·버튼) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex min-w-0 items-center gap-2 sm:contents">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center text-indigo-500/90"
            aria-hidden
          >
            <DraftAssistIcon className="size-6 shrink-0" />
          </div>

          <label htmlFor="workflow-agent-model" className="sr-only">
            생성에 사용할 언어 모델
          </label>
          <select
            id="workflow-agent-model"
            title={selectedModel ? `모델 id: ${selectedModel}` : undefined}
            className={selectClassName}
            value={selectedModel}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={disabled || modelIds.length === 0}
            aria-label="생성에 사용할 언어 모델"
          >
            {modelIds.map((id) => (
              <option key={id} value={id} title={id}>
                {workflowAgentModelOptionLabel(id)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <label htmlFor="workflow-agent-prompt" className="sr-only">
              Workflow 설명
            </label>
            <textarea
              ref={promptRef}
              id="workflow-agent-prompt"
              rows={1}
              className={cn(
                fieldBase,
                "min-h-10 w-full min-w-0 flex-1 resize-none px-3 py-2 leading-snug",
                "max-h-48"
              )}
              placeholder={placeholder}
              value={prompt}
              spellCheck={false}
              onChange={(event) => onPromptChange(event.target.value)}
              disabled={disabled}
            />
            <Button
              type="button"
              className="h-10 w-full shrink-0 px-4 sm:w-auto"
              onClick={onGenerate}
              disabled={disabled || !prompt.trim()}
            >
              Generate
            </Button>
          </div>
          {feedbackMessage ? (
            <p className="text-xs text-red-700" role="alert">
              {feedbackMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
