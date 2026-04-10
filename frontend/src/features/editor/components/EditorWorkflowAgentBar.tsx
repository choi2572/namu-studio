"use client";

import type { SVGProps } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";

import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";
import { workflowAgentModelOptionLabel } from "@/features/editor/workflowAgentModelLabel";

const defaultPlaceholder = "대충 workflow를 생성해보세요…";
const PROMPT_MAX_HEIGHT_PX = 192; // 12rem — 채팅 입력처럼 자동 확장 상한

function DraftSparklesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M9.813 15.904L9 18.75l-.813-2.846-2.846-.813 2.846-.813L9 11.25l.813 2.846 2.846.813-2.846.813zM18.259 8.715L18 9.75l-.259-1.035-1.035-.259L18 7.75l.259-1.035 1.035-.259L18.75 6l.259 1.035 1.035.259L18.75 9l-.259-1.035-1.035-.259z" />
    </svg>
  );
}

const selectClassName = cn(
  "min-w-0 rounded-lg border border-slate-200 bg-slate-50/80 py-2 pl-2.5 pr-8 text-xs font-medium text-slate-700",
  "shadow-sm outline-none transition hover:border-slate-300 hover:bg-white focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-400/25",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "appearance-none bg-[length:0.65rem] bg-[right_0.55rem_center] bg-no-repeat",
  "[background-image:url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20fill%3D%27none%27%20viewBox%3D%270%200%2020%2020%27%20stroke%3D%27%2364748b%27%20stroke-width%3D%272%27%3E%3Cpath%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%20d%3D%27M6%208l4%204%204-4%27%2F%3E%3C%2Fsvg%3E')]",
  "w-full sm:max-w-[9.5rem] sm:text-[11px]"
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
  placeholder = defaultPlaceholder,
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
      className="shrink-0 border-t border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-white px-2 py-3 shadow-[0_-6px_24px_rgba(15,23,42,0.06)] sm:px-3"
      data-testid="editor-workflow-agent-bar"
    >
      {disabledHint ? (
        <p className="mb-2 text-center text-xs text-amber-900" role="status">
          {disabledHint}
        </p>
      ) : null}
      <div
        className={cn(
          "rounded-2xl border border-slate-200/80 bg-white/90 p-2 shadow-sm backdrop-blur-sm",
          "grid grid-cols-[auto_minmax(0,1fr)] gap-2",
          "sm:grid-cols-[auto_minmax(0,1fr)_auto]",
          "sm:grid-rows-[auto_1fr]"
        )}
      >
        <div
          className={cn(
            "row-start-1 col-start-1 flex items-center justify-center self-start pt-0.5 sm:pt-1",
            "sm:row-span-1"
          )}
        >
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-inner",
              "from-violet-500 to-indigo-600 text-white",
              "sm:size-12"
            )}
            aria-hidden
          >
            <DraftSparklesIcon className="size-6 opacity-95" />
          </div>
        </div>

        <div
          className={cn(
            "row-start-1 col-start-2 flex min-w-0 flex-col gap-1",
            "sm:row-span-2 sm:row-start-1 sm:col-start-2 sm:self-stretch"
          )}
        >
          <label htmlFor="workflow-agent-prompt" className="sr-only">
            Workflow 설명
          </label>
          <textarea
            ref={promptRef}
            id="workflow-agent-prompt"
            rows={1}
            className={cn(
              "min-h-[44px] w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-snug text-slate-800",
              "max-h-48 placeholder:text-slate-400 shadow-inner",
              "outline-none transition focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-300/25",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
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

        <label htmlFor="workflow-agent-model" className="sr-only">
          생성에 사용할 언어 모델
        </label>
        <select
          id="workflow-agent-model"
          title={selectedModel ? `모델 id: ${selectedModel}` : undefined}
          className={cn(
            selectClassName,
            "row-start-2 col-span-2 justify-self-stretch sm:row-start-2 sm:col-start-1 sm:col-span-1 sm:justify-self-center"
          )}
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

        <div className="row-start-3 col-span-2 sm:row-start-1 sm:col-start-3 sm:row-span-2 sm:col-span-1 sm:flex sm:items-stretch">
          <Button
            type="button"
            className="h-full min-h-[44px] w-full rounded-xl sm:min-h-0 sm:w-auto sm:self-stretch sm:px-5"
            onClick={onGenerate}
            disabled={disabled || !prompt.trim()}
          >
            Generate
          </Button>
        </div>
      </div>
    </div>
  );
}
