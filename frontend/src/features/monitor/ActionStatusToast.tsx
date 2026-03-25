"use client";

import { cn } from "@/lib/cn";

export type ActionStatusToastVariant = "success" | "rejected" | "error" | "timeout";

export type ActionStatusToastState = {
  message: string;
  variant: ActionStatusToastVariant;
};

/** Toast auto-hide after successful/error responses (not tied to request timeout). */
export const ACTION_STATUS_TOAST_DISMISS_MS = 4500;

const variantBox: Record<ActionStatusToastVariant, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  rejected: "border-amber-300 bg-amber-50 text-amber-950",
  error: "border-red-200 bg-red-50 text-red-950",
  timeout: "border-orange-300 bg-orange-50 text-orange-950"
};

const variantLabel: Record<ActionStatusToastVariant, string> = {
  success: "Change status · Accepted",
  rejected: "Change status · Rejected",
  error: "Change status · Failed",
  timeout: "Change status · No response"
};

type ActionStatusToastProps = {
  toast: ActionStatusToastState | null;
  onDismiss: () => void;
};

export function isFetchAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function ActionStatusToast({ toast, onDismiss }: ActionStatusToastProps) {
  if (!toast) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[100] max-w-sm"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "pointer-events-auto rounded-lg border p-4 shadow-lg ring-1 ring-black/5",
          variantBox[toast.variant]
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-current/80">
              {variantLabel[toast.variant]}
            </p>
            <p className="mt-1.5 break-words text-sm font-medium leading-snug">{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-lg leading-none text-current/70 transition hover:bg-black/5 hover:text-current"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
