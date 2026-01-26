import { RunStatus } from "@/domain/types";

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatDuration(ms: number | null) {
  if (ms == null) {
    return "-";
  }
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export function formatRunStatus(status: RunStatus) {
  switch (status) {
    case RunStatus.RUNNING:
      return "RUNNING";
    case RunStatus.WAITING:
      return "WAITING";
    case RunStatus.SUCCESS:
      return "SUCCESS";
    case RunStatus.FAILED:
      return "FAILED";
    case RunStatus.CANCELED:
      return "CANCELED";
    case RunStatus.CREATED:
    default:
      return "CREATED";
  }
}
