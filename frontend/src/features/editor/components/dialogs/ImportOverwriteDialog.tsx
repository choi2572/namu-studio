"use client";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export type ImportOverwriteDialogProps = {
  onBackdropClick: () => void;
  onCancelClick: () => void;
  onConfirmClick: () => void;
};

export function ImportOverwriteDialog({
  onBackdropClick,
  onCancelClick,
  onConfirmClick
}: ImportOverwriteDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-overwrite-title"
      onClick={onBackdropClick}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Card className="w-full max-w-sm p-4 shadow-xl">
          <h2 id="import-overwrite-title" className="text-lg font-semibold text-slate-800">
            Replace editor contents?
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            The current workflow on the canvas will be discarded and replaced by the imported file.
            Unsaved changes will be lost. Nothing is saved to the server until you choose Save.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancelClick}>
              Cancel
            </Button>
            <Button onClick={onConfirmClick}>OK</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
