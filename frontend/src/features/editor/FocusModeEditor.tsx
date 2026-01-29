"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type FocusModeEditorProps = {
  isActive: boolean;
  children: ReactNode;
};

export function FocusModeEditor({ isActive, children }: FocusModeEditorProps) {
  return (
    <div className={cn("relative", isActive && "rounded-xl")}>
      {isActive && (
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-slate-900/5" />
      )}
      <div className={cn("relative", isActive && "z-10")}>{children}</div>
    </div>
  );
}
