"use client";

import { RunEvent } from "@/domain/types";
import { Table, TableCell, TableHead, TableRow } from "@/components/Table";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

type TimelineTableProps = {
  events: RunEvent[];
  selectedNode: string | null;
  onSelectNode: (stateName: string) => void;
};

// 이벤트 타입별 아이콘과 색상
const EVENT_TYPE_CONFIG: Record<
  string,
  { icon: string; color: string; bgColor: string }
> = {
  RUN_CREATED: {
    icon: "🚀",
    color: "text-blue-600",
    bgColor: "bg-blue-50"
  },
  RUN_STARTED: {
    icon: "▶️",
    color: "text-green-600",
    bgColor: "bg-green-50"
  },
  RUN_SUCCEEDED: {
    icon: "✅",
    color: "text-emerald-600",
    bgColor: "bg-emerald-50"
  },
  RUN_FAILED: {
    icon: "❌",
    color: "text-red-600",
    bgColor: "bg-red-50"
  },
  RUN_CANCELED: {
    icon: "⏹️",
    color: "text-slate-600",
    bgColor: "bg-slate-50"
  },
  RUN_STATUS_CHANGED: {
    icon: "🔄",
    color: "text-amber-600",
    bgColor: "bg-amber-50"
  },
  NODE_STARTED: {
    icon: "▶️",
    color: "text-blue-600",
    bgColor: "bg-blue-50"
  },
  NODE_WAITING: {
    icon: "⏳",
    color: "text-amber-600",
    bgColor: "bg-amber-50"
  },
  NODE_SUCCEEDED: {
    icon: "✅",
    color: "text-emerald-600",
    bgColor: "bg-emerald-50"
  },
  NODE_FAILED: {
    icon: "❌",
    color: "text-red-600",
    bgColor: "bg-red-50"
  },
  NODE_SKIPPED: {
    icon: "⏭️",
    color: "text-slate-500",
    bgColor: "bg-slate-50"
  },
  NODE_CANCELED: {
    icon: "⏹️",
    color: "text-slate-600",
    bgColor: "bg-slate-50"
  },
  EXTERNAL_EVENT_RECEIVED: {
    icon: "📨",
    color: "text-purple-600",
    bgColor: "bg-purple-50"
  },
  SAFETY_INTERRUPT: {
    icon: "⚠️",
    color: "text-orange-600",
    bgColor: "bg-orange-50"
  }
};

function getEventConfig(eventType: string) {
  return (
    EVENT_TYPE_CONFIG[eventType] ?? {
      icon: "📋",
      color: "text-slate-600",
      bgColor: "bg-slate-50"
    }
  );
}

export function TimelineTable({
  events,
  selectedNode,
  onSelectNode
}: TimelineTableProps) {
  if (events.length === 0) {
    return (
      <Table className="text-xs">
        <TableHead>
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
              Seq
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
              Time
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
              Event
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
              Node
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
              Details
            </th>
          </tr>
        </TableHead>
        <tbody>
          <tr>
            <TableCell colSpan={5} className="text-center text-slate-500">
              No events yet
            </TableCell>
          </tr>
        </tbody>
      </Table>
    );
  }

  return (
    <Table className="text-xs">
      <TableHead>
        <tr>
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
            Seq
          </th>
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
            Time
          </th>
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
            Event
          </th>
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
            Node
          </th>
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">
            Details
          </th>
        </tr>
      </TableHead>
      <tbody>
        {events.map((event) => {
          const config = getEventConfig(event.eventType);
          const hasPayload = event.payload && Object.keys(event.payload).length > 0;

          return (
            <TableRow
              key={event.eventId}
              onClick={() => {
                if (event.stateName) {
                  onSelectNode(event.stateName);
                }
              }}
              className={cn(
                "cursor-pointer transition-colors",
                event.stateName && selectedNode === event.stateName && "bg-blue-50"
              )}
            >
              <TableCell className="font-mono text-slate-600">
                {event.seq}
              </TableCell>
              <TableCell className="text-slate-600">
                {formatDateTime(event.timestamp)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="text-base">{config.icon}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      config.color,
                      config.bgColor
                    )}
                  >
                    {event.eventType}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                {event.stateName ? (
                  <span className="font-medium text-slate-900">
                    {event.stateName}
                  </span>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </TableCell>
              <TableCell>
                {hasPayload ? (
                  <span className="text-[10px] text-slate-500">
                    {JSON.stringify(event.payload).slice(0, 50)}
                    {JSON.stringify(event.payload).length > 50 ? "..." : ""}
                  </span>
                ) : (
                  <span className="text-slate-400">-</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </tbody>
    </Table>
  );
}
