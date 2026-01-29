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
      {isActive && <div className="focus-mode-overlay" />}
      <div
        className={cn(
          "relative",
          isActive && "focus-mode-frame focus-mode-zoom"
        )}
      >
        {children}
      </div>
    </div>
  );
}
