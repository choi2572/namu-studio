"use client";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export type PublishConfirmDialogProps = {
  onBackdropClick: () => void;
  onCancelClick: () => void;
  onPublishClick: () => void;
  isPublishPending: boolean;
};

export function PublishConfirmDialog({
  onBackdropClick,
  onCancelClick,
  onPublishClick,
  isPublishPending
}: PublishConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-dialog-title"
      onClick={onBackdropClick}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Card className="w-full max-w-sm p-4 shadow-xl">
          <h2 id="publish-dialog-title" className="text-lg font-semibold text-slate-800">
            Publish workflow?
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This will create an immutable published version. You can continue editing the draft
            afterward.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancelClick}>
              Cancel
            </Button>
            <Button onClick={onPublishClick} disabled={isPublishPending}>
              {isPublishPending ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
