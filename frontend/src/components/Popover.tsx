"use client";

import { ReactNode, useState } from "react";

type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
};

export function Popover({ trigger, children, align = "left" }: PopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-flex">
      <button type="button" onClick={() => setOpen((prev) => !prev)} className="inline-flex">
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute z-20 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
