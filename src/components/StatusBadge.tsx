import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<string, string> = {
  RUNNING: "bg-status-running text-white",
  WAITING: "bg-status-waiting text-white",
  SUCCESS: "bg-status-success text-green-900",
  SUCCEEDED: "bg-status-success text-green-900",
  FAILED: "bg-status-failed text-white",
  CANCELED: "bg-status-canceled text-white",
  SKIPPED: "bg-status-skipped text-slate-900",
  CREATED: "bg-slate-200 text-slate-700",
  DRAFT: "bg-slate-200 text-slate-700",
  PUBLISHED: "bg-slate-900 text-white",
  START: "bg-slate-900 text-white"
};

type StatusBadgeProps = {
  status: string;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
        STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700",
        className
      )}
    >
      {status}
    </span>
  );
}
