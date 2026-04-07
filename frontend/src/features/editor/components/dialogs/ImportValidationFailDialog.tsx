"use client";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export type ImportValidationFailDialogProps = {
  messages: string[];
  onBackdropClick: () => void;
  onOkClick: () => void;
};

export function ImportValidationFailDialog({
  messages,
  onBackdropClick,
  onOkClick
}: ImportValidationFailDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-fail-title"
      onClick={onBackdropClick}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Card className="w-full max-w-md p-4 shadow-xl">
          <h2 id="import-fail-title" className="text-lg font-semibold text-slate-800">
            Import failed
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {messages.map((msg, index) => (
              <li key={`${index}-${msg}`}>{msg}</li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button onClick={onOkClick}>OK</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
