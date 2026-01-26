import { ReactNode } from "react";

import { cn } from "@/lib/cn";

type CardProps = {
  title?: ReactNode;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({
  title,
  description,
  actions,
  children,
  className
}: CardProps) {
  return (
    <section
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-5 shadow-sm",
        className
      )}
    >
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4">
          <div>
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
            {description && (
              <p className="mt-1 text-xs text-slate-500">{description}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      <div className={title || actions ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
