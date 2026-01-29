"use client";

import type { EditorContext } from "@/features/editor/editorContext";
import { cn } from "@/lib/cn";

type BreadcrumbsProps = {
  contexts: EditorContext[];
  onSelect: (index: number) => void;
};

export function Breadcrumbs({ contexts, onSelect }: BreadcrumbsProps) {
  return (
    <nav className="flex items-center gap-1 text-xs text-slate-600">
      {contexts.map((context, index) => {
        const isLast = index === contexts.length - 1;
        return (
          <span key={`${context.kind}-${context.label}-${index}`} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={isLast}
              className={cn(
                "cursor-pointer rounded px-1 py-0.5 transition-colors",
                isLast
                  ? "text-slate-900 font-semibold"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              )}
            >
              {context.label}
            </button>
            {!isLast && <span className="text-slate-400">›</span>}
          </span>
        );
      })}
    </nav>
  );
}
