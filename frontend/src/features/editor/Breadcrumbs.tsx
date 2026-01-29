"use client";

import type { EditorContext } from "@/features/editor/editorContext";
import { formatContextLabel } from "@/features/editor/editorContext";
import { cn } from "@/lib/cn";

type BreadcrumbsProps = {
  contexts: EditorContext[];
  onSelect: (index: number) => void;
};

export function Breadcrumbs({ contexts, onSelect }: BreadcrumbsProps) {
  const getChipStyles = (context: EditorContext) => {
    switch (context.kind) {
      case "parallel":
        return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "repeat":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "branch":
        return "bg-sky-50 text-sky-700 border-sky-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const renderIcon = (context: EditorContext) => {
    switch (context.kind) {
      case "parallel":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3 w-3"
          >
            <path d="M6 4h2v12H6V4zm6 0h2v12h-2V4z" />
          </svg>
        );
      case "repeat":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3 w-3"
          >
            <path d="M6.5 4.5a4 4 0 0 1 6.89 2.5H15a5.5 5.5 0 0 0-9.9-3.3L3 1.7V7h5.3L6.8 5.5A3.5 3.5 0 0 1 10 3.5Zm7 11.8V11h-5.3l1.5 1.5a3.5 3.5 0 0 1-6.2-2.5H3a5.5 5.5 0 0 0 9.9 3.3l2.1 2.1Z" />
          </svg>
        );
      case "branch":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3 w-3"
          >
            <path d="M6 4a2 2 0 1 1 0 4h2a4 4 0 0 0 4 4h2a2 2 0 1 1 0 2h-2a6 6 0 0 1-6-6H6a2 2 0 0 1 0-4Z" />
          </svg>
        );
      default:
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3 w-3"
          >
            <path d="M10 2 2 6v8l8 4 8-4V6l-8-4Zm0 2.2 5.5 2.7-5.5 2.6-5.5-2.6L10 4.2Z" />
          </svg>
        );
    }
  };

  return (
    <nav className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
      {contexts.map((context, index) => {
        const isLast = index === contexts.length - 1;
        return (
          <span key={`${context.kind}-${context.label}-${index}`} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={isLast}
              className={cn(
                "cursor-pointer inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors",
                getChipStyles(context),
                isLast ? "opacity-100" : "hover:opacity-90"
              )}
            >
              {renderIcon(context)}
              <span>{formatContextLabel(context)}</span>
            </button>
            {!isLast && <span className="text-slate-400">›</span>}
          </span>
        );
      })}
    </nav>
  );
}
